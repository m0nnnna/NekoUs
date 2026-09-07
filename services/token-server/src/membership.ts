import { ClientEvent, RoomMemberEvent, createClient, type MatrixClient } from 'matrix-js-sdk';

/**
 * A persistent Matrix service-account bot, logged in once at process start, that stays joined
 * to whatever rooms/spaces it's invited to so it can read membership/power level *locally*
 * instead of doing federation state resolution itself — this mirrors element-hq/lk-jwt-service's
 * approach. An admin gates voice for a room simply by inviting this bot to it.
 *
 * Deliberately skips E2EE setup entirely (no initRustCrypto, no crypto store): the bot only
 * ever reads room state (m.room.member, m.room.power_levels), which Matrix never encrypts —
 * only timeline *messages* in encrypted rooms are, and this bot never reads those. That keeps
 * this service free of the WASM-crypto packaging concerns the browser client has to deal with.
 */
let botClientPromise: Promise<MatrixClient> | null = null;

// Belt-and-braces on top of the live RoomMemberEvent.Membership listener below: joins any room
// currently sitting at membership 'invite' regardless of whether an event for it was ever
// actually observed (a bot restart mid-flight, a missed event, or any other gap between "the
// homeserver thinks we're invited" and "we've actually acted on it"). Cheap to run — this is
// just a scan of the bot's own already-synced room list, no extra requests unless there's
// actually a pending invite to join.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

function joinPendingInvites(mx: MatrixClient): void {
  for (const room of mx.getRooms()) {
    if (room.getMyMembership() === 'invite') {
      mx.joinRoom(room.roomId).catch((err: unknown) => {
        console.error(`Reconciliation: failed to join pending invite for room ${room.roomId}`, err);
      });
    }
  }
}

async function loginBot(homeserverUrl: string): Promise<MatrixClient> {
  const accessToken = process.env.MATRIX_BOT_ACCESS_TOKEN;
  if (accessToken) {
    const userId = process.env.MATRIX_BOT_USER_ID;
    if (!userId) {
      throw new Error('MATRIX_BOT_USER_ID must be set alongside MATRIX_BOT_ACCESS_TOKEN');
    }
    return createClient({ baseUrl: homeserverUrl, accessToken, userId });
  }

  const username = process.env.MATRIX_BOT_USERNAME;
  const password = process.env.MATRIX_BOT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'Set either MATRIX_BOT_ACCESS_TOKEN + MATRIX_BOT_USER_ID, or MATRIX_BOT_USERNAME + MATRIX_BOT_PASSWORD'
    );
  }

  const loginClient = createClient({ baseUrl: homeserverUrl });
  const res = await loginClient.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  });
  return createClient({ baseUrl: homeserverUrl, accessToken: res.access_token, userId: res.user_id });
}

async function createBotClient(): Promise<MatrixClient> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  if (!homeserverUrl) {
    throw new Error('MATRIX_HOMESERVER_URL must be set');
  }

  const mx = await loginBot(homeserverUrl);

  mx.on(RoomMemberEvent.Membership, (_event, member) => {
    if (member.userId === mx.getUserId() && member.membership === 'invite') {
      mx.joinRoom(member.roomId).catch((err: unknown) => {
        console.error(`Failed to auto-join room ${member.roomId}`, err);
      });
    }
  });

  await new Promise<void>((resolve) => {
    const onSync = (state: string) => {
      if (state === 'PREPARED') {
        mx.removeListener(ClientEvent.Sync, onSync);
        resolve();
      }
    };
    mx.on(ClientEvent.Sync, onSync);
    void mx.startClient({ lazyLoadMembers: true });
  });

  console.log(`Service bot ${mx.getUserId()} ready.`);

  joinPendingInvites(mx); // catch anything already pending before this process even started
  setInterval(() => joinPendingInvites(mx), RECONCILE_INTERVAL_MS);

  return mx;
}

function getBotClient(): Promise<MatrixClient> {
  if (!botClientPromise) {
    botClientPromise = createBotClient();
  }
  return botClientPromise;
}

export type MembershipResult = { isMember: boolean; powerLevel: number };

export async function checkMembership(userId: string, roomId: string): Promise<MembershipResult> {
  const mx = await getBotClient();
  const room = mx.getRoom(roomId);
  if (!room) {
    console.warn(`Bot is not joined to room ${roomId} — invite it there so voice auth can work.`);
    return { isMember: false, powerLevel: 0 };
  }

  const member = room.getMember(userId);
  if (!member || member.membership !== 'join') {
    return { isMember: false, powerLevel: 0 };
  }

  return { isMember: true, powerLevel: member.powerLevel };
}
