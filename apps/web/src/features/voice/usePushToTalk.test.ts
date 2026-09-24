import { describe, expect, it } from 'vitest';
import { pushToTalkKeyLabel } from './usePushToTalk';

describe('pushToTalkKeyLabel', () => {
  // KeyboardEvent.code is a physical-key name, not a character — shown as-is it reads like an
  // internal identifier ("ControlRight") rather than the key the user is being asked to hold.
  it('reads back the default binding as a key someone can find on a keyboard', () => {
    expect(pushToTalkKeyLabel('ControlRight')).toBe('Ctrl Right');
  });

  it('strips the Key/Digit prefixes off ordinary keys', () => {
    expect(pushToTalkKeyLabel('KeyV')).toBe('V');
    expect(pushToTalkKeyLabel('Digit5')).toBe('5');
  });

  it('keeps side-specific modifiers distinguishable', () => {
    expect(pushToTalkKeyLabel('ShiftLeft')).toBe('Shift Left');
    expect(pushToTalkKeyLabel('AltRight')).toBe('Alt Right');
  });

  it('leaves a code that is already a plain name alone', () => {
    expect(pushToTalkKeyLabel('Space')).toBe('Space');
    expect(pushToTalkKeyLabel('Backquote')).toBe('Backquote');
  });

  it('labels numpad keys without running them together', () => {
    expect(pushToTalkKeyLabel('Numpad0')).toBe('Num 0');
  });
});
