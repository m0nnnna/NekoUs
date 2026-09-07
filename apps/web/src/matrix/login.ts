import { createClient, AutoDiscovery } from 'matrix-js-sdk';
import { setSession, type Session } from './session';

/**
 * Resolves a homeserver base URL from either a raw base URL (http/https) or a server name via
 * Matrix's standard .well-known auto-discovery (AutoDiscovery is matrix-js-sdk's own official
 * API for this — no need to hand-roll it the way cinny-voice's cs-api module did).
 */
export async function resolveHomeserverBaseUrl(server: string): Promise<string> {
  if (/^https?:\/\//i.test(server)) {
    return server.replace(/\/$/, '');
  }

  const discovery = await AutoDiscovery.findClientConfig(server);
  const homeserver = discovery['m.homeserver'];
  if (homeserver?.state !== 'SUCCESS' || !homeserver.base_url) {
    throw new Error(`Could not discover a homeserver for "${server}"`);
  }
  return homeserver.base_url.replace(/\/$/, '');
}

export async function loginWithPassword(
  server: string,
  username: string,
  password: string
): Promise<Session> {
  const baseUrl = await resolveHomeserverBaseUrl(server);
  const mx = createClient({ baseUrl });

  const res = await mx.loginRequest({
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: username },
    password,
  });

  const session: Session = {
    baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  setSession(session);
  return session;
}
