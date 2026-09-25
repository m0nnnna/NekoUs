import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { openPostAtom } from '../../app/state/selection';
import { MatrixClientContext } from '../../matrix/MatrixClientContext';
import type { PostComment } from '../../matrix/postInteractions';
import { InteractivePost } from './InteractivePost';

const comment = (i: number, extra: Partial<PostComment> = {}): PostComment => ({
  eventId: `$c${i}`,
  sender: '@bob:x',
  ts: i,
  content: { body: `comment ${i}` },
  ...extra,
});

const firstComment: PostComment = {
  eventId: '$c1',
  sender: '@bob:x',
  ts: 1,
  content: { body: 'first!', attachments: [{ kind: 'image', url: 'mxc://x/a', name: 'a.webp', info: { mimetype: 'image/webp', size: 1 } }] },
};

const hook = {
  likeCount: 2,
  likesTruncated: false,
  older: undefined as { token: string } | undefined,
  loadingOlder: false,
  loadOlder: vi.fn(async () => undefined),
  myLikeId: undefined as string | undefined,
  comments: [firstComment],
  loaded: true,
  busy: false,
  toggleLike: vi.fn(async () => undefined),
  addComment: vi.fn(async () => undefined),
  removeComment: vi.fn(async () => undefined),
  reload: vi.fn(),
};
vi.mock('../../matrix/hooks/usePostInteractions', () => ({ usePostInteractions: () => hook }));
// Media and avatars resolve mxc URLs through the client; nothing here needs them to load.
vi.mock('./PostMedia', () => ({ PostMedia: () => <div data-nu-role="post-media" /> }));
vi.mock('../../components/Avatar', () => ({ Avatar: () => null }));

const mx = {
  getUserId: () => '@me:x',
  getProfileInfo: vi.fn(async (userId: string) => ({ displayname: userId === '@bob:x' ? 'Bob' : userId })),
} as never;

function renderPost(props: Partial<Parameters<typeof InteractivePost>[0]> = {}) {
  const store = createStore();
  const view = render(
    <JotaiProvider store={store}>
      <MatrixClientContext.Provider value={mx}>
        <InteractivePost
          roomId="!feed"
          postId="$post"
          sourceOrigin={{ kind: 'global' }}
          isPublic
          canInteract
          content={{ body: 'hello' }}
          author={{ userId: '@alice:x', name: 'Alice' }}
          ts={0}
          myUserId="@me:x"
          {...props}
        />
      </MatrixClientContext.Provider>
    </JotaiProvider>
  );
  return { ...view, store };
}

const q = (container: HTMLElement, role: string) => container.querySelector(`[data-nu-role="${role}"]`) as HTMLElement | null;
const shownComments = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-nu-role="post-comment"] .nu-post__text')).map((n) => n.textContent);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  hook.comments = [firstComment];
  hook.older = undefined;
  hook.likesTruncated = false;
});

describe('InteractivePost', () => {
  it('shows like, comment and repost with their counts', () => {
    const { container } = renderPost({ onRepost: vi.fn() });
    expect(q(container, 'post-like')?.textContent).toBe('2');
    expect(q(container, 'post-comment-toggle')?.textContent).toBe('1');
    expect(q(container, 'post-repost-action')).toBeTruthy();
  });

  it('has no repost button when the post cannot be reposted anywhere', () => {
    const { container } = renderPost();
    expect(q(container, 'post-repost-action')).toBeNull();
  });

  it('likes on click', () => {
    const { container } = renderPost();
    fireEvent.click(q(container, 'post-like')!);
    expect(hook.toggleLike).toHaveBeenCalledOnce();
  });

  it('marks counts that have more behind them', () => {
    hook.likesTruncated = true;
    hook.older = { token: 'tok' };
    const { container } = renderPost();
    expect(q(container, 'post-like')?.textContent).toBe('2+');
    expect(q(container, 'post-comment-toggle')?.textContent).toBe('1+');
  });

  it('opens the thread with comments and a reply box that takes media', async () => {
    const { container } = renderPost();
    fireEvent.click(q(container, 'post-comment-toggle')!);
    expect(screen.getByText('first!')).toBeTruthy();
    expect(container.querySelector('[data-nu-role="post-comment"] [data-nu-role="post-media"]')).toBeTruthy();
    expect(q(container, 'post-comment-attach')).toBeTruthy();

    fireEvent.change(q(container, 'post-comment-input')!, { target: { value: 'nice post' } });
    fireEvent.submit(q(container, 'post-comment-form')!);
    await vi.waitFor(() =>
      expect(hook.addComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'nice post' }), undefined)
    );
  });

  it("explains instead of offering a reply box where you can't join the feed", () => {
    const { container } = renderPost({ canInteract: false, cannotInteractReason: 'Join Cats to like or comment.' });
    expect((q(container, 'post-like') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(q(container, 'post-comment-toggle')!);
    expect(q(container, 'post-comment-form')).toBeNull();
    expect(q(container, 'post-comment-reply')).toBeNull();
    expect(screen.getByText('Join Cats to like or comment.')).toBeTruthy();
  });
});

