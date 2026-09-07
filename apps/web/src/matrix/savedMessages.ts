import type { MatrixClient } from 'matrix-js-sdk';

/**
 * A private, per-user bookmark list — plain account data, so it's never visible to anyone but
 * you (unlike Pinned Messages, which is room-wide and everyone sees). Deliberately separate
 * from pins: pinning something says "this matters to the room," saving it says "I want to find
 * this again," and those aren't always the same message.
 */
const SAVED_MESSAGES_EVENT = 'xyz.nekous.saved_messages';

export type SavedMessageRef = { roomId: string; eventId: string; savedAt: number };
type SavedMessagesContent = { items?: SavedMessageRef[] };

export function readSavedMessages(mx: MatrixClient): SavedMessageRef[] {
  const content = mx.getAccountData(SAVED_MESSAGES_EVENT as any)?.getContent<SavedMessagesContent>();
  return content?.items ?? [];
}

export function isMessageSaved(mx: MatrixClient, roomId: string, eventId: string): boolean {
  return readSavedMessages(mx).some((item) => item.roomId === roomId && item.eventId === eventId);
}

export async function saveMessage(mx: MatrixClient, roomId: string, eventId: string): Promise<void> {
  const existing = readSavedMessages(mx);
  if (existing.some((item) => item.roomId === roomId && item.eventId === eventId)) return;
  const items = [...existing, { roomId, eventId, savedAt: Date.now() }];
  await mx.setAccountData(SAVED_MESSAGES_EVENT as any, { items } as any);
}

export async function unsaveMessage(mx: MatrixClient, roomId: string, eventId: string): Promise<void> {
  const items = readSavedMessages(mx).filter((item) => !(item.roomId === roomId && item.eventId === eventId));
  await mx.setAccountData(SAVED_MESSAGES_EVENT as any, { items } as any);
}
