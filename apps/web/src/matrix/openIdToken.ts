import type { IOpenIDToken, MatrixClient } from 'matrix-js-sdk';

/** Asked for a fresh token this long before the current one expires. */
const REFRESH_MARGIN_MS = 60_000;

const cache = new WeakMap<MatrixClient, { token: IOpenIDToken; expiresAt: number }>();
const pending = new WeakMap<MatrixClient, Promise<IOpenIDToken>>();

/**
 * A Matrix OpenID token — proof of who you are to a third-party service (the token server)
 * without handing it your access token — reused until shortly before it expires. Things that
 * poll, like the voice channel list, would otherwise ask the homeserver for a new one every few
 * seconds.
 */
export function getOpenIdTokenCached(mx: MatrixClient): Promise<IOpenIDToken> {
  const cached = cache.get(mx);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return Promise.resolve(cached.token);

  const inFlight = pending.get(mx);
  if (inFlight) return inFlight;

  const request = mx
    .getOpenIdToken()
    .then((token) => {
      cache.set(mx, { token, expiresAt: Date.now() + (token.expires_in ?? 0) * 1000 });
      return token;
    })
    .finally(() => pending.delete(mx));
  pending.set(mx, request);
  return request;
}
