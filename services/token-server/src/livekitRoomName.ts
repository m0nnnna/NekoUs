/**
 * Must stay byte-identical to apps/web/src/matrix/voice.ts's copy of this function — documented
 * once in docs/voice-architecture.md as the single source of truth. Matrix room IDs are always
 * ASCII (spec-restricted opaque localpart + a DNS-hostname-or-IP server name), so UTF-8 and
 * "binary string" (the browser's btoa) encodings of the same room ID produce identical bytes —
 * this and the frontend's `btoa`-based version will always agree for any real room ID.
 */
export function livekitRoomName(matrixRoomId: string): string {
  const base64 = Buffer.from(matrixRoomId, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `matrix-${base64}`;
}
