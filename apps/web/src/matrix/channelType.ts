import type { MatrixClient, Room } from 'matrix-js-sdk';

/**
 * Marks a room as a voice channel vs. a text channel — Discord's model, which Matrix has no
 * native equivalent for (cinny-voice never distinguished channel types; it bolted a voice
 * toggle onto every room instead). A custom state event, not creation_content, to stay
 * consistent with how every other custom marker in this codebase works (emotes, pins, space
 * discovery) — read/write/hook via the same shape throughout.
 */
const CHANNEL_TYPE_EVENT = 'xyz.nekous.channel_type';

/**
 * `feed` is a member's own posts room (`feed.ts`) rather than a channel anyone selects from the
 * channel list — it's marked here so the places that enumerate rooms can tell it apart from a
 * chat room they should show (see `useSpacelessRooms`).
 */
export type ChannelType = 'text' | 'voice' | 'feed';

type ChannelTypeContent = { type?: ChannelType };

/** Absence of the event means text — the default every room has implicitly had until now. */
export function readChannelType(room: Room): ChannelType {
  const content = room.currentState.getStateEvents(CHANNEL_TYPE_EVENT, '')?.getContent<ChannelTypeContent>();
  if (content?.type === 'voice') return 'voice';
  if (content?.type === 'feed') return 'feed';
  return 'text';
}

export async function setChannelType(mx: MatrixClient, room: Room, type: ChannelType): Promise<void> {
  await mx.sendStateEvent(room.roomId, CHANNEL_TYPE_EVENT as any, { type } as any, '');
}

/** For use in initial_state at room creation, so the type is set atomically with the room. */
export function channelTypeInitialStateEvent(type: ChannelType) {
  return { type: CHANNEL_TYPE_EVENT, state_key: '', content: { type } };
}
