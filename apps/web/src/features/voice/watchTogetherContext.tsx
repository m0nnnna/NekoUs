import { createContext, useContext, type ReactNode } from 'react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { useWatchTogether, type WatchTogetherControls } from './useWatchTogether';

const WatchTogetherContext = createContext<WatchTogetherControls | null>(null);

/**
 * Holds the call's shared Watch/Listen together session for as long as the call lasts. Mounted
 * inside the LiveKit room in VoiceCallSession, above everything — so the call's pane and the
 * Now playing card beside the call bar read the same session, and it keeps going whichever
 * channel is on screen.
 */
export function WatchTogetherProvider({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const controls = useWatchTogether(room, localParticipant.identity);
  return <WatchTogetherContext.Provider value={controls}>{children}</WatchTogetherContext.Provider>;
}

/** The call's shared session and its controls; null outside a connected call. */
export function useSharedWatchTogether(): WatchTogetherControls | null {
  return useContext(WatchTogetherContext);
}
