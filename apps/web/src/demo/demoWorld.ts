import { EventType, MatrixEvent, Room, RoomType, type MatrixClient } from 'matrix-js-sdk';
import {
  DEMO_BOT_USER_ID,
  DEMO_LIVEKIT_URL,
  DEMO_SERVER_NAME,
  DEMO_TOKEN_ENDPOINT,
  DEMO_USER_ID,
} from './demoMode';

/**
 * The fabricated world demo mode runs on.
 *
 * Built out of **real** `Room` and `MatrixEvent` objects from matrix-js-sdk, not hand-rolled
 * look-alikes. That matters: every read path the app uses — `currentState.getStateEvents` for
 * this codebase's custom markers, `getMember().powerLevel`, `getJoinedMembers`, `isSpaceRoom`,
 * the live timeline — is then the SDK's own implementation rather than a second, subtly
 * different one written here that would drift. The only thing faked is the client that would
 * normally have fetched all this (demoClient.ts).
 */

const ts = (minutesAgo: number) => Date.now() - minutesAgo * 60_000;

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `$demo-${eventCounter}:${DEMO_SERVER_NAME}`;
}

type EventInit = {
  type: string;
  content: Record<string, unknown>;
  sender?: string;
  stateKey?: string;
  ts?: number;
  eventId?: string;
};

export function demoEvent(roomId: string, init: EventInit): MatrixEvent {
  return new MatrixEvent({
    type: init.type,
    content: init.content,
    sender: init.sender ?? DEMO_USER_ID,
    room_id: roomId,
    event_id: init.eventId ?? nextEventId(),
    origin_server_ts: init.ts ?? Date.now(),
    ...(init.stateKey !== undefined ? { state_key: init.stateKey } : {}),
  });
}

export const DEMO_MEMBERS = [
  { userId: DEMO_USER_ID, name: 'You', powerLevel: 100 },
  { userId: `@nibbles:${DEMO_SERVER_NAME}`, name: 'Nibbles', powerLevel: 50 },
  { userId: `@pixel:${DEMO_SERVER_NAME}`, name: 'Pixel', powerLevel: 0 },
  { userId: `@mochi:${DEMO_SERVER_NAME}`, name: 'Mochi', powerLevel: 0 },
] as const;

const NIBBLES = DEMO_MEMBERS[1].userId;
const PIXEL = DEMO_MEMBERS[2].userId;
const MOCHI = DEMO_MEMBERS[3].userId;

export const DEMO_ROOM_IDS = {
  cafe: `!cafe:${DEMO_SERVER_NAME}`,
  general: `!general:${DEMO_SERVER_NAME}`,
  introductions: `!introductions:${DEMO_SERVER_NAME}`,
  lounge: `!lounge:${DEMO_SERVER_NAME}`,
  afk: `!afk:${DEMO_SERVER_NAME}`,
  arcade: `!arcade:${DEMO_SERVER_NAME}`,
  gaming: `!gaming:${DEMO_SERVER_NAME}`,
  gameNight: `!game-night:${DEMO_SERVER_NAME}`,
  feedYou: `!feed-you:${DEMO_SERVER_NAME}`,
  feedNibbles: `!feed-nibbles:${DEMO_SERVER_NAME}`,
  dmNibbles: `!dm-nibbles:${DEMO_SERVER_NAME}`,
  groupChat: `!group-chat:${DEMO_SERVER_NAME}`,
} as const;

/** Members present in a room, as `m.room.member` state. */
function memberEvents(roomId: string, userIds: readonly string[]): MatrixEvent[] {
  return userIds.map((userId) => {
    const member = DEMO_MEMBERS.find((m) => m.userId === userId);
    return demoEvent(roomId, {
      type: EventType.RoomMember,
      stateKey: userId,
      sender: userId,
      content: { membership: 'join', displayname: member?.name ?? userId.slice(1).split(':')[0] },
    });
  });
}

function powerLevelEvent(roomId: string, userIds: readonly string[]): MatrixEvent {
  const users: Record<string, number> = {};
  userIds.forEach((userId) => {
    const member = DEMO_MEMBERS.find((m) => m.userId === userId);
    if (member) users[userId] = member.powerLevel;
  });
  return demoEvent(roomId, {
    type: EventType.RoomPowerLevels,
    stateKey: '',
    content: { users, users_default: 0, state_default: 50, events_default: 0, invite: 0, kick: 50, ban: 50, redact: 50 },
  });
}

