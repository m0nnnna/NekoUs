import { useEffect } from 'react';
import { ClientEvent, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/MatrixClientContext';
import { syncPostNotificationRules } from '../../matrix/postNotifications';

/** Account data that changes which rules should exist: your feed rooms, and the settings. */
const WATCHED = new Set(['xyz.nekous.feed_rooms', 'xyz.nekous.profile_room', 'xyz.nekous.post_notifications']);

/**
 * Keeps your like/comment push rules in step with the feeds you own (matrix/postNotifications.ts):
 * once at start, then whenever a feed is created or the settings change — including from another
 * device, since both live in account data. Headless, mounted once in AppShell.
 */
export function PostNotificationRules() {
  const mx = useMatrixClient();

  useEffect(() => {
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      if (running) {
        again = true; // one more pass once this one finishes, rather than two racing each other
        return;
      }
      running = true;
      try {
        await syncPostNotificationRules(mx);
      } catch (err) {
        console.warn('Couldn’t update post notification rules', err);
      } finally {
        running = false;
        if (again) {
          again = false;
          void run();
        }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 1000);
    };
    const onAccountData = (event: MatrixEvent) => {
      if (WATCHED.has(event.getType())) schedule();
    };

    schedule();
    mx.on(ClientEvent.AccountData, onAccountData);
    return () => {
      clearTimeout(timer);
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx]);

  return null;
}
