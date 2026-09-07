import type { MatrixClient } from 'matrix-js-sdk';

export async function redactMessage(mx: MatrixClient, roomId: string, eventId: string): Promise<void> {
  await mx.redactEvent(roomId, eventId);
}
