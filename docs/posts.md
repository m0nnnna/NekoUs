# Posts

How the hub's per-member post feeds work: the room shape, the custom event, how a feed is
discovered, and — the part that drives everything else — how privacy is actually enforced.
Read this before touching `apps/web/src/matrix/feed.ts`,
`apps/web/src/matrix/hooks/useSpaceFeed.ts`, or `apps/web/src/features/feed/`.

## Why not Pleroma / ActivityPub

The obvious way to add microblogging to a Matrix app is to run a fediverse server next to it.
That buys a second server to operate, a second account identity for every member to understand,
an ActivityPub inbox/outbox to secure, and a second moderation queue — to get something Matrix
already supports. Rooms, timelines, rich text, reactions, redaction, edits, uploads and
permissions are all here already. What was missing was a room *shape* and a feed *view*, not a
protocol.

## The constraint everything follows from

**Matrix has no per-event visibility.** `m.room.history_visibility` is a property of the room,
not of an event in it. So a `"private": true` field on a post in a readable room would be
decoration: the event is still in `/messages` for anyone who can read the room.

Privacy here is therefore decided by **where a post lives**, never by a field on it:

| | Where it lives | Who can read it |
|---|---|---|
| Public post | an `xyz.nekous.post` event in the author's feed room | anyone in the Space |
| Private post | the author's own account data (`xyz.nekous.private_posts`) | only the author |

Making a public post private redacts the event and writes its text back to account data;
publishing a private one does the reverse. Both orderings are deliberate (`feed.ts`): unpublish
redacts *first*, so a failure leaves the post gone rather than visible; publish sends *first*, so
a failure leaves the text still saved rather than lost. The post gets a new event ID either way,
so reactions don't survive the move — the honest outcome, since its audience changed.

## `xyz.nekous.post` — a post

```json
{
  "body": "finally got the **voice channels** working",
  "format": "org.matrix.custom.html",
  "formatted_body": "finally got the <strong>voice channels</strong> working"
}
```

A timeline event with its own type rather than an `m.room.message`, for two reasons:

- **It can be power-level gated on its own.** A feed room sets `events: { "xyz.nekous.post": 100 }`,
  so only the owner posts while everyone else keeps the default level and can still react.
  `m.room.message` can't express that — a threaded reply and a top-level post are the same event
  type, so gating one gates the other.
- **A feed room peeked from Element shows nothing**, rather than a chat log that isn't one.

The *content* is message-shaped on purpose, so `renderMessageText` and `buildMessageFormatting`
work on it completely unchanged — posts get the same emotes and inline Markdown as messages,
from the same code. **Mentions are the exception** (see "Not in this pass").

A useful consequence of the custom type: posts notify nowhere. Matrix's default push rules match
`m.room.message` and `m.room.encrypted` and nothing else, so an unknown event type produces no
notification and no unread count; `DesktopNotifications` and `MentionInboxCollector` both filter
on `m.room.message` as well. Joining one feed room per member therefore doesn't turn the hub into
a notification firehose — which it otherwise would, since those rooms are joined in bulk.

## The feed room

One per member per Space, created on their first post (`ensureFeedRoom`). Not created through
`roomCreation.ts`'s `createRoom`: a feed room isn't a channel and wants none of that function's
policy, so bending it to fit would push feed-shaped options into every channel's creation path.

| | |
|---|---|
| `m.room.join_rules` | `restricted`, allowing `m.room_membership` of the Space |
| `m.room.history_visibility` | `world_readable` — "viewable by all" in the literal Matrix sense |
| `xyz.nekous.channel_type` | `feed` |
| `xyz.nekous.feed` | `{ owner, spaceId }` |
| power levels | `events: { "xyz.nekous.post": 100 }`; `events_default` untouched |
| directory visibility | private — a feed is reached through the Space, not by searching |

The owner is power level 100 as the room's creator, so "I can edit and delete my own posts and
nobody else can" needs no moderation code at all. Restricting the join rule to the Space is what
lets other members join to read and react without the owner inviting each of them by hand — the
same mechanism voice channels use (`docs/voice-architecture.md`).

