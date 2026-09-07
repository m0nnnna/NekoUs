import {
  EventType,
  JoinRule,
  RoomType,
  Visibility,
  type ICreateRoomStateEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import { channelTypeInitialStateEvent, type ChannelType } from './channelType';

export type CreateRoomOptions = {
  name: string;
  topic?: string;
  isPublic: boolean;
  /** Create a Space instead of a regular room. */
  isSpace?: boolean;
  /** If set, the new room becomes a child of this Space (m.space.child / m.space.parent). */
  parentSpace?: Room;
  /** Text (default) or voice channel — ignored when isSpace is set. */
  channelType?: ChannelType;
};

/**
 * Creates a Space or a regular room, optionally linking it into a parent Space. Deliberately
 * narrow compared to what Matrix supports: private (invite-only) or public join rules only —
 * no restricted/knock join rules, no room-version selection, no additional-creators (MSC
 * multi-creator rooms). Those are legitimate features, just not needed for a first "create and
 * manage spaces" pass.
 */
export async function createRoom(mx: MatrixClient, options: CreateRoomOptions): Promise<string> {
  const via = mx.getUserId()?.split(':')[1] ?? '';

  const initialState: ICreateRoomStateEvent[] = [
    {
      type: EventType.RoomJoinRules,
      state_key: '',
      content: { join_rule: options.isPublic ? JoinRule.Public : JoinRule.Invite },
    },
  ];

  if (options.parentSpace) {
    initialState.push({
      type: EventType.SpaceParent,
      state_key: options.parentSpace.roomId,
      content: { canonical: true, via: [via] },
    });
  }

  if (!options.isSpace && options.channelType === 'voice') {
    initialState.push(channelTypeInitialStateEvent('voice'));
  }

  const result = await mx.createRoom({
    name: options.name,
    topic: options.topic || undefined,
    // The join_rule above ("who can join if they get in the door") and this are two separate
    // Matrix knobs that both happen to be exposed through one "Public" checkbox in the UI:
    // without also publishing to the directory, a "public" room stayed invisible to
    // DiscoverModal's browsePublicRooms — joinable by anyone who already had the room ID, but
    // undiscoverable by anyone else, which isn't what the checkbox's own label promises.
    visibility: options.isPublic ? Visibility.Public : Visibility.Private,
    creation_content: options.isSpace ? { type: RoomType.Space } : undefined,
    power_level_content_override: options.isSpace ? { events_default: 50 } : undefined,
    initial_state: initialState,
  });

  if (options.parentSpace) {
    await mx.sendStateEvent(
      options.parentSpace.roomId,
      EventType.SpaceChild,
      { via: [via], suggested: false },
      result.room_id
    );
  }

  return result.room_id;
}

export async function updateRoomAvatar(mx: MatrixClient, roomId: string, file: File): Promise<void> {
  const { content_uri: mxcUrl } = await mx.uploadContent(file);
  await mx.sendStateEvent(roomId, EventType.RoomAvatar, { url: mxcUrl });
}

export async function updateRoomName(mx: MatrixClient, roomId: string, name: string): Promise<void> {
  await mx.sendStateEvent(roomId, EventType.RoomName, { name });
}

export async function updateRoomTopic(mx: MatrixClient, roomId: string, topic: string): Promise<void> {
  await mx.sendStateEvent(roomId, EventType.RoomTopic, { topic });
}
