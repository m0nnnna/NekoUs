import type { MatrixClient, Room } from 'matrix-js-sdk';
import { canInviteToRoom } from './permissions';
import type { VoiceServerConfig } from './voice';

/**
 * Everything to do with the token server's membership-checking service account (see
 * docs/voice-architecture.md and services/token-server/src/membership.ts).
 *
 * The bot has to be a joined member of a voice channel's *room* before it can answer "is this
 * caller allowed in?" — and Matrix invites don't cascade from a Space to its children, so
 * joining a Space never gets the bot into the voice channels inside it. That left every voice
 * channel needing a manual, room-scoped invite of an account whose ID isn't shown anywhere in
 * the app, which is the single thing that made voice feel un-seamless: create a voice channel,
 * click it, get a 403. This module is the automatic version of that step.
 */

type VoiceServerSelfDescription = { botUserId?: string };

/** Membership values that mean "the bot is in, or on its way in" — no invite needed. */
const SETTLED_MEMBERSHIPS = new Set(['join', 'invite']);

/**
 * Asks a token server which Matrix account it runs its membership checks as
 * (`GET /api/livekit/config`, added alongside this). Derived from the token endpoint's origin
 * rather than configured separately, exactly like the participants endpoint already is.
 * Resolves to undefined rather than throwing — an older token server that doesn't serve this
 * endpoint is a reason to fall back to manual invites, not to fail the whole settings save.
 */
export async function fetchVoiceBotUserId(tokenEndpoint: string): Promise<string | undefined> {
  try {
    const origin = new URL(tokenEndpoint).origin;
    const res = await fetch(`${origin}/api/livekit/config`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as VoiceServerSelfDescription;
    return data.botUserId || undefined;
  } catch {
    return undefined;
  }
}

/** The server-name half of a Matrix ID (`@user:server`, `!room:server`, ports included). */
export function serverNameOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(colon + 1);
}

/**
 * Whether the token server could serve this room at all, from what the client already knows.
 *
 * The token server only acts for rooms created on its bot's own homeserver
 * (services/token-server/src/tenancy.ts), and a room ID's server half names the homeserver that
 * created it. Worth checking here rather than leaving to the round trip, because the failure is
 * otherwise indistinguishable from a bot that hasn't joined yet: the client invites the bot, the
 * invite is accepted by the homeserver, the bot ignores it, and the retry loop waits out its
 * full timeout for something no invite could ever fix.
 *
 * True when there's no bot ID to compare against — an unknown answer isn't a "no".
 */
export function isRoomOnBotHomeserver(roomId: string, botUserId: string | undefined): boolean {
  if (!botUserId) return true;
  return serverNameOf(roomId) === serverNameOf(botUserId);
}

export type VoiceBotPresence =
  /** Already joined, or invited and about to be — nothing to do. */
  | { status: 'present' }
  /** Not in the room, and this user has the power level to fix that. */
  | { status: 'missing'; canInvite: true }
  /** Not in the room, and this user can't invite — only an admin can unblock it. */
  | { status: 'missing'; canInvite: false }
  /** No bot ID configured for this Space at all, so there's nothing to check against. */
  | { status: 'unknown' };

export function voiceBotPresence(
  mx: MatrixClient,
  room: Room,
  voiceServer: VoiceServerConfig | undefined
): VoiceBotPresence {
  const botUserId = voiceServer?.botUserId;
  if (!botUserId) return { status: 'unknown' };

  const membership = room.getMember(botUserId)?.membership;
  if (membership && SETTLED_MEMBERSHIPS.has(membership)) return { status: 'present' };

  return { status: 'missing', canInvite: canInviteToRoom(room, mx.getUserId() ?? '') };
}

/**
 * Invites the bot into a room if it isn't there already. Resolves to whether the bot can be
 * expected to show up — `false` means it's missing and this user can't do anything about it,
 * which is what the call UI turns into "ask a server admin" rather than a bare 403.
 *
 * Used for two different rooms. A **Space**, when an admin saves its voice settings: the token
 * server will only serve channels belonging to a Space its bot has joined, so that invite is
 * what makes voice work in the Space at all. And a **voice channel**, as the path in for a
 * channel created before its Space had a voice server, or one the bot was removed from.
 *
 * An invite that *fails* still resolves true when the bot turns out to be in the room already:
 * two people clicking the same new voice channel at once both try, and the loser of that race
 * gets an error describing a state that is, for its purposes, exactly right.
 */
export async function ensureVoiceBotInvited(
  mx: MatrixClient,
  room: Room,
  voiceServer: VoiceServerConfig | undefined
): Promise<boolean> {
  const presence = voiceBotPresence(mx, room, voiceServer);
  if (presence.status === 'present') return true;
  // Nothing configured to invite: leave it to the token server to say whether voice works here.
  if (presence.status === 'unknown') return true;
  if (!presence.canInvite) return false;

  try {
    await mx.invite(room.roomId, voiceServer!.botUserId!);
    return true;
  } catch {
    return voiceBotPresence(mx, room, voiceServer).status === 'present';
  }
}
