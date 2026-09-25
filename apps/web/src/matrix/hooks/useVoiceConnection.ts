import { useCallback, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { canSendStateEvent } from '../permissions';
import { getParentSpace, setVoiceServerConfig, type VoiceServerConfig } from '../voice';
import { ensureVoiceBotInvited, fetchVoiceBotUserId, isRoomOnBotHomeserver, serverNameOf } from '../voiceBot';
import { roomOriginServer } from '../roomOrigin';
import { useSpaceVoiceServer } from './useSpaceVoiceServer';

export type VoiceConnectionState =
  | { status: 'idle' }
  | { status: 'connecting' }
  /** Waiting on the service bot to accept its invite — see the retry loop below. */
  | { status: 'preparing'; message: string }
  | { status: 'ready'; serverUrl: string; token: string }
  | { status: 'error'; message: string };

type TokenResponse = { token?: string; roomName?: string; error?: string; code?: string; botUserId?: string };

/**
 * How long to keep retrying while the token server reports its membership bot isn't in the room
 * yet. The bot joins off a live sync event, so in practice it lands within a second or two of
 * the invite — this just has to outlast a slow homeserver round trip, not a bot restart.
 */
const BOT_JOIN_RETRY_ATTEMPTS = 8;
const BOT_JOIN_RETRY_DELAY_MS = 1500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches a LiveKit join token for a voice channel — mints it via the Space's configured token
 * server, gated on real Matrix room membership there (see services/token-server). This hook only
 * owns the token fetch/lifecycle; the actual RTC connection is handled declaratively by
 * `<LiveKitRoom>` in VoiceCallSession once `status === 'ready'`.
 *
 * It also owns getting the token server's service bot into the room, because that's a
 * precondition for the token fetch rather than a separate piece of setup: a Space membership
 * doesn't reach the Space's channels, so a voice channel the bot was never invited to can't
 * authorize anyone. New voice channels invite it at creation (CreateChannelModal), so this path
 * mostly covers channels that predate that — but it's also the backstop for an invite that was
 * revoked, or a Space whose voice server was configured after its channels already existed.
 */
export function useVoiceConnection(room: Room) {
  const mx = useMatrixClient();
  const space = getParentSpace(mx, room);
  const voiceServer = useSpaceVoiceServer(space);
  const [state, setState] = useState<VoiceConnectionState>({ status: 'idle' });
  const requestIdRef = useRef(0);

  const connect = useCallback(async () => {
    if (!voiceServer) {
      setState({ status: 'error', message: 'No voice server is configured for this server yet.' });
      return;
    }

    const requestId = ++requestIdRef.current;
    const superseded = () => requestId !== requestIdRef.current;
    setState({ status: 'connecting' });

    const requestToken = async (): Promise<TokenResponse & { httpStatus: number }> => {
      const openIdToken = await mx.getOpenIdToken();
      const res = await fetch(voiceServer.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid_token: openIdToken, room_id: room.roomId }),
      });
      const data = (await res.json().catch(() => ({}))) as TokenResponse;
      return { ...data, httpStatus: res.status };
    };

    /**
     * A Space configured before the bot's ID was part of that config has no way to invite it,
     * so ask the token server itself and — if this user can write Space state — save the answer
     * for everyone. That's what lets an existing deployment start working without an admin
     * knowing to go and re-save Space Settings first.
     */
    const withBotUserId = async (): Promise<VoiceServerConfig> => {
      if (voiceServer.botUserId) return voiceServer;
      const botUserId = await fetchVoiceBotUserId(voiceServer.tokenEndpoint);
      if (!botUserId) return voiceServer;

      const resolved = { ...voiceServer, botUserId };
      if (space && canSendStateEvent(space, mx.getUserId() ?? '', 'xyz.nekous.voice_server')) {
        setVoiceServerConfig(mx, space, resolved).catch((err: unknown) => {
          // Best-effort persistence — this connection already has what it needs either way.
          console.error('Failed to save the discovered voice service account', err);
        });
      }
      return resolved;
    };

    /**
     * The bot needs to be in two rooms, not one. The channel, to read who's in it — and the
     * Space, because that's what the token server treats as permission to serve the channels
     * inside it at all (services/token-server/src/tenancy.ts). Space Settings sends the Space
     * invite when voice is configured; doing it here too is what lets a Space set up before that
     * existed start working without an admin knowing to go and re-save anything.
     *
     * The Space invite's own success isn't what's returned: failing it is recoverable (the retry
     * loop below waits, and an admin can always fix it), while a channel the bot can't get into
     * is the state the call UI has to report.
     */
    const ensureBotPresent = async (config: VoiceServerConfig): Promise<boolean> => {
      if (space) await ensureVoiceBotInvited(mx, space, config);
      return ensureVoiceBotInvited(mx, room, config);
    };

    try {
      let resolvedVoiceServer = await withBotUserId();
      if (superseded()) return;

      // Answered before the first request, because the round trip can't say anything better: the
      // token server refuses a room its own homeserver didn't create, and no amount of inviting
      // or waiting changes which homeserver a room was created on.
      if (!isRoomOnBotHomeserver(roomOriginServer(room), resolvedVoiceServer.botUserId)) {
        setState({
          status: 'error',
          message:
            `This channel lives on ${roomOriginServer(room)}, but this space's voice server only ` +
            `serves channels created on ${serverNameOf(resolvedVoiceServer.botUserId ?? '')}. ` +
            'Ask someone with an account there to create the channel instead.',
        });
        return;
      }

      // Get the bot in before asking, so the common case is one round trip and no retry loop at
      // all. Its own "already there?" check makes this free when there's nothing to do.
      let botCanBeExpected = await ensureBotPresent(resolvedVoiceServer);
      if (superseded()) return;

      for (let attempt = 0; attempt < BOT_JOIN_RETRY_ATTEMPTS; attempt += 1) {
        const data = await requestToken();
        if (superseded()) return;

        if (data.token) {
          setState({ status: 'ready', serverUrl: voiceServer.url, token: data.token });
          return;
        }

        if (data.code === 'voice_bot_not_in_room') {
          // The rejection names the bot, so a Space with nothing configured — and a token server
          // we couldn't reach for a config lookup a moment ago — still gets one honest attempt
          // at the invite rather than looping until the retries run out.
          if (!resolvedVoiceServer.botUserId && data.botUserId) {
            resolvedVoiceServer = { ...resolvedVoiceServer, botUserId: data.botUserId };
            botCanBeExpected = await ensureBotPresent(resolvedVoiceServer);
            if (superseded()) return;
          }

          // The bot is invited (or we just invited it) and hasn't acted on it yet — wait it out
          // rather than reporting a failure the user can't interpret or act on.
          if (!botCanBeExpected) {
            setState({
              status: 'error',
              message: data.botUserId
                ? `Voice isn't set up for this channel yet — ask a server admin to invite ${data.botUserId} to it.`
                : "Voice isn't set up for this channel yet — ask a server admin to finish setting it up.",
            });
            return;
          }
          setState({ status: 'preparing', message: 'Setting up voice for this channel…' });
          await delay(BOT_JOIN_RETRY_DELAY_MS);
          if (superseded()) return;
          continue;
        }

        if (data.code === 'room_not_served') {
          // The token server only authorizes channels belonging to a Space its bot has joined.
          // Right after an admin turns voice on, that join can still be settling — which is the
          // same "setting up" state as an un-joined bot, not a misconfiguration. Once the bot
          // *is* in the Space and the answer is still no, waiting won't change it.
          const botSettledInSpace =
            space && resolvedVoiceServer.botUserId
              ? space.getMember(resolvedVoiceServer.botUserId)?.membership === 'join'
              : true;
          if (!botSettledInSpace) {
            setState({ status: 'preparing', message: 'Setting up voice for this channel…' });
            await delay(BOT_JOIN_RETRY_DELAY_MS);
            if (superseded()) return;
            continue;
          }
          setState({
            status: 'error',
            message:
              "This channel isn't served by this space's voice server — ask a server admin to re-save " +
              'the space’s voice settings, which puts the voice account back into the space.',
          });
          return;
        }

        setState({
          status: 'error',
          message: data.error ?? `Failed to join voice channel (${data.httpStatus})`,
        });
        return;
      }

      setState({
        status: 'error',
        message: "Voice is still setting up for this channel — the voice service bot hasn't joined yet. Try again in a moment.",
      });
    } catch (err) {
      if (superseded()) return;
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to join voice channel' });
    }
  }, [mx, room, space, voiceServer]);

  const disconnect = useCallback(() => {
    requestIdRef.current += 1; // invalidate any in-flight connect()
    setState({ status: 'idle' });
  }, []);

  return { state, voiceServer, connect, disconnect };
}
