import {
  EventType,
  HistoryVisibility,
  JoinRule,
  RestrictedAllowType,
  Visibility,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { channelTypeInitialStateEvent } from './channelType';

/**
 * Posts — a per-member timeline inside a Space, so a hub is somewhere you publish under your own
 * name and not only somewhere you chat. The Pleroma-shaped feature without a Pleroma: no second
 * server, no second account, no ActivityPub inbox, and no separate moderation queue.
 *
 * **The constraint that shapes all of this:** Matrix has no per-event visibility. History
 * visibility is a property of the *room*. A "private" flag on an event sitting in a readable
 * room would be decoration — the event is still right there in `/messages` for anyone who can
 * read the room. So privacy here is decided by *where a post lives*, never by a field on it:
 *
 * - **Public** — an `xyz.nekous.post` event in the author's feed room, which is `world_readable`.
 * - **Private** — the author's own account data, exactly where `savedMessages.ts` keeps
 *   bookmarks. No other user can read it, because it was never in a room to begin with.
 *
 * Making a public post private redacts the event and writes its text back to account data;
 * publishing a private one does the reverse. The post gets a new event ID either way, so
 * reactions don't survive the move — which is the honest outcome, since its audience changed.
 */

/**
 * A post. Deliberately its own event type rather than an `m.room.message`, for two reasons: it
 * can be power-level gated on its own (`events: { 'xyz.nekous.post': 100 }` in a feed room, so
 * only the owner posts while everyone keeps the default level for reactions), and a feed room
 * peeked from Element shows nothing rather than a chat log that isn't one. The *content* is
 * message-shaped (`body` / `format` / `formatted_body`), so `renderMessageText` and
 * `buildMessageFormatting` work on it completely unchanged.
 */
export const POST_EVENT_TYPE = 'xyz.nekous.post';

/** Marks a room as someone's feed and records whose — read by anything that has the room but not
 *  the Space it belongs to (the timeline renderer, mainly). */
const FEED_MARKER_EVENT = 'xyz.nekous.feed';

/**
 * Where a member's feed room ID is published: a custom key on their *own* `m.room.member` event
 * in the Space.
 *
 * This is the one piece of Matrix plumbing worth explaining. Discovery has to be writable by an
 * ordinary member and readable by everyone, and the obvious candidates both fail: `m.space.child`
 * needs state permission in the Space (and handing that out is exactly the hole the voice
 * tenancy gate closes — a member who can add Space children can add their own room and claim
 * voice service for it), while account data is private to its owner. Your own member event is
 * the one piece of Space state you can always write and everyone can always read, and it's
 * already synced, so reading the whole hub's feeds costs zero requests. `nicknames.ts` leans on
 * the same property for per-Space display names.
 */
const FEED_ROOM_MEMBER_KEY = 'xyz.nekous.feed_room';

/**
 * The author's own durable record of which room is their feed in each Space, mirroring what they
 * publish in their member event. Member event content doesn't survive leaving and rejoining a
 * Space, and without this a rejoin would silently strand the old feed and start a second one.
 */
const FEED_ROOMS_ACCOUNT_DATA = 'xyz.nekous.feed_rooms';

/** Private posts. Account data, so they are genuinely private rather than flagged-private. */
const PRIVATE_POSTS_ACCOUNT_DATA = 'xyz.nekous.private_posts';

export type PostContent = { body: string; format?: string; formatted_body?: string };

export type PrivatePost = {
  id: string;
  spaceId: string;
  body: string;
  createdAt: number;
};

function serverNameOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(colon + 1);
}

// ---------------------------------------------------------------------------
// Reading posts
// ---------------------------------------------------------------------------

export function isPostEvent(event: MatrixEvent): boolean {
  return event.getType() === POST_EVENT_TYPE && !event.isRedacted();
}

/** A post's content, or undefined for an event that isn't one (or was redacted to nothing). */
export function readPost(event: MatrixEvent): PostContent | undefined {
  if (!isPostEvent(event)) return undefined;
  const content = event.getContent<Partial<PostContent>>();
  if (typeof content.body !== 'string' || !content.body) return undefined;
  return {
    body: content.body,
    ...(content.format && { format: content.format }),
    ...(content.formatted_body && { formatted_body: content.formatted_body }),
  };
}

export function buildPostContent(body: string, formattedBody?: string): PostContent {
  return {
    body,
    ...(formattedBody && { format: 'org.matrix.custom.html', formatted_body: formattedBody }),
  };
}

/** Whose feed this room is, from the room's own state — undefined for any other kind of room. */
export function readFeedOwner(room: Room): string | undefined {
  const content = room.currentState.getStateEvents(FEED_MARKER_EVENT, '')?.getContent<{ owner?: string }>();
  return typeof content?.owner === 'string' ? content.owner : undefined;
}

