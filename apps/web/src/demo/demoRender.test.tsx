import { afterEach, describe, expect, it, vi, beforeAll } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { MatrixClientContext } from '../matrix/MatrixClientContext';
import { selectedRoomIdAtom, selectedSpaceIdAtom } from '../app/state/selection';
import { ChannelList } from '../features/channels/ChannelList';
import { FeedView } from '../features/feed/FeedView';
import { MessageTimeline } from '../features/messaging/MessageTimeline';
import { createDemoClient } from './demoClient';
import { DEMO_ROOM_IDS } from './demoWorld';

/**
 * The claim demo mode has to earn: the real components render against the fake client. Seeding
 * plausible-looking data isn't worth much on its own — what matters is that the app's actual
 * channel list and timeline mount and show it, with no homeserver anywhere.
 */

beforeAll(() => {
  // jsdom has neither, and both are reached during an ordinary render of these components.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

// vitest runs without `globals`, so Testing Library never gets to register its own automatic
// cleanup — without this every render in this file stacks up in the same document and queries
// start matching elements left behind by earlier tests.
afterEach(cleanup);

function renderWithDemo(
  ui: React.ReactElement,
  selected: { spaceId?: string | null; roomId?: string | null } = {}
) {
  const mx = createDemoClient();
  const store = createStore();
  if (selected.spaceId !== undefined) store.set(selectedSpaceIdAtom, selected.spaceId);
  if (selected.roomId !== undefined) store.set(selectedRoomIdAtom, selected.roomId);

  return {
    mx,
    ...render(
      <JotaiProvider store={store}>
        <MatrixClientContext.Provider value={mx}>{ui}</MatrixClientContext.Provider>
      </JotaiProvider>
    ),
  };
}

describe('ChannelList against the demo world', () => {
  it('renders the configured Space with its categories and channels', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });

    expect(screen.getByText('Cat Café')).toBeInTheDocument();
    expect(screen.getByText('TEXT CHANNELS')).toBeInTheDocument();
    expect(screen.getByText('VOICE CHANNELS')).toBeInTheDocument();
    expect(screen.getByText('general')).toBeInTheDocument();
    expect(screen.getByText('Lounge')).toBeInTheDocument();
    expect(screen.getByText('AFK')).toBeInTheDocument();
  });

  it('renders the Home view with the seeded DMs', () => {
    renderWithDemo(<ChannelList />, { spaceId: null });

    expect(screen.getByText('Direct Messages')).toBeInTheDocument();
    expect(screen.getByText('Nibbles')).toBeInTheDocument();
    expect(screen.getByText('Weekend Plans')).toBeInTheDocument();
  });

  it('distinguishes voice channels from text ones by icon', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });

    const rows = screen.getAllByRole('button', { name: /Lounge|general/ });
    const lounge = rows.find((r) => r.textContent?.includes('Lounge'));
    const general = rows.find((r) => r.textContent?.includes('general'));
    expect(lounge?.textContent).toContain('🔊');
    expect(general?.textContent).toContain('#');
  });
});

describe('MessageTimeline against the demo world', () => {
  it('renders the seeded conversation, markdown and reactions included', () => {
    renderWithDemo(<MessageTimeline roomId={DEMO_ROOM_IDS.general} onReply={() => {}} />);

    expect(screen.getByText(/welcome to the café/)).toBeInTheDocument();
    // Markdown in the body is parsed into real elements, not shown as literal asterisks.
    expect(screen.getByText('H.264').tagName).toBe('STRONG');
    expect(screen.getByText('60fps').tagName).toBe('EM');
    // The two seeded 🔥 annotations aggregate into one pill with a count.
    expect(screen.getByText('🔥')).toBeInTheDocument();
    expect(screen.queryByText(/\*\*H\.264\*\*/)).not.toBeInTheDocument();
  });

  it('shows sender display names rather than raw Matrix IDs', () => {
    renderWithDemo(<MessageTimeline roomId={DEMO_ROOM_IDS.general} onReply={() => {}} />);
    expect(screen.getAllByText('Nibbles').length).toBeGreaterThan(0);
    expect(screen.queryByText(/@nibbles:demo\.nekous/)).not.toBeInTheDocument();
  });
});

describe('FeedView against the demo world', () => {
  it('merges every member’s posts into one hub timeline, newest first', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });

    expect(await screen.findByText(/movie night friday/)).toBeInTheDocument();
    expect(screen.getByText(/anyone else up at 3am/)).toBeInTheDocument();
    // Posts live in one room per author; the hub view is the merge of them.
    expect(screen.getByText(/finally got the/)).toBeInTheDocument();

    const posts = screen.getAllByRole('article');
    expect(posts[0].textContent).toContain('movie night friday');
    expect(posts[posts.length - 1].textContent).toContain('anyone else up at 3am');
  });

  it('renders post bodies through the same markdown path as messages', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });
    expect((await screen.findByText('voice channels')).tagName).toBe('STRONG');
  });

  it('offers unpublish/delete only on your own posts', async () => {
    renderWithDemo(<FeedView space={createDemoClient().getRoom(DEMO_ROOM_IDS.cafe)!} />, {
      spaceId: DEMO_ROOM_IDS.cafe,
    });

    await screen.findByText(/movie night friday/);
    // Three posts are shown, but only the one you wrote is yours to take back.
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByText('Make private')).toHaveLength(1);
  });
});

describe('feed rooms stay out of the channel and DM lists', () => {
  it('lists the Space’s channels without anyone’s feed room', () => {
    renderWithDemo(<ChannelList />, { spaceId: DEMO_ROOM_IDS.cafe });
    expect(screen.getByText('Posts')).toBeInTheDocument(); // the view, not a room
    expect(screen.queryByText("Nibbles's posts")).not.toBeInTheDocument();
  });

  it('does not show joined feed rooms as group chats in Direct Messages', () => {
    // They're joined and have no parent Space, which is exactly what useSpacelessRooms would
    // otherwise treat as a group chat — one row per member of the hub.
    renderWithDemo(<ChannelList />, { spaceId: null });
    expect(screen.getByText('Nibbles')).toBeInTheDocument();
    expect(screen.queryByText("Nibbles's posts")).not.toBeInTheDocument();
    expect(screen.queryByText("You's posts")).not.toBeInTheDocument();
  });
});
