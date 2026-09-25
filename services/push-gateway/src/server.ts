import express from 'express';
import cors from 'cors';
import webpush from 'web-push';
import { deleteSubscription, getSubscription, saveSubscription } from './subscriptions.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3002;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
// Per the Web Push spec, a contact the push service (e.g. Google's FCM) can reach out to if
// this deployment is misbehaving — a mailto: address or this deployment's own https:// URL.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set — generate a pair with `npx web-push generate-vapid-keys`');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());

function corsOriginAllowed(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }
  const matched = ALLOWED_ORIGINS.some((allowed) => {
    if (!allowed.includes('*')) return false;
    const pattern = `^${allowed.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}$`;
    return new RegExp(pattern).test(origin);
  });
  callback(null, matched);
}

const app = express();
app.use(cors({ origin: corsOriginAllowed }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'purrlor-push-gateway' });
});

// Lets the client fetch the current public key at runtime rather than hardcoding it into the
// web app's build — regenerating the VAPID pair needs no frontend rebuild.
app.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/subscribe', (req, res) => {
  const { pushkey, subscription } = req.body ?? {};
  if (typeof pushkey !== 'string' || !pushkey || !subscription?.endpoint) {
    res.status(400).json({ error: 'pushkey and subscription are required' });
    return;
  }
  saveSubscription(pushkey, subscription);
  res.status(204).end();
});

app.delete('/subscribe/:pushkey', (req, res) => {
  deleteSubscription(req.params.pushkey);
  res.status(204).end();
});

type NotifyDevice = {
  app_id: string;
  pushkey: string;
  pushkey_ts?: number;
  data?: Record<string, unknown>;
  tweaks?: { highlight?: boolean };
};
type NotifyBody = {
  notification: {
    id?: string;
    room_id?: string;
    room_name?: string;
    event_id?: string;
    /** The event's type — part of the spec's notification object, alongside its content. */
    type?: string;
    sender?: string;
    sender_display_name?: string;
    content?: { body?: unknown; msgtype?: unknown; 'xyz.nekous.reply_to'?: { sender?: unknown } };
    counts?: { unread?: number };
    devices: NotifyDevice[];
  };
};

/**
 * The Matrix Push Gateway API (the one part of this service a homeserver actually calls) —
 * https://spec.matrix.org/latest/push-gateway-api/. It POSTs here whenever a pusher's user has a
 * notify-worthy event, we translate that into a real Web Push message via the subscription
 * `/subscribe` stored earlier, and report back which pushkeys are dead so the homeserver stops
 * trying them (`rejected`, part of the spec, not a Purrlor invention).
 */
app.post('/_matrix/push/v1/notify', async (req, res) => {
  const body = req.body as NotifyBody | undefined;
  const notification = body?.notification;
  if (!notification || !Array.isArray(notification.devices)) {
    res.status(400).json({ error: 'notification.devices is required' });
    return;
  }

  const title = notification.sender_display_name || notification.sender || 'New message';
  // Encrypted-room events arrive here still encrypted (the homeserver can't read them either) —
  // content.body is only ever real plaintext for an unencrypted room, so anything else falls
  // back to a generic line rather than showing ciphertext or garbage.
  const rawBody = notification.content?.body;
  const text = typeof rawBody === 'string' && rawBody.trim() ? rawBody : '';
  const previewBody = text || 'Sent a message';
  // Likes and comments on your posts (the web app's matrix/postNotifications.ts gives you the push
  // rules for these). A feed room is named after its owner — you — so "Alice: Liked your post"
  // would read wrong; these skip the room-name prefix a chat message gets.
  // A comment reaches you either as a reply to one of your comments (through m.mentions) or as a
  // comment on your own post. Which one is decided by who you are: the web app puts your user ID
  // in the pusher's data, which comes back here on every notification. A pusher registered before
  // that falls back to the highlight tweak, which only the mention rule sets.
  const device = notification.devices[0];
  const recipient = typeof device?.data?.user_id === 'string' ? device.data.user_id : undefined;
  const repliedTo = notification.content?.['xyz.nekous.reply_to']?.sender;
  const isReplyToRecipient = recipient ? repliedTo === recipient : !!repliedTo && !!device?.tweaks?.highlight;
  const commentVerb = isReplyToRecipient ? 'Replied to your comment' : 'Commented on your post';
  const postActivity =
    notification.type === 'xyz.nekous.comment'
      ? text
        ? `${commentVerb}: ${text}`
        : commentVerb
      : notification.type === 'm.reaction'
        ? 'Liked your post'
        : undefined;
  const payload = JSON.stringify({
    title,
    body: postActivity ?? (notification.room_name ? `${notification.room_name}: ${previewBody}` : previewBody),
    roomId: notification.room_id,
    eventId: notification.event_id,
    unreadCount: notification.counts?.unread,
  });

  const rejected: string[] = [];
  await Promise.all(
    notification.devices.map(async (device) => {
      const subscription = getSubscription(device.pushkey);
      if (!subscription) {
        rejected.push(device.pushkey);
        return;
      }
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410: the push service (e.g. Chrome's FCM endpoint) confirms this subscription is
        // permanently gone (browser uninstalled, storage cleared, ...) — anything else (a
        // transient network/5xx error) is left alone to retry on the next real event instead of
        // dropping a pusher over a blip.
        if (statusCode === 404 || statusCode === 410) {
          deleteSubscription(device.pushkey);
          rejected.push(device.pushkey);
        } else {
          console.error(`Failed to deliver push to ${device.pushkey}`, err);
        }
      }
    })
  );

  res.json({ rejected });
});

app.listen(PORT, () => {
  console.log(`purrlor-push-gateway listening on :${PORT}`);
});
