import { useEffect, useState } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../MatrixClientContext';
import { readMentionInbox, type MentionRef } from '../mentionInbox';

const MENTION_INBOX_EVENT = 'xyz.nekous.mention_inbox';

export function useMentionInbox(): MentionRef[] {
  const mx = useMatrixClient();
  const [items, setItems] = useState<MentionRef[]>(() => readMentionInbox(mx));

  useEffect(() => {
    const update = (event: MatrixEvent) => {
      if (event.getType() === MENTION_INBOX_EVENT) setItems(readMentionInbox(mx));
    };
    mx.on(ClientEvent.AccountData, update);
    return () => {
      mx.removeListener(ClientEvent.AccountData, update);
    };
  }, [mx]);

  return items;
}