type RoomSeed = {
  roomId: string;
  name: string;
  topic?: string;
  isSpace?: boolean;
  /** Voice channel marker (`xyz.nekous.channel_type`). */
  voice?: boolean;
  /** Feed room marker plus its owner — a member's posts timeline, see matrix/feed.ts. */
  feed?: string;
  members?: readonly string[];
  /** Extra state events beyond the standard create/name/members/power-levels set. */
  state?: (roomId: string) => MatrixEvent[];
  timeline?: (roomId: string) => MatrixEvent[];
};

function buildRoom(client: MatrixClient, seed: RoomSeed): Room {
  const room = new Room(seed.roomId, client, DEMO_USER_ID, { pendingEventOrdering: 'detached' as never });
  const members = seed.members ?? DEMO_MEMBERS.map((m) => m.userId);

  const state: MatrixEvent[] = [
    demoEvent(seed.roomId, {
      type: EventType.RoomCreate,
      stateKey: '',
      content: {
        creator: DEMO_USER_ID,
        room_version: '10',
        ...(seed.isSpace ? { type: RoomType.Space } : {}),
      },
    }),
    demoEvent(seed.roomId, { type: EventType.RoomName, stateKey: '', content: { name: seed.name } }),
    ...(seed.topic
      ? [demoEvent(seed.roomId, { type: EventType.RoomTopic, stateKey: '', content: { topic: seed.topic } })]
      : []),
    ...memberEvents(seed.roomId, members),
    powerLevelEvent(seed.roomId, members),
    ...(seed.voice
      ? [demoEvent(seed.roomId, { type: 'xyz.nekous.channel_type', stateKey: '', content: { type: 'voice' } })]
      : []),
    ...(seed.feed
      ? [
          demoEvent(seed.roomId, { type: 'xyz.nekous.channel_type', stateKey: '', content: { type: 'feed' } }),
          demoEvent(seed.roomId, {
            type: 'xyz.nekous.feed',
            stateKey: '',
            content: { owner: seed.feed, spaceId: DEMO_ROOM_IDS.cafe },
          }),
        ]
      : []),
    ...(seed.state?.(seed.roomId) ?? []),
  ];

  room.currentState.setStateEvents(state);
  room.recalculate();

  const timeline = seed.timeline?.(seed.roomId) ?? [];
  if (timeline.length > 0) {
    room.addLiveEvents(timeline, { addToState: false } as never);
  }
  return room;
}

/**
 * A member's `m.room.member` event in the Space, re-sent carrying the pointer to their feed room.
 * That custom key is exactly how the real thing publishes it (matrix/feed.ts): it's the one piece
 * of Space state an ordinary member can write and everyone can read.
 */
function feedPointerEvent(spaceId: string, userId: string, feedRoomId: string): MatrixEvent {
  const member = DEMO_MEMBERS.find((m) => m.userId === userId);
  return demoEvent(spaceId, {
    type: EventType.RoomMember,
    stateKey: userId,
    sender: userId,
    content: {
      membership: 'join',
      displayname: member?.name ?? userId,
      'xyz.nekous.feed_room': feedRoomId,
    },
  });
}

/** A post on someone's feed — `xyz.nekous.post`, not an `m.room.message`. */
function demoPost(roomId: string, sender: string, body: string, minutesAgo: number): MatrixEvent {
  return demoEvent(roomId, { type: 'xyz.nekous.post', sender, content: { body }, ts: ts(minutesAgo) });
}

/** `m.space.child` + the reciprocal `m.space.parent`, which is how voice.ts finds a Space. */
function spaceChildEvents(spaceId: string, childIds: readonly string[]): MatrixEvent[] {
  return childIds.map((childId, index) =>
    demoEvent(spaceId, {
      type: EventType.SpaceChild,
      stateKey: childId,
      content: { via: [DEMO_SERVER_NAME], order: String(index).padStart(3, '0') },
    })
  );
}

function spaceParentEvent(roomId: string, spaceId: string): MatrixEvent {
  return demoEvent(roomId, {
    type: EventType.SpaceParent,
    stateKey: spaceId,
    content: { canonical: true, via: [DEMO_SERVER_NAME] },
  });
}

