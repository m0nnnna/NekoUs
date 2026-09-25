import type { MatrixClient } from 'matrix-js-sdk';
import { readFreshAccountData } from './freshAccountData';

/**
 * Who and what you follow, for the global feed's Following timeline. Stored in your own account
 * data: nobody else can see your follow list, and nothing is sent to the people or Spaces you
 * follow — following is a filter on what you read, not a relationship anyone else is told about.
 */
export const FOLLOWS_ACCOUNT_DATA = 'xyz.nekous.follows';

export type Follows = { users: string[]; spaces: string[] };

const EMPTY: Follows = { users: [], spaces: [] };

function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && !!item) : [];
}

export function readFollows(mx: MatrixClient): Follows {
  const content = mx.getAccountData(FOLLOWS_ACCOUNT_DATA as any)?.getContent<Record<string, unknown>>();
  if (!content) return EMPTY;
  return { users: stringList(content.users), spaces: stringList(content.spaces) };
}

/** Pure toggle, so the list logic is testable without a client. */
export function toggleFollow(follows: Follows, kind: 'user' | 'space', id: string): Follows {
  const key = kind === 'user' ? 'users' : 'spaces';
  const list = follows[key];
  const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  return { ...follows, [key]: next };
}

/** Toggles against the list as the server has it now, so a follow made on another device a moment
 *  ago isn't dropped (freshAccountData.ts). */
export async function setFollowing(mx: MatrixClient, kind: 'user' | 'space', id: string): Promise<void> {
  const fresh = await readFreshAccountData<Record<string, unknown>>(mx, FOLLOWS_ACCOUNT_DATA);
  const current: Follows = fresh ? { users: stringList(fresh.users), spaces: stringList(fresh.spaces) } : readFollows(mx);
  await mx.setAccountData(FOLLOWS_ACCOUNT_DATA as any, toggleFollow(current, kind, id) as any);
}
