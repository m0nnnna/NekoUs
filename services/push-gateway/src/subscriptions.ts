import type { PushSubscription } from 'web-push';

/**
 * pushkey -> the browser's actual Web Push subscription (endpoint + encryption keys). The
 * pushkey itself is an opaque token the client generates (a random UUID — see
 * `apps/web/src/features/notifications/pushSubscription.ts`) and is what the homeserver's
 * `/pushers/set` and later notify calls address a device by; this map is what turns that opaque
 * key back into somewhere actually reachable.
 *
 * In-memory and single-process, matching this project's other services (the token server also
 * keeps no persistent store) — self-hosted, single deployment, restart-tolerant only in the
 * sense that a client re-subscribes and re-registers its pusher on next load if this is lost,
 * same as any other push subscription surviving a browser restart.
 */
const subscriptionsByPushKey = new Map<string, PushSubscription>();

export function saveSubscription(pushkey: string, subscription: PushSubscription): void {
  subscriptionsByPushKey.set(pushkey, subscription);
}

export function getSubscription(pushkey: string): PushSubscription | undefined {
  return subscriptionsByPushKey.get(pushkey);
}

export function deleteSubscription(pushkey: string): void {
  subscriptionsByPushKey.delete(pushkey);
}