function textMessage(
  roomId: string,
  sender: string,
  body: string,
  minutesAgo: number,
  extra: Record<string, unknown> = {}
): MatrixEvent {
  return demoEvent(roomId, {
    type: EventType.RoomMessage,
    sender,
    ts: ts(minutesAgo),
    content: { msgtype: 'm.text', body, ...extra },
  });
}

/**
 * Bodies here are written in Markdown on purpose. This app renders from the plain-text `body`
 * with its own parser (features/messaging/renderMessageText.tsx) rather than from an HTML
 * `formatted_body`, so Markdown in the body is what actually exercises bold/italic/code/fences/
 * spoilers on screen — the thing a demo most needs to show.
 */
const GENERAL_TIMELINE = (roomId: string): MatrixEvent[] => {
  const welcome = textMessage(roomId, NIBBLES, 'welcome to the café ☕', 240);
  const reactTarget = textMessage(
    roomId,
    PIXEL,
    'finally got the **H.264** screen share running at *60fps*',
    180
  );

  return [
    welcome,
    textMessage(roomId, MOCHI, 'is this thing on?', 235),
    reactTarget,
    demoEvent(roomId, {
      type: EventType.Reaction,
      sender: NIBBLES,
      ts: ts(179),
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: reactTarget.getId(), key: '🔥' } },
    }),
    demoEvent(roomId, {
      type: EventType.Reaction,
      sender: MOCHI,
      ts: ts(178),
      content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: reactTarget.getId(), key: '🔥' } },
    }),
    textMessage(
      roomId,
      MOCHI,
      'the trick was setting `maxFramerate` explicitly:\n```ts\nscreenShareEncoding: {\n  maxBitrate: 8_000_000,\n  maxFramerate: 60,\n}\n```',
      120
    ),
    textMessage(roomId, PIXEL, 'careful though ||it pegs a weak server on packet crypto||', 90),
    demoEvent(roomId, {
      type: EventType.RoomMessage,
      sender: NIBBLES,
      ts: ts(45),
      content: {
        msgtype: 'm.text',
        body: 'You: can you take a look at the voice channel setup?',
        'm.mentions': { user_ids: [DEMO_USER_ID] },
      },
    }),
    textMessage(roomId, DEMO_USER_ID, 'on it — the bot invites itself now, should just work', 30),
    demoEvent(roomId, {
      type: EventType.RoomMessage,
      sender: MOCHI,
      ts: ts(12),
      content: { msgtype: 'm.notice', body: 'Mochi set the topic.' },
    }),
  ];
};

