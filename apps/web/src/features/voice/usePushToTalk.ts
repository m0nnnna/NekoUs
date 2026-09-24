import { useEffect, useRef, useState } from 'react';
import type { LocalParticipant } from 'livekit-client';

const STORAGE_KEY = 'nekous_ptt_enabled';
const KEY_STORAGE_KEY = 'nekous_ptt_key';
// Right Ctrl by default (not Left) — a key nobody's regular typing or the composer's own
// shortcuts (Enter, Shift+Enter, arrow keys for mentions/commands) ever touches, so push-to-talk
// works the same whether or not the message box happens to be focused. Rebindable from the call
// controls for anyone whose keyboard or habits disagree.
const DEFAULT_PTT_KEY_CODE = 'ControlRight';

/** `KeyboardEvent.code` is a physical-key name, not a character — "ControlRight", "KeyV",
 *  "Space". Trim the boilerplate prefixes so the control bar can show something readable. */
export function pushToTalkKeyLabel(code: string): string {
  return code
    .replace(/^(Key|Digit)/, '') // "KeyV" -> "V", "Digit5" -> "5"
    .replace(/^Numpad/, 'Num ')
    .replace(/^Control/, 'Ctrl')
    .replace(/([a-z])([A-Z])/g, '$1 $2'); // "CtrlRight" -> "Ctrl Right", "ShiftLeft" -> "Shift Left"
}

function readStoredKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE_KEY) || DEFAULT_PTT_KEY_CODE;
  } catch {
    return DEFAULT_PTT_KEY_CODE;
  }
}

export type PushToTalk = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** The bound `KeyboardEvent.code`. */
  key: string;
  keyLabel: string;
  /** True while waiting for the next keypress to bind — see `startRebind`. */
  rebinding: boolean;
  startRebind: () => void;
  cancelRebind: () => void;
};

/**
 * Push-to-talk: while enabled, the mic is muted except while the bound key is physically held.
 * A per-device preference (localStorage, like the custom-theme CSS), not a Matrix/room setting —
 * this is about how *you* want to talk, not something anyone else needs to see.
 */
export function usePushToTalk(localParticipant: LocalParticipant): PushToTalk {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [key, setKey] = useState(readStoredKey);
  const [rebinding, setRebinding] = useState(false);
  const wasEnabledRef = useRef(enabled);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Best-effort — a full/blocked localStorage just means the preference won't survive a
      // reload, not that toggling push-to-talk right now should fail.
    }
  }, [enabled]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY_STORAGE_KEY, key);
    } catch {
      // As above.
    }
  }, [key]);

  // Turning push-to-talk *off* has to hand the mic back. The enabled effect below mutes on the
  // way in and simply stops running on the way out, which left the mic silently muted with a
  // control bar showing an unmuted-looking state — you had to notice and click mute twice.
  useEffect(() => {
    if (wasEnabledRef.current && !enabled) {
      localParticipant.setMicrophoneEnabled(true);
    }
    wasEnabledRef.current = enabled;
  }, [enabled, localParticipant]);

  useEffect(() => {
    if (!enabled || rebinding) return;
    localParticipant.setMicrophoneEnabled(false);

    let keyHeld = false;
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (evt.code !== key || keyHeld) return;
      keyHeld = true;
      localParticipant.setMicrophoneEnabled(true);
    };
    const handleKeyUp = (evt: KeyboardEvent) => {
      if (evt.code !== key) return;
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
      // Release the key if push-to-talk is reconfigured mid-hold, so the mic can't be left
      // stuck open by rebinding while the old key is down.
      if (keyHeld) localParticipant.setMicrophoneEnabled(false);
    };
  }, [enabled, rebinding, key, localParticipant]);

  // Rebinding swallows the next keypress rather than acting on it, so binding a key that means
  // something else in the app (Escape cancels instead) doesn't also trigger that other thing.
  useEffect(() => {
    if (!rebinding) return;

    const capture = (evt: KeyboardEvent) => {
      evt.preventDefault();
      evt.stopPropagation();
      setRebinding(false);
      if (evt.code !== 'Escape') setKey(evt.code);
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [rebinding]);

  return {
    enabled,
    setEnabled,
    key,
    keyLabel: pushToTalkKeyLabel(key),
    rebinding,
    startRebind: () => setRebinding(true),
    cancelRebind: () => setRebinding(false),
  };
}
