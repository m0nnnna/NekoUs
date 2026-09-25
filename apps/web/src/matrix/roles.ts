/**
 * Named roles over Matrix's raw power levels — the same three tiers the Space Settings members
 * tab already promotes/demotes between (see SpaceMembersSettings.tsx). Matrix has no role
 * objects of its own, only integers; this is the one place that decides what a number *means*
 * to a person looking at the member list or a message's sender name.
 */
export type RoleId = 'admin' | 'moderator' | 'member';

export type RoleLevel = { id: RoleId; label: string; pluralLabel: string; value: number };

export const ROLE_LEVELS: RoleLevel[] = [
  { id: 'admin', label: 'Admin', pluralLabel: 'Admins', value: 100 },
  { id: 'moderator', label: 'Moderator', pluralLabel: 'Moderators', value: 50 },
  { id: 'member', label: 'Member', pluralLabel: 'Members', value: 0 },
];

export function roleFor(powerLevel: number): RoleLevel {
  return ROLE_LEVELS.find((role) => powerLevel >= role.value) ?? ROLE_LEVELS[ROLE_LEVELS.length - 1];
}

/** A member's handle for display under their name — the localpart of their Matrix ID
 *  (`@neko:example.org` → `@neko`), the part people actually recognize and type in mentions. */
export function handleFor(userId: string): string {
  const colon = userId.indexOf(':');
  return colon > 0 ? userId.slice(0, colon) : userId;
}
