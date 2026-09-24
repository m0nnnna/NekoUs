/**
 * Golden vectors for `livekitRoomName`.
 *
 * The function is implemented twice — here in `livekitRoomName.ts` (Buffer) and in
 * `apps/web/src/matrix/voice.ts` (btoa) — because the two packages don't share one, and a token
 * minted for a name the client doesn't use produces a call where nobody can hear anyone and
 * nothing anywhere reports an error. "Keep these byte-identical" was only ever a comment, which
 * is not a thing that fails when someone stops doing it.
 *
 * **This file is duplicated verbatim at `apps/web/src/matrix/livekitRoomName.vectors.ts`, and
 * each package asserts its own implementation against it.** Duplicating the expectations rather
 * than the reasoning is the point: a change to either implementation now has to be matched in
 * both copies of this list to go green, which is exactly the moment someone should notice the
 * other implementation exists.
 */
export const LIVEKIT_ROOM_NAME_VECTORS: { roomId: string; expected: string }[] = [
  // The ordinary case.
  { roomId: '!abc:example.org', expected: 'matrix-IWFiYzpleGFtcGxlLm9yZw' },
  // Padding: base64 pads to a multiple of 4, and the padding is stripped. One of these three
  // lengths lands on each of the possible pad counts (0, 1, 2).
  { roomId: '!a:b.c', expected: 'matrix-IWE6Yi5j' },
  { roomId: '!ab:b.c', expected: 'matrix-IWFiOmIuYw' },
  { roomId: '!abc:b.c', expected: 'matrix-IWFiYzpiLmM' },
  // A server name carrying an explicit port — the colon is ordinary base64 input, but it's the
  // kind of room ID that tends to exist only on someone's self-hosted deployment.
  { roomId: '!room:example.org:8448', expected: 'matrix-IXJvb206ZXhhbXBsZS5vcmc6ODQ0OA' },
  // base64url: '+' and '/' must come out as '-' and '_'. Real room localparts are
  // server-generated and almost always alphanumeric, so these two are synthetic — chosen purely
  // because they land a '?' or a '>' on a 3-byte boundary, which is what forces each
  // substitution. The function is a pure string transform, so a synthetic input tests it fine.
  { roomId: '!a?>:b.c', expected: 'matrix-IWE_PjpiLmM' },
  { roomId: '!abc?>:b.c', expected: 'matrix-IWFiYz8-OmIuYw' },
];

/**
 * Non-ASCII is deliberately absent, and must stay absent. The two implementations genuinely
 * disagree on it — `btoa` treats each code unit as one byte while `Buffer.from(s, 'utf-8')`
 * encodes U+00FF as two — and they agree for every real room ID only because the Matrix spec
 * keeps room IDs ASCII. A vector here that asserted one answer would be asserting a bug.
 */
