import { AuthType, MatrixError, type MatrixClient } from 'matrix-js-sdk';

export type Session = {
  deviceId: string;
  displayName?: string;
  lastSeenIp?: string;
  lastSeenTs?: number;
  isCurrent: boolean;
};

/** Every device the account has ever logged in from, per the homeserver — not just ones this
 *  browser knows about. Sorted most-recently-active first. */
export async function listSessions(mx: MatrixClient): Promise<Session[]> {
  const { devices } = await mx.getDevices();
  const currentId = mx.getDeviceId();
  return devices
    .map((device) => ({
      deviceId: device.device_id,
      displayName: device.display_name,
      lastSeenIp: device.last_seen_ip,
      lastSeenTs: device.last_seen_ts,
      isCurrent: device.device_id === currentId,
    }))
    .sort((a, b) => (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0));
}

export async function renameSession(mx: MatrixClient, deviceId: string, displayName: string): Promise<void> {
  await mx.setDeviceDetails(deviceId, { display_name: displayName });
}

/**
 * Signs another device out. Most homeservers require User-Interactive Auth (re-confirming your
 * password) for this specifically — not a full generic UIA implementation, just the one flow
 * every real deployment actually uses: retry once with `m.login.password` if and only if the
 * server's 401 says that's an available stage. `getPassword` is only ever invoked when the
 * server actually asks for it, so a homeserver that doesn't require UIA here never prompts.
 * Returns without error if the user cancels the password prompt (`getPassword` resolves null).
 */
export async function signOutSession(
  mx: MatrixClient,
  deviceId: string,
  getPassword: () => Promise<string | null>
): Promise<void> {
  try {
    await mx.deleteDevice(deviceId);
  } catch (err) {
    if (!(err instanceof MatrixError) || err.httpStatus !== 401 || !err.data?.flows) throw err;
    const flows = err.data.flows as { stages: string[] }[];
    if (!flows.some((flow) => flow.stages.includes(AuthType.Password))) {
      throw new Error("This homeserver requires a sign-in method that isn't supported here.");
    }
    const password = await getPassword();
    if (password === null) return;
    const userId = mx.getUserId();
    if (!userId) throw err;
    await mx.deleteDevice(deviceId, {
      type: AuthType.Password,
      identifier: { type: 'm.id.user', user: userId },
      password,
      session: err.data.session,
    } as any);
  }
}
