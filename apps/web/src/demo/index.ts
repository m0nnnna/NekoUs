import type { MatrixClient } from 'matrix-js-sdk';
import { DEMO_BOT_USER_ID, DEMO_USER_ID } from './demoMode';
import { createDemoClient } from './demoClient';
import { DEMO_MEMBERS, DEMO_ROOM_IDS } from './demoWorld';
import { installDemoTokenServer, setDemoOccupants } from './demoTokenServer';

/**
 * Demo mode's single entry point, loaded through a dynamic `import()` from App.tsx so none of
 * this reaches the bundle of an app that's running against a real homeserver.
 */
export function startDemo(): MatrixClient {
  const mx = createDemoClient();

  // The fake token server answers from the same room state the UI renders, so inviting the bot
  // in the app really does unblock the next token request.
  installDemoTokenServer((roomId) => mx.getRoom(roomId)?.getMember(DEMO_BOT_USER_ID)?.membership === 'join');

  // Someone already sitting in the Lounge, so the channel list's occupancy row has something to
  // show without needing a call to actually connect.
  setDemoOccupants(DEMO_ROOM_IDS.lounge, [
    { identity: DEMO_MEMBERS[1].userId, micMuted: false, deafened: false },
    { identity: DEMO_MEMBERS[2].userId, micMuted: true, deafened: false },
    { identity: DEMO_MEMBERS[3].userId, micMuted: true, deafened: true },
  ]);

  return mx;
}

export { DEMO_USER_ID };
