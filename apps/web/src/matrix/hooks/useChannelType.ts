import { useEffect, useState } from 'react';
import { RoomStateEvent, type Room } from 'matrix-js-sdk';
import { readChannelType, type ChannelType } from '../channelType';

export function useChannelType(room: Room | undefined): ChannelType {
  const [type, setType] = useState<ChannelType>(() => (room ? readChannelType(room) : 'text'));

  useEffect(() => {
    if (!room) {
      setType('text');
      return undefined;
    }

    const update = () => setType(readChannelType(room));
    update();

    room.on(RoomStateEvent.Events, update);
    return () => {
      room.removeListener(RoomStateEvent.Events, update);
    };
  }, [room]);

  return type;
}
