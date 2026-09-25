import { describe, expect, it } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { buildPostContent, canRepost, readPost, repostOfPost, toEventContent, type RepostOf } from './feed';
import { toggleFollow } from './follows';

const image = { kind: 'image' as const, url: 'mxc://x/a', name: 'a.webp', info: { mimetype: 'image/webp', size: 10, w: 4, h: 3 } };

function postEvent(content: Record<string, unknown>) {
  return new MatrixEvent({ type: 'xyz.nekous.post', event_id: '$p', sender: '@ana:x', room_id: '!f:x', content });
}

const original: RepostOf = {
  roomId: '!profile-ana:x',
  eventId: '$orig',
  sender: '@ana:x',
  senderName: 'Ana',
  origin: { kind: 'global' },
  ts: 100,
  body: 'the original',
  attachments: [image],
};

describe('posts with media', () => {
  it('round-trips attachments through the event content', () => {
    const content = buildPostContent('look', undefined, { attachments: [image] });
    const read = readPost(postEvent(toEventContent(content)));
    expect(read).toEqual({ body: 'look', attachments: [image] });
  });

  it('accepts a media-only post with no text', () => {
    expect(readPost(postEvent(toEventContent(buildPostContent('', undefined, { attachments: [image] }))))).toEqual({
      body: '',
      attachments: [image],
    });
  });

  it('still rejects a post with nothing in it', () => {
    expect(readPost(postEvent({ body: '' }))).toBeUndefined();
  });
});

describe('reposts', () => {
  it('round-trips the embedded original, media included', () => {
    const content = buildPostContent('', undefined, { repostOf: original });
    expect(readPost(postEvent(toEventContent(content)))?.repostOf).toEqual(original);
  });

  it('drops a malformed embed instead of rendering half of one', () => {
    expect(readPost(postEvent({ body: 'hi', 'xyz.nekous.repost_of': { eventId: '$x' } }))).toEqual({ body: 'hi' });
  });

  it('reposting a bare repost reposts the original, so reposts never nest', () => {
    const bareRepost = buildPostContent('', undefined, { repostOf: original });
    const meta = { roomId: '!f:x', eventId: '$r', sender: '@ben:x', senderName: 'Ben', origin: { kind: 'global' as const }, ts: 200 };
    expect(repostOfPost(meta, bareRepost)).toEqual(original);
  });

  it('reposting a repost with a comment quotes the comment', () => {
    const commented = buildPostContent('so good', undefined, { repostOf: original });
    const meta = { roomId: '!f:x', eventId: '$r', sender: '@ben:x', senderName: 'Ben', origin: { kind: 'global' as const }, ts: 200 };
    const result = repostOfPost(meta, commented);
    expect(result.eventId).toBe('$r');
    expect(result.body).toBe('so good');
  });

  it('only moves posts between public places', () => {
    const globalOrigin = { kind: 'global' as const };
    const spaceOrigin = { kind: 'space' as const, spaceId: '!s:x', spaceName: 'S' };
    expect(canRepost(globalOrigin, true, spaceOrigin, true)).toBe(true);
    expect(canRepost(spaceOrigin, true, globalOrigin, true)).toBe(true);
    expect(canRepost(spaceOrigin, false, globalOrigin, true)).toBe(false); // out of a private Space
    expect(canRepost(globalOrigin, true, spaceOrigin, false)).toBe(false); // into a private Space
  });
});

describe('toggleFollow', () => {
  it('adds, then removes', () => {
    const once = toggleFollow({ users: [], spaces: [] }, 'user', '@ana:x');
    expect(once).toEqual({ users: ['@ana:x'], spaces: [] });
    expect(toggleFollow(once, 'user', '@ana:x')).toEqual({ users: [], spaces: [] });
  });

  it('keeps people and Spaces separate', () => {
    expect(toggleFollow({ users: ['@ana:x'], spaces: [] }, 'space', '!s:x')).toEqual({ users: ['@ana:x'], spaces: ['!s:x'] });
  });
});
