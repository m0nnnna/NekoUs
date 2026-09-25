import type { MatrixClient } from 'matrix-js-sdk';

/**
 * Matrix's "ignore" is the closest equivalent to Discord's block — it's account data
 * (`m.ignored_user_list`) rather than a room-membership action, so it applies everywhere at
 * once. On homeservers that support it server-side (Synapse does), an ignored user's events are
 * filtered out of `/sync` entirely; matrix-js-sdk doesn't additionally filter them client-side,
 * so the chat timeline doesn't either. Posts and comments do (useIgnoredUsers): they're also read
 * over `/messages` and `/relations`, which a server isn't guaranteed to filter.
 */
export function isUserIgnored(mx: MatrixClient, userId: string): boolean {
  return mx.getIgnoredUsers().includes(userId);
}

export async function ignoreUser(mx: MatrixClient, userId: string): Promise<void> {
  const current = mx.getIgnoredUsers();
  if (current.includes(userId)) return;
  await mx.setIgnoredUsers([...current, userId]);
}

export async function unignoreUser(mx: MatrixClient, userId: string): Promise<void> {
  await mx.setIgnoredUsers(mx.getIgnoredUsers().filter((id) => id !== userId));
}
