import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PushSubscription } from 'web-push';
import {
  claimSubscription,
  clearSubscriptions,
  deleteSubscription,
  getSubscription,
  releaseSubscription,
} from './subscriptions.js';

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) as PushSubscription;

beforeEach(() => clearSubscriptions());

describe('push subscriptions are owned by the account that registered them', () => {
  it('saves a new pushkey for its owner, and lets the owner refresh it', () => {
    assert.equal(claimSubscription('key1', '@alice:x', sub('https://push/1')), 'saved');
    assert.equal(claimSubscription('key1', '@alice:x', sub('https://push/1b')), 'saved');
    assert.equal(getSubscription('key1')?.subscription.endpoint, 'https://push/1b');
  });

  it("refuses another account's claim on a pushkey, so notifications can't be redirected", () => {
    claimSubscription('key1', '@alice:x', sub('https://push/alice'));
    assert.equal(claimSubscription('key1', '@mallory:y', sub('https://push/mallory')), 'taken');
    assert.equal(getSubscription('key1')?.subscription.endpoint, 'https://push/alice');
    assert.equal(getSubscription('key1')?.owner, '@alice:x');
  });

  it('only lets the owner remove a subscription', () => {
    claimSubscription('key1', '@alice:x', sub('https://push/alice'));
    assert.equal(releaseSubscription('key1', '@mallory:y'), false);
    assert.ok(getSubscription('key1'));
    assert.equal(releaseSubscription('key1', '@alice:x'), true);
    assert.equal(getSubscription('key1'), undefined);
  });

  it('forgets a subscription the push service reports gone, whoever owned it', () => {
    claimSubscription('key1', '@alice:x', sub('https://push/alice'));
    deleteSubscription('key1');
    assert.equal(getSubscription('key1'), undefined);
  });
});

describe('openid.ts', () => {
  // The gateway validates Matrix OpenID tokens exactly as the token server does, from a copy of
  // its file. Two copies of security code that drift apart is how one of them ends up wrong.
  it('is identical to the token server’s copy', () => {
    const here = readFileSync(new URL('./openid.ts', import.meta.url), 'utf8');
    const there = readFileSync(new URL('../../token-server/src/openid.ts', import.meta.url), 'utf8');
    assert.equal(here, there, 'services/push-gateway/src/openid.ts must match services/token-server/src/openid.ts');
  });
});
