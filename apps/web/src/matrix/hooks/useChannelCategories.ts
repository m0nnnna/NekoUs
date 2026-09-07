import { useEffect, useState } from 'react';
import { RoomStateEvent, type Room } from 'matrix-js-sdk';
import { getChannelCategories, type ChannelCategory } from '../channelCategories';

/** Live-updating category list for a Space — mirrors useSpaceRooms.ts's own pattern (re-read on
 *  every room-state change; the category event is small and infrequent, cheap to just re-parse
 *  rather than diff). `null` space (no Space selected, or the Direct Messages view) means no
 *  categories at all, not an error. */
export function useChannelCategories(space: Room | null | undefined): ChannelCategory[] {
  const [categories, setCategories] = useState<ChannelCategory[]>(() => (space ? getChannelCategories(space) : []));

  useEffect(() => {
    if (!space) {
      setCategories([]);
      return undefined;
    }
    const update = () => setCategories(getChannelCategories(space));
    update();
    space.on(RoomStateEvent.Events, update);
    return () => {
      space.removeListener(RoomStateEvent.Events, update);
    };
  }, [space]);

  return categories;
}
