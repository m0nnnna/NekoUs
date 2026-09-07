export type Session = {
  baseUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
};

const KEYS = {
  baseUrl: 'nekous_hs_base_url',
  userId: 'nekous_user_id',
  deviceId: 'nekous_device_id',
  accessToken: 'nekous_access_token',
} as const;

export function setSession(session: Session): void {
  localStorage.setItem(KEYS.accessToken, session.accessToken);
  localStorage.setItem(KEYS.deviceId, session.deviceId);
  localStorage.setItem(KEYS.userId, session.userId);
  localStorage.setItem(KEYS.baseUrl, session.baseUrl);
}

export function getSession(): Session | undefined {
  const baseUrl = localStorage.getItem(KEYS.baseUrl);
  const userId = localStorage.getItem(KEYS.userId);
  const deviceId = localStorage.getItem(KEYS.deviceId);
  const accessToken = localStorage.getItem(KEYS.accessToken);

  if (baseUrl && userId && deviceId && accessToken) {
    return { baseUrl, userId, deviceId, accessToken };
  }
  return undefined;
}

export function clearSession(): void {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
}