// ---------------------------------------------------------------------------
// Finding feeds
// ---------------------------------------------------------------------------

/** The feed room a given member publishes in this Space, if they have one yet. */
export function readFeedRoomId(space: Room, userId: string): string | undefined {
  const content = space.currentState.getStateEvents(EventType.RoomMember, userId)?.getContent() as
    | Record<string, unknown>
    | undefined;
  const roomId = content?.[FEED_ROOM_MEMBER_KEY];
  return typeof roomId === 'string' && roomId ? roomId : undefined;
}

/**
 * Every feed in the Space, from already-synced member state. Only joined members count — someone
 * who left takes their timeline out of the hub with them, without anything having to be cleaned
 * up when they go.
 */
export function listSpaceFeeds(space: Room): { userId: string; roomId: string }[] {
  const memberEvents = space.currentState.getStateEvents(EventType.RoomMember) as MatrixEvent[];
  const feeds: { userId: string; roomId: string }[] = [];
  memberEvents.forEach((event) => {
    const content = event.getContent() as Record<string, unknown>;
    if (content.membership !== 'join') return;
    const roomId = content[FEED_ROOM_MEMBER_KEY];
    const userId = event.getStateKey();
    if (typeof roomId === 'string' && roomId && userId) feeds.push({ userId, roomId });
  });
  return feeds;
}

function readOwnFeedRooms(mx: MatrixClient): Record<string, string> {
  return mx.getAccountData(FEED_ROOMS_ACCOUNT_DATA as any)?.getContent<Record<string, string>>() ?? {};
}

export function getOwnFeedRoomId(mx: MatrixClient, spaceId: string): string | undefined {
  return readOwnFeedRooms(mx)[spaceId];
}

// ---------------------------------------------------------------------------
// Creating a feed
// ---------------------------------------------------------------------------

/**
 * Publishes (or re-publishes) the pointer to your feed room on your own member event, preserving
 * everything else in it — your per-Space nickname lives in the same content, and a write that
 * dropped it would silently rename you.
 */
async function publishFeedPointer(mx: MatrixClient, space: Room, roomId: string): Promise<void> {
  const myUserId = mx.getUserId();
  if (!myUserId) return;
  const existing = (space.currentState.getStateEvents(EventType.RoomMember, myUserId)?.getContent() ??
    {}) as Record<string, unknown>;
  if (existing[FEED_ROOM_MEMBER_KEY] === roomId) return; // already correct — skip a no-op write
  await mx.sendStateEvent(
    space.roomId,
    EventType.RoomMember,
    { ...existing, membership: 'join', [FEED_ROOM_MEMBER_KEY]: roomId } as any,
    myUserId
  );
}

/**
 * Creates the room a feed lives in. Not routed through `roomCreation.ts`'s `createRoom` on
 * purpose: a feed room isn't a channel and doesn't want any of that function's policy — it is
 * never a Space child (nothing should list it in the channel list, and an ordinary member can't
 * write `m.space.child` anyway), it needs `world_readable` history, and its power levels gate a
 * custom event type. Bending the channel helper to cover all three would make every channel's
 * creation path carry feed-shaped options.
 */
async function createFeedRoom(mx: MatrixClient, space: Room, displayName: string): Promise<string> {
  const { room_id: roomId } = await mx.createRoom({
    name: `${displayName}'s posts`,
    // Never in the public directory: a feed is discovered through its owner's membership of the
    // Space, and listing it would make it findable by people who aren't in the hub at all.
    visibility: Visibility.Private,
    power_level_content_override: {
      // Only the owner (power level 100 as the room's creator) can post. Everything else stays
      // at the default, so other members can still react — `events_default` is untouched.
      events: { [POST_EVENT_TYPE]: 100 },
    },
    initial_state: [
      {
        // Membership of the Space is what grants access, the same rule voice channels use. It
        // is also what lets other members join this room to read and react without the owner
        // having to invite every one of them.
        type: EventType.RoomJoinRules,
        state_key: '',
        content: {
          join_rule: JoinRule.Restricted,
          allow: [{ type: RestrictedAllowType.RoomMembership, room_id: space.roomId }],
        },
      },
      {
        // "Viewable by all" in the literal Matrix sense: readable without joining first.
        type: EventType.RoomHistoryVisibility,
        state_key: '',
        content: { history_visibility: HistoryVisibility.WorldReadable },
      },
      channelTypeInitialStateEvent('feed'),
      { type: FEED_MARKER_EVENT, state_key: '', content: { owner: mx.getUserId(), spaceId: space.roomId } },
    ],
  });
  return roomId;
}

/**
 * The feed room to post into, creating it on first use. Returns an existing one whenever there
 * is one — checking the author's own account data before their published pointer, since the
 * account data is what survives a leave-and-rejoin of the Space.
 */
