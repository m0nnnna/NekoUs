import type { MatrixClient } from 'matrix-js-sdk';

/**
 * Account data as the server has it right now, for a read-modify-write.
 *
 * Matrix has no compare-and-swap for account data: a write replaces the whole value. Modifying the
 * copy this client last synced means a change another device made since (a private post saved on
 * the phone, a follow from another tab) is silently overwritten. Reading from the server first
 * shrinks that window from "since this client last synced" to one round trip. It can't close it;
 * nothing in the API can.
 *
 * Falls back to the synced copy if the server can't be asked, so a write still goes through.
 */
export async function readFreshAccountData<T extends object>(mx: MatrixClient, type: string): Promise<T | undefined> {
  try {
    const content = await mx.getAccountDataFromServer(type as any);
    return (content as T | null) ?? undefined;
  } catch {
    return mx.getAccountData(type as any)?.getContent<T>();
  }
}
