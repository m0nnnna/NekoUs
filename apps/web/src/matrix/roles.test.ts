import { describe, expect, it } from 'vitest';
import { handleFor, roleFor } from './roles';

describe('roleFor', () => {
  it('maps power levels to the highest role they reach', () => {
    expect(roleFor(100).id).toBe('admin');
    expect(roleFor(150).id).toBe('admin');
    expect(roleFor(50).id).toBe('moderator');
    expect(roleFor(99).id).toBe('moderator');
    expect(roleFor(0).id).toBe('member');
    expect(roleFor(10).id).toBe('member');
  });

  it('treats negative power levels as members', () => {
    expect(roleFor(-5).id).toBe('member');
  });
});

describe('handleFor', () => {
  it('strips the server name from a Matrix ID', () => {
    expect(handleFor('@neko:example.org')).toBe('@neko');
  });

  it('leaves an ID without a server part alone', () => {
    expect(handleFor('@neko')).toBe('@neko');
  });
});
