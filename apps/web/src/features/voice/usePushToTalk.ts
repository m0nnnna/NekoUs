import { useEffect, useState } from 'react';
import type { LocalParticipant } from 'livekit-client';

const STORAGE_KEY = 'nekous_ptt_enabled';
// Right Ctrl specifically (not Left) — a key nobody's regular typing or the composer's own
// shortcuts (Enter, Shift+Enter, arrow keys for mentions/commands) ever touches, so push-to-talk
// works the same whether or not the message box happens to be focused.
const PTT_KEY_CODE = 'ControlRight';

/**
 * Push-to-talk: while enabled, the mic is muted except while PTT_KEY_CODE is physically held.
 * A per-device preference (localStorage, like the custom-theme CSS), not a Matrix/room setting —
 * this is about how *you* want to talk, not something anyone else needs to see.
 */
export function usePushToTalk(localParticipant: LocalParticipant): {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
} {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    localParticipant.setMicrophoneEnabled(false);

    let keyHeld = false;
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.code !== PTT_KEY_CODE || keyHeld) return;
      keyHeld = true;
      localParticipant.setMicrophoneEnabled(true);
    };
    const handleKeyUp = (evt: KeyboardEvent) => {
      if (evt.code !== PTT_KEY_CODE) return;
      keyHeld = false;
      localParticipant.setMicrophoneEnabled(false);
    };
    // capture: true — a key released while focus has moved to a different element (or none)
    // still needs to register; bubble-phase listeners can silently miss that.
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [enabled, localParticipant]);

  return { enabled, setEnabled };
}
