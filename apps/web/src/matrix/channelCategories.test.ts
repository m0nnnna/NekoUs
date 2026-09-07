import { describe, expect, it, vi } from 'vitest';
import {
  createCategory,
  deleteCategory,
  getChannelCategories,
  moveChannelToCategory,
  renameCategory,
  reorderCategories,
  reorderCategoryChannels,
  type ChannelCategory,
} from './channelCategories';

function fakeSpace(categories: ChannelCategory[] | undefined) {
  return {
    roomId: '!space:example.org',
    currentState: {
      getStateEvents: () => (categories === undefined ? undefined : { getContent: () => ({ categories }) }),
    },
  } as unknown as Parameters<typeof getChannelCategories>[0];
}

function fakeClient() {
  const sendStateEvent = vi.fn().mockResolvedValue(undefined);
  return { sendStateEvent } as unknown as Parameters<typeof createCategory>[0] & { sendStateEvent: typeof sendStateEvent };
}

function sentCategories(mx: ReturnType<typeof fakeClient>): ChannelCategory[] {
  const calls = mx.sendStateEvent.mock.calls;
  return calls[calls.length - 1]?.[2].categories;
}

describe('getChannelCategories', () => {
  it('returns an empty list when no category event has ever been sent', () => {
    expect(getChannelCategories(fakeSpace(undefined))).toEqual([]);
  });

  it('returns the categories from the state event content', () => {
    const categories: ChannelCategory[] = [{ id: 'cat-1', name: 'Text', channelIds: ['!a:example.org'] }];
    expect(getChannelCategories(fakeSpace(categories))).toEqual(categories);
  });
});

describe('createCategory', () => {
  it('appends a new category with a generated id and no channels yet', async () => {
    const mx = fakeClient();
    const space = fakeSpace([{ id: 'cat-1', name: 'Text', channelIds: [] }]);
    await createCategory(mx, space, 'Voice');
    const sent = sentCategories(mx);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ id: 'cat-1', name: 'Text', channelIds: [] });
    expect(sent[1]).toMatchObject({ name: 'Voice', channelIds: [] });
    expect(sent[1].id).toBeTruthy();
  });
});

describe('renameCategory', () => {
  it('renames only the matching category, leaving others and channelIds untouched', async () => {
    const mx = fakeClient();
    const space = fakeSpace([
      { id: 'cat-1', name: 'Text', channelIds: ['!a:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: [] },
    ]);
    await renameCategory(mx, space, 'cat-1', 'Announcements');
    expect(sentCategories(mx)).toEqual([
      { id: 'cat-1', name: 'Announcements', channelIds: ['!a:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: [] },
    ]);
  });
});

describe('deleteCategory', () => {
  it('removes the category — its channels simply become uncategorized, no other bookkeeping', async () => {
    const mx = fakeClient();
    const space = fakeSpace([
      { id: 'cat-1', name: 'Text', channelIds: ['!a:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: [] },
    ]);
    await deleteCategory(mx, space, 'cat-1');
    expect(sentCategories(mx)).toEqual([{ id: 'cat-2', name: 'Voice', channelIds: [] }]);
  });
});

describe('reorderCategories', () => {
  it('reorders categories to match the given id order', async () => {
    const mx = fakeClient();
    const space = fakeSpace([
      { id: 'cat-1', name: 'Text', channelIds: [] },
      { id: 'cat-2', name: 'Voice', channelIds: [] },
    ]);
    await reorderCategories(mx, space, ['cat-2', 'cat-1']);
    expect(sentCategories(mx).map((c) => c.id)).toEqual(['cat-2', 'cat-1']);
  });
});

describe('moveChannelToCategory', () => {
  it('moves a channel from one category into another, removing it from the first', async () => {
    const mx = fakeClient();
    const space = fakeSpace([
      { id: 'cat-1', name: 'Text', channelIds: ['!a:example.org', '!b:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: [] },
    ]);
    await moveChannelToCategory(mx, space, '!a:example.org', 'cat-2');
    expect(sentCategories(mx)).toEqual([
      { id: 'cat-1', name: 'Text', channelIds: ['!b:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: ['!a:example.org'] },
    ]);
  });

  it('uncategorizes a channel when given null, without adding it anywhere', async () => {
    const mx = fakeClient();
    const space = fakeSpace([{ id: 'cat-1', name: 'Text', channelIds: ['!a:example.org'] }]);
    await moveChannelToCategory(mx, space, '!a:example.org', null);
    expect(sentCategories(mx)).toEqual([{ id: 'cat-1', name: 'Text', channelIds: [] }]);
  });
});

describe('reorderCategoryChannels', () => {
  it('replaces one category\'s channelIds order, leaving other categories untouched', async () => {
    const mx = fakeClient();
    const space = fakeSpace([
      { id: 'cat-1', name: 'Text', channelIds: ['!a:example.org', '!b:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: ['!c:example.org'] },
    ]);
    await reorderCategoryChannels(mx, space, 'cat-1', ['!b:example.org', '!a:example.org']);
    expect(sentCategories(mx)).toEqual([
      { id: 'cat-1', name: 'Text', channelIds: ['!b:example.org', '!a:example.org'] },
      { id: 'cat-2', name: 'Voice', channelIds: ['!c:example.org'] },
    ]);
  });
});
