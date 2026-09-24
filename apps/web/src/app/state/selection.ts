import { atom } from 'jotai';

/** Currently selected Space (server). `null` = no space selected (e.g. a future "Home"/DM view). */
export const selectedSpaceIdAtom = atom<string | null>(null);

/** Currently selected room (channel) within the selected space. */
export const selectedRoomIdAtom = atom<string | null>(null);

/**
 * A Space-level view that isn't a channel. `'feed'` is the hub's Posts timeline, which is a
 * merge across many rooms (`feed.ts`) rather than any one of them, so it can't be expressed as a
 * `selectedRoomIdAtom` value. `null` means an ordinary channel is selected.
 */
export const selectedSpaceViewAtom = atom<'feed' | null>(null);

/**
 * The voice channel actually connected via LiveKit right now — independent of
 * `selectedRoomIdAtom`. Discord's model: you can be in a voice call while looking at (and
 * `selectedRoomIdAtom`-selecting) a different, unrelated text channel. `null` = not in a call.
 */
export const activeVoiceChannelIdAtom = atom<string | null>(null);

/**
 * A message the UI should scroll to and highlight the moment its room's timeline can show it —
 * set by anything that jumps to a specific message rather than just a room (currently only
 * search results; see MessageSearchModal/MessageTimeline). `null` once consumed or abandoned.
 */
export type PendingJumpTarget = { roomId: string; eventId: string };
export const pendingJumpTargetAtom = atom<PendingJumpTarget | null>(null);
