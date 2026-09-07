import { useEffect, useState } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { readSavedMessages, type SavedMessageRef } from '../savedMessages';

const SAVED_MESSAGES_EVENT = 'xyz.nekous.saved_messages';

export function useSavedMessages(): SavedMessageRef[] {
  const mx = useMatrixClient();
  const [items, setItems] = useState<SavedMessageRef[]>(() => readSavedMessages(mx));

  useEffect(() => {
    const update = (event: MatrixEvent) => {
      if (event.getType() === SAVED_MESSAGES_EVENT) setItems(readSavedMessages(mx));
    };
    mx.on(ClientEvent.AccountData, update);
    return () => {
      mx.removeListener(ClientEvent.AccountData, update);
    };
  }, [mx]);

  return items;
}
