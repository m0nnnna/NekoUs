export type OpenIdTokenInput = {
  access_token: string;
  matrix_server_name: string;
};

/**
 * Validates a Matrix OpenID token by asking the claimed homeserver to confirm it — this is
 * federation's standard "prove who I am to a third party" mechanism, and it works for a user on
 * ANY homeserver federated into the space, not just this deployment's own.
 *
 * Simplification worth knowing: this hits `https://{matrix_server_name}/_matrix/federation/...`
 * directly rather than implementing full federation server discovery (`.well-known/matrix/server`
 * delegation, SRV records, the :8448 fallback). That's fine for a standard self-hosted setup
 * reverse-proxied on 443 (this project's own deployment included) but won't work for a
 * homeserver that delegates its federation API to a different host/port without a matching
 * direct HTTPS path at its own server_name.
 */
export async function validateOpenIdToken(input: OpenIdTokenInput): Promise<string> {
  const accessToken = input?.access_token;
  const serverName = input?.matrix_server_name;
  if (!accessToken || !serverName) {
    throw new Error('Invalid OpenID token payload');
  }

  const url = `https://${serverName}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(accessToken)}`;
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