describe('long threads', () => {
  it('shows only the newest three in a timeline, and links the rest to the post page', () => {
    hook.comments = Array.from({ length: 25 }, (_, i) => comment(i + 1));
    hook.older = { token: 'tok' };
    const { container, store } = renderPost({ origin: { kind: 'global' } });
    fireEvent.click(q(container, 'post-comment-toggle')!);
    expect(shownComments(container)).toEqual(['comment 23', 'comment 24', 'comment 25']);
    expect(q(container, 'post-comments-earlier')).toBeNull();

    const viewAll = q(container, 'post-comments-view-all')!;
    expect(viewAll.textContent).toBe('View all 25+ comments');
    fireEvent.click(viewAll);
    expect(store.get(openPostAtom)).toMatchObject({
      roomId: '!feed',
      postId: '$post',
      showOrigin: true,
      sourceOrigin: { kind: 'global' },
    });
  });

  it('opens the post page from the Open action too', () => {
    const { container, store } = renderPost();
    fireEvent.click(q(container, 'post-open-page')!);
    expect(store.get(openPostAtom)?.postId).toBe('$post');
  });

  it('on the post page, shows the whole thread: newest 50, then earlier, then older from the server', async () => {
    hook.comments = Array.from({ length: 80 }, (_, i) => comment(i + 1));
    hook.older = { token: 'tok' };
    const { container } = renderPost({ mode: 'page' });
    // Always open on its page, with no toggle and no link to itself.
    expect(q(container, 'post-comments')).toBeTruthy();
    expect(q(container, 'post-open-page')).toBeNull();
    expect(shownComments(container)).toHaveLength(50);
    expect(shownComments(container)[49]).toBe('comment 80');

    const earlier = () => q(container, 'post-comments-earlier') as HTMLButtonElement;
    expect(earlier().textContent).toBe('Show earlier comments (30)');
    fireEvent.click(earlier());
    await vi.waitFor(() => expect(shownComments(container)).toHaveLength(80));
    expect(hook.loadOlder).not.toHaveBeenCalled();

    expect(earlier().textContent).toBe('Load earlier comments');
    fireEvent.click(earlier());
    await vi.waitFor(() => expect(hook.loadOlder).toHaveBeenCalledOnce());
  });
});

describe('replies', () => {
  it('replies to a specific comment, naming it as the target', async () => {
    const { container } = renderPost();
    fireEvent.click(q(container, 'post-comment-toggle')!);
    fireEvent.click(q(container, 'post-comment-reply')!);
    await vi.waitFor(() => expect(q(container, 'post-comment-replying')?.textContent).toContain('Replying to Bob'));

    fireEvent.change(q(container, 'post-comment-input')!, { target: { value: 'agreed' } });
    fireEvent.submit(q(container, 'post-comment-form')!);
    await vi.waitFor(() =>
      expect(hook.addComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'agreed' }), {
        eventId: '$c1',
        sender: '@bob:x',
      })
    );
    await vi.waitFor(() => expect(q(container, 'post-comment-replying')).toBeNull());
  });

  it('can cancel a reply and send a plain comment instead', async () => {
    const { container } = renderPost();
    fireEvent.click(q(container, 'post-comment-toggle')!);
    fireEvent.click(q(container, 'post-comment-reply')!);
    fireEvent.click(q(container, 'post-comment-reply-cancel')!);
    fireEvent.change(q(container, 'post-comment-input')!, { target: { value: 'hi all' } });
    fireEvent.submit(q(container, 'post-comment-form')!);
    await vi.waitFor(() => expect(hook.addComment).toHaveBeenCalledWith(expect.objectContaining({ body: 'hi all' }), undefined));
  });

  it('labels a comment that answers another', async () => {
    hook.comments = [firstComment, comment(2, { sender: '@carol:x', replyTo: { eventId: '$c1', sender: '@bob:x' } })];
    const { container } = renderPost();
    fireEvent.click(q(container, 'post-comment-toggle')!);
    await vi.waitFor(() => expect(q(container, 'post-comment-reply-label')?.textContent).toBe('Replying to Bob'));
  });
});
