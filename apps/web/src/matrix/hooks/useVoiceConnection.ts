import { useCallback, useRef, useState } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { getParentSpace } from '../voice';
import { useSpaceVoiceServer } from './useSpaceVoiceServer';

export type VoiceConnectionState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'ready'; serverUrl: string; token: string }
  | { status: 'error'; message: string };

type TokenResponse = { token: string; roomName?: string; error?: string };

/**
 * Fetches a LiveKit join token for a voice channel — mints it via the Space's configured token
 * server, gated on real Matrix room membership there (see services/token-server). This hook only
 * owns the token fetch/lifecycle; the actual RTC connection is handled declaratively by
 * `<LiveKitRoom>` in VoiceChannelPanel once `status === 'ready'`.
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
    setState({ status: 'connecting' });

    try {
      const openIdToken = await mx.getOpenIdToken();
      const res = await fetch(voiceServer.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid_token: openIdToken, room_id: room.roomId }),
      });
      const data = (await res.json().catch(() => ({}))) as TokenResponse;
      if (requestId !== requestIdRef.current) return; // superseded by a newer connect()/disconnect()

      if (!res.ok || !data.token) {
        setState({ status: 'error', message: data.error ?? `Failed to join voice channel (${res.status})` });
        return;
      }

      setState({ status: 'ready', serverUrl: voiceServer.url, token: data.token });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to join voice channel' });
    }
  }, [mx, room, voiceServer]);

  const disconnect = useCallback(() => {
    requestIdRef.current += 1; // invalidate any in-flight connect()
    setState({ status: 'idle' });
  }, []);

  return { state, voiceServer, connect, disconnect };
}