export async function ensureFeedRoom(mx: MatrixClient, space: Room, displayName: string): Promise<string> {
  const myUserId = mx.getUserId() ?? '';
  const known = getOwnFeedRoomId(mx, space.roomId) ?? readFeedRoomId(space, myUserId);
  if (known && mx.getRoom(known)?.getMyMembership() === 'join') {
    await publishFeedPointer(mx, space, known);
    return known;
  }

  const roomId = await createFeedRoom(mx, space, displayName);
  await mx.setAccountData(FEED_ROOMS_ACCOUNT_DATA as any, {
    ...readOwnFeedRooms(mx),
    [space.roomId]: roomId,
  } as any);
  await publishFeedPointer(mx, space, roomId);
  return roomId;
}

/**
 * Joins the feed rooms of everyone in the Space that this client isn't in yet, which is what
 * makes the hub view able to show them: reading a `world_readable` room you aren't in needs a
 * peek, and peeking is the least well-supported corner of the Matrix client-server API. Joining
 * is allowed without an invite because feed rooms are restricted to the Space.
 *
 * Failures are per-room and ignored — one member's feed being unjoinable (a server that's down,
 * a room they've since locked) is not a reason for the rest of the hub to stay empty.
 */
export async function followSpaceFeeds(mx: MatrixClient, space: Room): Promise<void> {
  await space.loadMembersIfNeeded();
  const feeds = listSpaceFeeds(space);
  await Promise.all(
    feeds
      .filter(({ roomId }) => mx.getRoom(roomId)?.getMyMembership() !== 'join')
      .map(({ roomId }) =>
        mx.joinRoom(roomId, { viaServers: [serverNameOf(roomId)] }).catch(() => undefined)
      )
  );
}

// ---------------------------------------------------------------------------
// Publishing, unpublishing, deleting
// ---------------------------------------------------------------------------

export async function publishPost(mx: MatrixClient, feedRoomId: string, content: PostContent): Promise<void> {
  await mx.sendEvent(feedRoomId, POST_EVENT_TYPE as any, content as any);
}

/** Deleting a public post is an ordinary redaction — the author is power level 100 in their own
 *  feed room, so no moderation permission is involved. */
export async function deletePost(mx: MatrixClient, feedRoomId: string, eventId: string): Promise<void> {
  await mx.redactEvent(feedRoomId, eventId);
}

// ---------------------------------------------------------------------------
// Private posts
// ---------------------------------------------------------------------------

function newPrivatePostId(): string {
  return `post-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readPrivatePosts(mx: MatrixClient, spaceId?: string): PrivatePost[] {
  const content = mx
    .getAccountData(PRIVATE_POSTS_ACCOUNT_DATA as any)
    ?.getContent<{ items?: PrivatePost[] }>();
  const items = content?.items ?? [];
  const scoped = spaceId ? items.filter((item) => item.spaceId === spaceId) : items;
  return [...scoped].sort((a, b) => b.createdAt - a.createdAt);
}

async function writePrivatePosts(mx: MatrixClient, items: PrivatePost[]): Promise<void> {
  await mx.setAccountData(PRIVATE_POSTS_ACCOUNT_DATA as any, { items } as any);
}

export async function savePrivatePost(mx: MatrixClient, spaceId: string, body: string): Promise<PrivatePost> {
  const post: PrivatePost = { id: newPrivatePostId(), spaceId, body, createdAt: Date.now() };
  await writePrivatePosts(mx, [...readPrivatePosts(mx), post]);
  return post;
}

export async function deletePrivatePost(mx: MatrixClient, id: string): Promise<void> {
  await writePrivatePosts(
    mx,
    readPrivatePosts(mx).filter((post) => post.id !== id)
  );
}

/**
 * Takes a published post back out of view: redact it, then keep the text privately. Redaction
 * first, deliberately — if the account-data write fails the post is still unpublished, which is
 * what was actually asked for, whereas the other order could leave it visible with the author
 * believing otherwise.
 */
export async function makePostPrivate(
  mx: MatrixClient,
  spaceId: string,
  feedRoomId: string,
  event: MatrixEvent
): Promise<void> {
  const post = readPost(event);
  await mx.redactEvent(feedRoomId, event.getId() ?? '');
  if (post) await savePrivatePost(mx, spaceId, post.body);
}

/** Publishes a private post and drops the private copy. Same ordering logic in reverse: nothing
 *  is removed from account data until it is definitely somewhere else. */
export async function publishPrivatePost(
  mx: MatrixClient,
  feedRoomId: string,
  post: PrivatePost,
  content: PostContent
): Promise<void> {
  await publishPost(mx, feedRoomId, content);
  await deletePrivatePost(mx, post.id);
}
