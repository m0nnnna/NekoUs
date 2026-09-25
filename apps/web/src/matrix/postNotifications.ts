import { EventType, PushRuleKind, type IPushRule, type MatrixClient } from 'matrix-js-sdk';
import { listOwnFeedRoomIds } from './feed';
import { COMMENT_EVENT_TYPE } from './postInteractions';
import { getOwnProfileRoomId } from './profileFeed';

/**
 * Telling a post's author when someone likes or comments on it.
 *
 * Both are silent by default: a comment is a custom event type, which no default push rule
 * matches, and a like is an `m.reaction`, which the server-default `.m.rule.reaction` rule
 * explicitly mutes. So the author gets their own **push rules**, one pair per feed room they own:
 *
 * - comments in that room → notify, with sound;
 * - reactions in that room → notify, quietly (the homeserver marks them low priority).
 *
 * User-defined override rules beat the server defaults, so these win over `.m.rule.reaction`.
 * They're scoped by `room_id`, so they cover only the author's own feeds — not every feed room
 * they've joined to like or comment elsewhere. And because they're real push rules, the homeserver
 * applies them itself: in-app notifications (DesktopNotifications) and background push through the
 * push gateway both follow, with nothing running on the client. Checked against Continuwuity with
 * a stand-in push gateway: no rules, nothing delivered; with them, the comment and the like both
 * arrive; the same actions in some other room, nothing.
 *
 * Your own likes and comments never notify you: servers don't push a user's own events.
 */

export type PostNotificationSettings = { comments: boolean; likes: boolean };

const SETTINGS_ACCOUNT_DATA = 'xyz.nekous.post_notifications';
const DEFAULTS: PostNotificationSettings = { comments: true, likes: true };

/** Every rule this module manages starts with one of these, then the room ID. */
const COMMENT_RULE_PREFIX = 'xyz.nekous.feed_comment.';
const LIKE_RULE_PREFIX = 'xyz.nekous.feed_like.';

export function readPostNotificationSettings(mx: MatrixClient): PostNotificationSettings {
  const content = mx.getAccountData(SETTINGS_ACCOUNT_DATA as any)?.getContent<Partial<PostNotificationSettings>>();
  return {
    comments: typeof content?.comments === 'boolean' ? content.comments : DEFAULTS.comments,
    likes: typeof content?.likes === 'boolean' ? content.likes : DEFAULTS.likes,
  };
}

export async function setPostNotificationSettings(mx: MatrixClient, settings: PostNotificationSettings): Promise<void> {
  await mx.setAccountData(SETTINGS_ACCOUNT_DATA as any, settings as any);
  await syncPostNotificationRules(mx, settings);
}

/** The feed rooms you own: your profile feed plus your feed in each Space. */
export function ownFeedRoomIds(mx: MatrixClient): string[] {
  const profile = getOwnProfileRoomId(mx);
  return [...new Set([...(profile ? [profile] : []), ...listOwnFeedRoomIds(mx)])];
}

type WantedRule = { ruleId: string; body: Pick<IPushRule, 'conditions' | 'actions'> };

/** The rules that should exist for these rooms and settings. Pure, so it's tested directly. */
export function wantedPostRules(roomIds: string[], settings: PostNotificationSettings): WantedRule[] {
  return roomIds.flatMap((roomId) => {
    const inRoom = { kind: 'event_match', key: 'room_id', pattern: roomId };
    const rules: WantedRule[] = [];
    if (settings.comments) {
      rules.push({
        ruleId: COMMENT_RULE_PREFIX + roomId,
        body: {
          conditions: [{ kind: 'event_match', key: 'type', pattern: COMMENT_EVENT_TYPE }, inRoom] as IPushRule['conditions'],
          actions: ['notify', { set_tweak: 'sound', value: 'default' }] as IPushRule['actions'],
        },
      });
    }
    if (settings.likes) {
      rules.push({
        ruleId: LIKE_RULE_PREFIX + roomId,
        body: {
          conditions: [{ kind: 'event_match', key: 'type', pattern: EventType.Reaction }, inRoom] as IPushRule['conditions'],
          actions: ['notify'] as IPushRule['actions'],
        },
      });
    }
    return rules;
  });
}

function isManaged(ruleId: string): boolean {
  return ruleId.startsWith(COMMENT_RULE_PREFIX) || ruleId.startsWith(LIKE_RULE_PREFIX);
}

/**
 * Makes your push rules match your feed rooms and settings: adds what's missing, removes what's no
 * longer wanted (a setting turned off, a feed you no longer own). Reads the rules the client already
 * has from sync — Continuwuity doesn't implement listing a single rule kind — and changes nothing
 * when they already match, so it's cheap to run on every start.
 */
export async function syncPostNotificationRules(
  mx: MatrixClient,
  settings: PostNotificationSettings = readPostNotificationSettings(mx)
): Promise<void> {
  const existing = (mx.pushRules?.global?.override ?? []).filter((rule) => isManaged(rule.rule_id));
  const existingIds = new Set(existing.map((rule) => rule.rule_id));
  const wanted = wantedPostRules(ownFeedRoomIds(mx), settings);
  const wantedIds = new Set(wanted.map((rule) => rule.ruleId));

  for (const rule of wanted) {
    if (!existingIds.has(rule.ruleId)) {
      await mx.addPushRule('global', PushRuleKind.Override, rule.ruleId, rule.body);
    }
  }
  for (const rule of existing) {
    if (!wantedIds.has(rule.rule_id)) {
      await mx.deletePushRule('global', PushRuleKind.Override, rule.rule_id);
    }
  }
}

/** For DesktopNotifications: an event that one of these rules is about. */
export function isPostActivity(eventType: string): 'comment' | 'like' | undefined {
  if (eventType === COMMENT_EVENT_TYPE) return 'comment';
  if (eventType === EventType.Reaction) return 'like';
  return undefined;
}
