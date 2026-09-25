import { describe, expect, it, vi } from 'vitest';
import { syncPostNotificationRules, wantedPostRules } from './postNotifications';

describe('wantedPostRules', () => {
  it('gives each owned feed a comment rule with sound and a quiet like rule, scoped to that room', () => {
    const rules = wantedPostRules(['!feed:x'], { comments: true, likes: true });
    expect(rules).toEqual([
      {
        ruleId: 'xyz.nekous.feed_comment.!feed:x',
        body: {
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'xyz.nekous.comment' },
            { kind: 'event_match', key: 'room_id', pattern: '!feed:x' },
          ],
          actions: ['notify', { set_tweak: 'sound', value: 'default' }],
        },
      },
      {
        ruleId: 'xyz.nekous.feed_like.!feed:x',
        body: {
          conditions: [
            { kind: 'event_match', key: 'type', pattern: 'm.reaction' },
            { kind: 'event_match', key: 'room_id', pattern: '!feed:x' },
          ],
          actions: ['notify'],
        },
      },
    ]);
  });

  it('leaves out whatever is switched off', () => {
    expect(wantedPostRules(['!a', '!b'], { comments: true, likes: false }).map((r) => r.ruleId)).toEqual([
      'xyz.nekous.feed_comment.!a',
      'xyz.nekous.feed_comment.!b',
    ]);
    expect(wantedPostRules(['!a'], { comments: false, likes: false })).toEqual([]);
  });
});

function fakeClient(existingRuleIds: string[], accountData: Record<string, unknown>) {
  return {
    pushRules: { global: { override: existingRuleIds.map((rule_id) => ({ rule_id })) } },
    getAccountData: (type: string) => (type in accountData ? { getContent: () => accountData[type] } : undefined),
    addPushRule: vi.fn(async () => ({})),
    deletePushRule: vi.fn(async () => ({})),
  };
}

describe('syncPostNotificationRules', () => {
  const owned = { 'xyz.nekous.profile_room': { roomId: '!profile' }, 'xyz.nekous.feed_rooms': { '!space': '!spacefeed' } };

  it('adds only the missing rules, for the profile feed and every Space feed', async () => {
    const mx = fakeClient(['xyz.nekous.feed_comment.!profile', '.m.rule.master', 'someone.elses.rule'], owned);
    await syncPostNotificationRules(mx as never, { comments: true, likes: true });
    expect(mx.addPushRule.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      'xyz.nekous.feed_like.!profile',
      'xyz.nekous.feed_comment.!spacefeed',
      'xyz.nekous.feed_like.!spacefeed',
    ]);
    expect(mx.deletePushRule).not.toHaveBeenCalled();
  });

  it('removes its own rules that are no longer wanted, and never anyone else’s', async () => {
    const mx = fakeClient(
      ['xyz.nekous.feed_like.!profile', 'xyz.nekous.feed_comment.!gone', '.m.rule.reaction', 'custom.rule'],
      owned
    );
    await syncPostNotificationRules(mx as never, { comments: false, likes: false });
    expect(mx.deletePushRule.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      'xyz.nekous.feed_like.!profile',
      'xyz.nekous.feed_comment.!gone',
    ]);
    expect(mx.addPushRule).not.toHaveBeenCalled();
  });

  it('changes nothing when the rules already match', async () => {
    const mx = fakeClient(['xyz.nekous.feed_comment.!profile', 'xyz.nekous.feed_like.!profile'], {
      'xyz.nekous.profile_room': { roomId: '!profile' },
    });
    await syncPostNotificationRules(mx as never, { comments: true, likes: true });
    expect(mx.addPushRule).not.toHaveBeenCalled();
    expect(mx.deletePushRule).not.toHaveBeenCalled();
  });
});
