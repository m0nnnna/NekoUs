import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';

/**
 * Forwards a message's content as a new message in a different room. Copies the content object
 * as-is — `event.getContent()` is already the decrypted plaintext for an encrypted source room,
 * and `sendMessage` re-encrypts it for whichever room it's actually going to — but drops
 * relation fields (reply/edit/thread) that only made sense pointing at the original room's
 * events, not the target's.
 */
export async function forwardMessage(mx: MatrixClient, targetRoomId: string, event: MatrixEvent): Promise<void> {
  const content = { ...event.getContent() };
  delete content['m.relates_to'];
  delete content['m.new_content'];
  // Forwarding is inherently generic over msgtype (text, image, file, ...) — event.getContent()
  // is only ever loosely typed (IContent), so there's no RoomMessageEventContent variant to
  // structurally match here.
  await mx.sendMessage(targetRoomId, null, content as any);
}
