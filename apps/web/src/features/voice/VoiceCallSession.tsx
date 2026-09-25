import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import type { Room as MatrixRoom } from 'matrix-js-sdk';
import { activeVoiceChannelIdAtom } from '../../app/state/selection';
import { useRoom } from '../../matrix/hooks/useRoom';
import { useVoiceConnection } from '../../matrix/hooks/useVoiceConnection';
import { VoiceCallContext, type VoiceCallContextValue } from './voiceCallContext';
import { playConnectedSound, playDisconnectedSound, warmUpAudioContext } from './voiceSounds';
import { validateScreenShareCodecSupport, voiceChannelRoomOptions } from './voiceChannelRoomOptions';
import { WatchTogetherProvider } from './watchTogetherContext';

/**
 * Owns the active voice call for the whole app, mounted once above ChannelList/MainPane in
 * AppShell — so it keeps running (and keeps its LiveKit connection alive) no matter what the
 * user navigates to elsewhere, the way Discord lets you keep chatting in a text channel while
 * still in a voice call. Descendants (MainPane's call UI, a connected-call indicator in
 * ChannelList) read the call via `useVoiceCall()` rather than owning any connection state
 * themselves.
 */
export function VoiceCallSession({ children }: { children: ReactNode }) {
  const activeVoiceChannelId = useAtomValue(activeVoiceChannelIdAtom);
  const room = useRoom(activeVoiceChannelId);

  if (!room) {
    return <>{children}</>;
  }
  return <ActiveVoiceCall room={room}>{children}</ActiveVoiceCall>;
}

function ActiveVoiceCall({ room, children }: { room: MatrixRoom; children: ReactNode }) {
  const setActiveVoiceChannelId = useSetAtom(activeVoiceChannelIdAtom);
  const { state, voiceServer, connect, disconnect } = useVoiceConnection(room);
  const [deafened, setDeafened] = useState(false);
  const autoConnectedKeyRef = useRef<string | null>(null);

  // Auto-join whenever the active room actually changes — selecting a voice channel (or
  // switching from one to another) is the join action now, there's no separate button for it.
  //
  // Keyed on the voice server too, not just the room: the Space's config is read out of room
  // state, which on a cold sync can still be loading when the channel is first selected. Keying
  // on the room alone meant that one-shot attempt happened while there was nothing to connect
  // to, and the call sat on "No voice server is configured" forever even once it had loaded.
  useEffect(() => {
    if (!voiceServer) return;
    const key = `${room.roomId}|${voiceServer.tokenEndpoint}`;
    if (autoConnectedKeyRef.current === key) return;
    autoConnectedKeyRef.current = key;
    warmUpAudioContext();
    validateScreenShareCodecSupport();
    connect();
  }, [room.roomId, voiceServer, connect]);

  const leave = useCallback(() => {
    disconnect();
    setActiveVoiceChannelId(null);
  }, [disconnect, setActiveVoiceChannelId]);

  const retry = useCallback(() => {
    void connect();
  }, [connect]);

  const ctxValue = useMemo<VoiceCallContextValue>(
    () => ({ roomId: room.roomId, state, deafened, setDeafened, leave, retry }),
    [room.roomId, state, deafened, leave, retry]
  );

  if (state.status !== 'ready') {
    return <VoiceCallContext.Provider value={ctxValue}>{children}</VoiceCallContext.Provider>;
  }

  return (
    <LiveKitRoom
      serverUrl={state.serverUrl}
      token={state.token}
      connect
      audio
      options={voiceChannelRoomOptions}
      onConnected={() => playConnectedSound()}
      onDisconnected={() => {
        playDisconnectedSound();
        leave();
      }}
      style={{ display: 'contents' }}
      data-nu-role="voice-session"
    >
      <RoomAudioRenderer muted={deafened} />
      <VoiceCallContext.Provider value={ctxValue}>
        <WatchTogetherProvider>{children}</WatchTogetherProvider>
      </VoiceCallContext.Provider>
    </LiveKitRoom>
  );
}
