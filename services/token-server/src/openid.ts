import { promises as dns } from 'node:dns';

export type OpenIdTokenInput = {
  access_token: string;
  matrix_server_name: string;
};

/**
 * Where a homeserver's *federation* API actually lives, which is frequently not
 * `https://{server_name}/`. A domain commonly delegates federation to a different host
 * (`matrix.example.com`) so that `example.com` can stay a plain website, and the spec defines an
 * ordered resolution for finding it. Asking `https://{server_name}/_matrix/...` directly — which
 * is all this used to do — works only for the subset of deployments that serve federation from
 * their own apex on 443, and fails with a 404 against a perfectly ordinary delegated setup.
 *
 * Implements the spec's resolution order (steps 3-5 of "Resolving server names"), minus the two
 * literal-IP/explicit-port cases that are handled up front by just using the name as given:
 *
 *  1. `https://{name}/.well-known/matrix/server` → its `m.server` value, used as the host.
 *  2. `_matrix-fed._tcp.{name}` SRV, then the deprecated `_matrix._tcp.{name}`.
 *  3. `{name}:8448`, the default federation port.
 *
 * Note this resolves the *host to connect to*, not a TLS name to validate against — a full
 * federation client also has to keep sending the original server name as `Host` and validate the
 * certificate against the delegated name. Since all this does is a plain HTTPS GET to a public
 * endpoint and reads one field out of the answer, the ordinary TLS validation Node performs
 * against the resolved host is what's wanted here.
 */

/** Resolution costs up to three network round trips, and a token server validates constantly
 *  against the same handful of homeservers. Cached for an hour — long enough to matter, short
 *  enough that moving a homeserver's delegation doesn't need a restart. */
const DELEGATION_TTL_MS = 60 * 60 * 1000;
const delegationCache = new Map<string, { host: string; expiresAt: number }>();

/** A name that already carries an explicit port, or is a literal IP, is used as-is per spec —
 *  no delegation is looked up for either. */
function isExplicitlyAddressed(serverName: string): boolean {
  if (serverName.startsWith('[')) return true; // IPv6 literal, with or without a port
  const parts = serverName.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(serverName);
}

async function fromWellKnown(serverName: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://${serverName}/.well-known/matrix/server`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { 'm.server'?: unknown };
    const target = data['m.server'];
    return typeof target === 'string' && target ? target : undefined;
  } catch {
    return undefined; // No delegation published, or unreachable — fall through to SRV.
  }
}

async function fromSrv(serverName: string): Promise<string | undefined> {
  for (const service of [`_matrix-fed._tcp.${serverName}`, `_matrix._tcp.${serverName}`]) {
    try {
      const records = await dns.resolveSrv(service);
      const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      if (best) return `${best.name.replace(/\.$/, '')}:${best.port}`;
    } catch {
      // NXDOMAIN for a server that publishes no SRV is the common case, not an error.
    }
  }
  return undefined;
}

async function resolveFederationHost(serverName: string): Promise<string> {
  if (isExplicitlyAddressed(serverName)) return serverName;

  const cached = delegationCache.get(serverName);
  if (cached && cached.expiresAt > Date.now()) return cached.host;

  const host = (await fromWellKnown(serverName)) ?? (await fromSrv(serverName)) ?? `${serverName}:8448`;
  delegationCache.set(serverName, { host, expiresAt: Date.now() + DELEGATION_TTL_MS });
  return host;
}

/**
 * Validates a Matrix OpenID token by asking the claimed homeserver to confirm it — this is
 * federation's standard "prove who I am to a third party" mechanism, and it works for a user on
 * ANY homeserver federated into the space, not just this deployment's own.
 *
 * Proving *identity* is all this does. Whether that identity may have a token for the room it is
 * asking about is a separate question, answered by `tenancy.ts` and `membership.ts`.
 */
export async function validateOpenIdToken(input: OpenIdTokenInput): Promise<string> {
  const accessToken = input?.access_token;
  const serverName = input?.matrix_server_name;
  if (!accessToken || !serverName) {
    throw new Error('Invalid OpenID token payload');
  }

  const host = await resolveFederationHost(serverName);
  const url = `https://${host}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OpenID validation failed: ${res.status}`);
  }
  const data = (await res.json()) as { sub?: string };
  if (!data.sub) {
    throw new Error('OpenID validation response missing sub');
  }
  return data.sub;
}

/** Test seam: resolution caches for an hour, which would otherwise leak between test cases. */
export function clearFederationDelegationCache(): void {
  delegationCache.clear();
}
