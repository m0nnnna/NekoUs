import { useEffect, useState } from 'react';
import { RoomStateEvent, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { readVoiceServerConfig, type VoiceServerConfig } from '../voice';

/**
 * The LiveKit server config for a Space (falling back up m.space.parent for sub-spaces — see
 * readVoiceServerConfig). Only listens for changes on the given space itself, not on any parent
 * walked through during fallback — a nested sub-space whose *parent's* voice server changes
 * while this space's own event stays unset won't live-update here. Edge case, not the common
 * case; revisit if nested spaces turn out to matter more than expected.
 */
export function useSpaceVoiceServer(space: Room | undefined): VoiceServerConfig | undefined {
  const mx = useMatrixClient();
  const [config, setConfig] = useState<VoiceServerConfig | undefined>(() =>
    space ? readVoiceServerConfig(mx, space) : undefined
  );

  useEffect(() => {
    if (!space) {
      setConfig(undefined);
      return undefined;
    }

    const update = () => setConfig(readVoiceServerConfig(mx, space));
    update();

    space.on(RoomStateEvent.Events, update);
    return () => {
      space.removeListener(RoomStateEvent.Events, update);
    };
  }, [mx, space]);

  return config;
}