## Discovery: the member event

**A member's feed room ID is published as a custom key on their own `m.room.member` event in the
Space** (`xyz.nekous.feed_room`). This is the one piece of plumbing worth understanding, because
the obvious alternatives both fail:

- **`m.space.child`** needs state permission in the Space, which ordinary members don't have —
  and handing it out is precisely the hole the voice tenancy gate closes, since a member who can
  add Space children can add a room of their own and claim voice service for it.
- **Account data** is private to its owner, so nobody else could find the feed.

Your own member event is the one piece of Space state you can always write and everyone can
always read. It's already synced, so listing every feed in the hub costs zero requests.
`nicknames.ts` leans on the same property for per-Space display names — which is also why
`publishFeedPointer` spreads the existing content rather than replacing it.

Because member-event content doesn't survive leaving and rejoining a Space, the author also keeps
their own copy in account data (`xyz.nekous.feed_rooms`), checked first, so a rejoin re-points at
the existing feed instead of silently starting a second one.

## The hub timeline

`useSpaceFeed` merges the live timelines of every feed in the Space, newest first —
`mentionInbox.ts` already merges across rooms the same way, and at hub scale sorting the union
costs nothing worth optimizing. Only posts sent by a feed's *owner* count; power levels already
prevent anyone else posting there, so that check only matters for a room whose levels were
hand-edited.

**Pagination goes wide, not deep.** Every feed is paginated together, one page each, rather than
whichever room happens to hold the oldest post — the view is sorted by timestamp, so fetching
one room at a time would let a newer post from another feed appear *below* an older one that had
already been loaded. A room with nothing older left is skipped; one that errors is skipped rather
than failing the pass. The first load also paginates (up to three passes, or until it has ten
posts) because a freshly joined room arrives with only whatever `/sync` chose to include, which
for a quiet feed can be nothing at all — without that the hub looks empty in exactly the case
where it should look fullest.

Opening the view first calls `followSpaceFeeds`, which **joins** any feed room this client isn't
in yet. Joining rather than peeking is a deliberate trade: reading a `world_readable` room you
aren't in requires a peek, which is the least reliably supported corner of the client-server API.
The cost is that a member ends up joined to one room per other member — fine at hub scale,
and the reason `useSpacelessRooms` filters `feed` rooms out (without it, every member's timeline
would appear as a group chat in Direct Messages).

## UI

- `features/feed/FeedView.tsx` — the whole surface: composer with an "Only me" toggle, an
  Everyone/Yours tab pair, and the post cards. Reached from the pinned **Posts** row at the top
  of a Space's channel list, which sets `selectedSpaceViewAtom` rather than
  `selectedRoomIdAtom` — the feed is a merge across rooms, not one of them, so it can't be
  expressed as a selected room. Selecting any channel clears it.
- Private posts are re-read on this view's own actions rather than through a hook: account data
  has no live-update hook in this codebase, and a private post only ever changes in response to
  something done right here.

## Not in this pass

- **Images and attachments.** Posts are text (with the full inline Markdown/emote/mention set).
  `upload.ts` and `ImageMessage.tsx` exist, so adding an `m.image`-shaped post is a contained
  follow-up rather than a redesign.
- **Comments.** `m.thread` relations target any event ID, so `ThreadPanel` should work against a
  post largely as-is — untried here.
- **Reactions on posts.** `m.reaction` is event-type agnostic and `useReactions` already
  aggregates it, so this is wiring, not new mechanism.
- **Mentions.** The feed composer passes no mention candidates, so `@Name` in a post renders as
  a mention (the receive side resolves names against Space members) but sends no
  `m.mentions.user_ids` — nobody is notified and nothing reaches the Mention Inbox. Doing it
  properly needs the composer's autocomplete, which is what gates a name being treated as a real
  mention rather than a coincidental "@word" (see `Composer.tsx`'s `mentionedRef`); wiring that
  into the feed composer is the work.
- **A "chosen people" privacy tier.** Public and only-me are the two tiers. A third would be a
  second, invite-only feed room per member, where the invite list *is* the audience.
