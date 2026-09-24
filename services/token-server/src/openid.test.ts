import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clearFederationDelegationCache, validateOpenIdToken } from './openid.js';

/**
 * A homeserver's federation API is frequently not at its server name — delegating it to
 * `matrix.example.com` so the apex can stay a website is an entirely ordinary setup, and
 * assuming otherwise 404s against it.
 */
describe('openid federation discovery', () => {
  it('uses a name with an explicit port as given, without a delegation lookup', async () => {
    // Guards the spec's "already addressed" shortcut: looking up .well-known for a name that
    // already names a host and port would be both wrong and a wasted round trip.
    clearFederationDelegationCache();
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return { ok: true, json: async () => ({ sub: '@me:example.org:8448' }) } as unknown as Response;
    }) as typeof fetch;

    try {
      await validateOpenIdToken({ access_token: 'tok', matrix_server_name: 'example.org:8448' });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith('https://example.org:8448/_matrix/federation/v1/openid/userinfo'));
  });

  it('follows .well-known delegation to the host it names', async () => {
    clearFederationDelegationCache();
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/.well-known/matrix/server')) {
        return { ok: true, json: async () => ({ 'm.server': 'matrix.example.org:8448' }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ sub: '@me:example.org' }) } as unknown as Response;
    }) as typeof fetch;

    try {
      const sub = await validateOpenIdToken({ access_token: 'tok', matrix_server_name: 'example.org' });
      assert.equal(sub, '@me:example.org');
    } finally {
      globalThis.fetch = realFetch;
    }

    // The apex published a delegation, so the userinfo call goes to the delegated host — which
    // is the whole case that used to 404 against a perfectly ordinary deployment.
    assert.ok(urls[1].startsWith('https://matrix.example.org:8448/_matrix/federation/v1/openid/userinfo'));
  });

  it('caches a resolution rather than re-resolving per token', async () => {
    clearFederationDelegationCache();
    let wellKnownCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/.well-known/matrix/server')) {
        wellKnownCalls += 1;
        return { ok: true, json: async () => ({ 'm.server': 'matrix.example.org' }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ sub: '@me:example.org' }) } as unknown as Response;
    }) as typeof fetch;

    try {
      await validateOpenIdToken({ access_token: 'a', matrix_server_name: 'example.org' });
      await validateOpenIdToken({ access_token: 'b', matrix_server_name: 'example.org' });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(wellKnownCalls, 1);
  });
});
