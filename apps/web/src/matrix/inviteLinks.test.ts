import { describe, expect, it } from 'vitest';
import { buildInviteLink } from './inviteLinks';

describe('buildInviteLink', () => {
  it('builds a same-origin link carrying the room ID and a via server as query params', () => {
    const link = buildInviteLink('!abc123:example.org', 'example.org');
    const url = new URL(link);
    expect(url.origin).toBe(window.location.origin);
    expect(url.searchParams.get('invite')).toBe('!abc123:example.org');
    expect(url.searchParams.get('via')).toBe('example.org');
  });
});
