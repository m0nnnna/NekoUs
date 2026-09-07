import { useEffect, useState } from 'react';
import type { VoiceServerConfig } from '../voice';

const POLL_INTERVAL_MS = 5000;

export type VoiceChannelParticipant = {
  /** Matrix user ID (LiveKit identities are Matrix user IDs — see services/token-server). */
  identity: string;
  micMuted: boolean;
  /** Broadcast via the participant's own LiveKit attributes — see
   *  VoiceChannelPanel.tsx's toggleDeafen; there's no server-side signal for this. */
  deafened: boolean;
};

/**
 * Polls services/token-server's `GET /api/livekit/rooms/participants` — queried live from
 * LiveKit itself on each call (see docs/voice-architecture.md's "LiveKit room lifecycle"), so
 * it reflects current membership and mic/deafen state, not a point-in-time snapshot. Returns
 * raw identities, not resolved to a display name/avatar — the caller has the room membership
 * for that.
 */
export function useVoiceChannelParticipants(
  roomId: string,
  voiceServer: VoiceServerConfig | undefined
): VoiceChannelParticipant[] {
  const [participants, setParticipants] = useState<VoiceChannelParticipant[]>([]);

  useEffect(() => {
    if (!voiceServer) {
      setParticipants([]);
      return undefined;
    }

    let cancelled = false;
    const origin = new URL(voiceServer.tokenEndpoint).origin;
    const url = `${origin}/api/livekit/rooms/participants?roomIds=${encodeURIComponent(roomId)}`;

    const poll = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Record<string, VoiceChannelParticipant[]>;
        if (!cancelled) setParticipants(data[roomId] ?? []);
      } catch {
        // Transient network errors just leave the last-known list showing.
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, voiceServer]);

  return participants;
}