const seeds = (): RoomSeed[] => [
  {
    roomId: DEMO_ROOM_IDS.cafe,
    name: 'Cat Café',
    isSpace: true,
    topic: 'A Space with voice fully configured.',
    state: (id) => [
      ...spaceChildEvents(id, [
        DEMO_ROOM_IDS.general,
        DEMO_ROOM_IDS.introductions,
        DEMO_ROOM_IDS.lounge,
        DEMO_ROOM_IDS.afk,
      ]),
      // Fully configured voice, bot ID included — the state the app now writes for itself.
      demoEvent(id, {
        type: 'xyz.nekous.voice_server',
        stateKey: '',
        content: {
          url: DEMO_LIVEKIT_URL,
          tokenEndpoint: DEMO_TOKEN_ENDPOINT,
          botUserId: DEMO_BOT_USER_ID,
        },
      }),
      feedPointerEvent(id, DEMO_USER_ID, DEMO_ROOM_IDS.feedYou),
      feedPointerEvent(id, NIBBLES, DEMO_ROOM_IDS.feedNibbles),
      demoEvent(id, {
        type: 'xyz.nekous.channel_categories',
        stateKey: '',
        content: {
          categories: [
            { id: 'cat-text', name: 'TEXT CHANNELS', channelIds: [DEMO_ROOM_IDS.general, DEMO_ROOM_IDS.introductions] },
            { id: 'cat-voice', name: 'VOICE CHANNELS', channelIds: [DEMO_ROOM_IDS.lounge, DEMO_ROOM_IDS.afk] },
          ],
        },
      }),
    ],
  },
  {
    roomId: DEMO_ROOM_IDS.general,
    name: 'general',
    topic: 'Markdown, code blocks, spoilers, reactions and mentions all render here.',
    state: (id) => [spaceParentEvent(id, DEMO_ROOM_IDS.cafe)],
    timeline: GENERAL_TIMELINE,
  },
  {
    roomId: DEMO_ROOM_IDS.introductions,
    name: 'introductions',
    state: (id) => [spaceParentEvent(id, DEMO_ROOM_IDS.cafe)],
    timeline: (id) => [textMessage(id, MOCHI, 'hi! i mostly lurk', 600)],
  },
  {
    // The happy path: bot present, so joining gets all the way to the token request.
    roomId: DEMO_ROOM_IDS.lounge,
    name: 'Lounge',
    voice: true,
    members: [...DEMO_MEMBERS.map((m) => m.userId), DEMO_BOT_USER_ID],
    state: (id) => [
      spaceParentEvent(id, DEMO_ROOM_IDS.cafe),
      demoEvent(id, {
        type: EventType.RoomMember,
        stateKey: DEMO_BOT_USER_ID,
        sender: DEMO_BOT_USER_ID,
        content: { membership: 'join', displayname: 'NekoUs Voice' },
      }),
    ],
  },
  {
    // The channel the voice-bot fix exists for: bot absent, so selecting this exercises
    // ensureVoiceBotInvited + the 409 retry loop rather than a bare 403.
    roomId: DEMO_ROOM_IDS.afk,
    name: 'AFK',
    voice: true,
    state: (id) => [spaceParentEvent(id, DEMO_ROOM_IDS.cafe)],
  },
  {
    roomId: DEMO_ROOM_IDS.arcade,
    name: 'Pixel Arcade',
    isSpace: true,
    topic: 'A Space with no voice server configured at all.',
    members: [DEMO_USER_ID, PIXEL],
    state: (id) => spaceChildEvents(id, [DEMO_ROOM_IDS.gaming, DEMO_ROOM_IDS.gameNight]),
  },
  {
    roomId: DEMO_ROOM_IDS.gaming,
    name: 'gaming',
    members: [DEMO_USER_ID, PIXEL],
    state: (id) => [spaceParentEvent(id, DEMO_ROOM_IDS.arcade)],
    timeline: (id) => [textMessage(id, PIXEL, 'anyone up for something tonight?', 300)],
  },
  {
    // No voice server on this Space — shows the "ask an admin to configure one" branch.
    roomId: DEMO_ROOM_IDS.gameNight,
    name: 'Game Night',
    voice: true,
    members: [DEMO_USER_ID, PIXEL],
    state: (id) => [spaceParentEvent(id, DEMO_ROOM_IDS.arcade)],
  },
  // Feed rooms are deliberately NOT space children: they're discovered through their owner's
  // member event, so nothing lists them as channels (matrix/feed.ts).
  {
    roomId: DEMO_ROOM_IDS.feedYou,
    name: "You's posts",
    feed: DEMO_USER_ID,
    members: [DEMO_USER_ID, NIBBLES],
    timeline: (id) => [demoPost(id, DEMO_USER_ID, 'finally got the **voice channels** working', 45)],
  },
  {
    roomId: DEMO_ROOM_IDS.feedNibbles,
    name: "Nibbles's posts",
    feed: NIBBLES,
    members: [DEMO_USER_ID, NIBBLES],
    timeline: (id) => [
      demoPost(id, NIBBLES, 'movie night friday, bring snacks', 12),
      demoPost(id, NIBBLES, 'anyone else up at 3am', 300),
    ],
  },
  {
    roomId: DEMO_ROOM_IDS.dmNibbles,
    name: 'Nibbles',
    members: [DEMO_USER_ID, NIBBLES],
    timeline: (id) => [
      textMessage(id, NIBBLES, 'did the file picker thing ever get fixed?', 20),
      textMessage(id, DEMO_USER_ID, 'yep — it was escaping to the modal overlay', 18),
    ],
  },
  {
    roomId: DEMO_ROOM_IDS.groupChat,
    name: 'Weekend Plans',
    members: [DEMO_USER_ID, NIBBLES, PIXEL],
    timeline: (id) => [textMessage(id, PIXEL, 'saturday?', 400)],
  },
];

/** Builds every demo room. Called once, from demoClient.ts, with the fake client to bind to. */
export function buildDemoRooms(client: MatrixClient): Room[] {
  return seeds().map((seed) => buildRoom(client, seed));
}
