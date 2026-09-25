import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MatrixClientContext } from '../../matrix/MatrixClientContext';
import { TypingIndicator } from './TypingIndicator';

let typing: { userId: string; name: string }[] = [];
vi.mock('../../matrix/hooks/useTypingMembers', () => ({ useTypingMembers: () => typing }));

const profiles: Record<string, Record<string, unknown>> = {
  '@alice:x': { 'xyz.nekous.typing_verb': 'yelling' },
  '@carol:x': { 'xyz.nekous.typing_verb': 'is purring…\n' },
};
const getExtendedProfile = vi.fn(async (userId: string) => {
  if (userId === '@noprofiles:x') throw new Error('M_UNRECOGNIZED');
  return profiles[userId] ?? {};
});
const mx = { getExtendedProfile } as never;

function show() {
  return render(
    <MatrixClientContext.Provider value={mx}>
      <TypingIndicator roomId="!room:x" />
    </MatrixClientContext.Provider>
  );
}
const text = (container: HTMLElement) => container.querySelector('[data-nu-role="typing-indicator"] span')?.textContent;

afterEach(() => {
  cleanup();
  typing = [];
});

describe('TypingIndicator', () => {
  it("shows someone's own typing status", async () => {
    typing = [{ userId: '@alice:x', name: 'Alice' }];
    const { container } = show();
    await waitFor(() => expect(text(container)).toBe('Alice is yelling…'));
  });

  it('says "typing" for someone without one, and on a server without extended profiles', async () => {
    typing = [
      { userId: '@bob:x', name: 'Bob' },
      { userId: '@noprofiles:x', name: 'Dee' },
    ];
    const { container } = show();
    await waitFor(() => expect(getExtendedProfile).toHaveBeenCalledWith('@noprofiles:x'));
    expect(text(container)).toBe('Bob and Dee are typing…');
  });

  it('cleans up what it reads from someone else’s profile', async () => {
    typing = [
      { userId: '@carol:x', name: 'Carol' },
      { userId: '@bob:x', name: 'Bob' },
    ];
    const { container } = show();
    await waitFor(() => expect(text(container)).toBe('Carol is purring and Bob is typing…'));
  });

  it('reads each person’s profile once, not on every keystroke', async () => {
    getExtendedProfile.mockClear();
    typing = [{ userId: '@alice:x', name: 'Alice' }];
    const first = show();
    await waitFor(() => expect(text(first.container)).toBe('Alice is yelling…'));
    cleanup();
    const second = show();
    await waitFor(() => expect(text(second.container)).toBe('Alice is yelling…'));
    expect(getExtendedProfile.mock.calls.filter((call) => call[0] === '@alice:x')).toHaveLength(0);
  });
});
