import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { livekitRoomName } from './livekitRoomName.js';
import { LIVEKIT_ROOM_NAME_VECTORS } from './livekitRoomName.vectors.js';

describe('livekitRoomName', () => {
  // The web client asserts its own copy of this function against an identical vector list, so a
  // change here that isn't mirrored there fails in one package or the other rather than silently
  // producing calls where the two sides join differently named LiveKit rooms.
  LIVEKIT_ROOM_NAME_VECTORS.forEach(({ roomId, expected }) => {
    it(`derives ${expected} from ${roomId}`, () => {
      assert.equal(livekitRoomName(roomId), expected);
    });
  });

  it('is reversible, which is the whole reason it is base64 and not a hash', () => {
    const roomId = '!abc:example.org';
    const encoded = livekitRoomName(roomId).slice('matrix-'.length);
    assert.equal(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(), roomId);
  });
});
