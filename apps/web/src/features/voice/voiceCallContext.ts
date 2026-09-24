import { createContext, useContext } from 'react';
import type { VoiceConnectionState } from '../../matrix/hooks/useVoiceConnection';

export type VoiceCallContextValue = {
  /** The voice channel's Matrix room ID this call belongs to. */
  roomId: string;
  state: VoiceConnectionState;
  deafened: boolean;
  setDeafened: (deafened: boolean) => void;
  /** Actually disconnects from LiveKit and clears the active-call state. */
  leave: () => void;
  /** Re-runs the token fetch for this same channel — what the error state's "Try again" needs.
   *  Re-selecting the channel can't do this job: it's already the selected one, so setting that
   *  atom to the value it already holds is a no-op and the button did nothing at all. */
  retry: () => void;
};

/** Populated only while a voice call is active — see VoiceCallSession, which is the sole
 *  writer. `null` outside of any call (or before VoiceCallSession has one to report). */
export const VoiceCallContext = createContext<VoiceCallContextValue | null>(null);

/** The currently active voice call, if any — usable anywhere under AppShell regardless of
 *  which channel is selected/viewed (e.g. to show a persistent connected-call bar, or to
 *  render the call UI only when the viewed channel matches). */
export function useVoiceCall(): VoiceCallContextValue | null {
  return useContext(VoiceCallContext);
}
