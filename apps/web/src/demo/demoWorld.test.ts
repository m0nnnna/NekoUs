import { describe, expect, it } from 'vitest';
import { getChannelCategories } from '../matrix/channelCategories';
import { readChannelType } from '../matrix/channelType';
import { canInviteToRoom } from '../matrix/permissions';
import { getParentSpace, readVoiceServerConfig } from '../matrix/voice';
import { voiceBotPresence } from '../matrix/voiceBot';
import { createDemoClient } from './demoClient';
import { DEMO_ROOM_IDS } from './demoWorld';
import { DEMO_BOT_USER_ID, DEMO_USER_ID } from './demoMode';

/**
 * These assert the demo world through the app's *own* reader functions rather than by poking at
 * the seed data — so they fail if the seeds stop satisfying what the real UI asks of a room,
 * which is the only thing that makes demo mode worth having.
 */
describe('demo world', () => {
  it('builds spaces the server rail will list', () => {
    const mx = createDemoClient();
    const spaces = mx.getRooms().filter((r) => r.isSpaceRoom() && r.getMyMembership() === 'join');
    expect(spaces.map((s) => s.name).sort()).toEqual(['Cat Café', 'Pixel Arcade']);
  });

  it('marks voice channels so the channel list renders them as voice', () => {
    const mx = createDemoClient();
    expect(readChannelType(mx.getRoom(DEMO_ROOM_IDS.lounge)!)).toBe('voice');
    expect(readChannelType(mx.getRoom(DEMO_ROOM_IDS.afk)!)).toBe('voice');
    expect(readChannelType(mx.getRoom(DEMO_ROOM_IDS.general)!)).toBe('text');
  });

  it('links every channel back to its Space, which is how voice finds its server', () => {
    const mx = createDemoClient();
    expect(getParentSpace(mx, mx.getRoom(DEMO_ROOM_IDS.lounge)!)?.roomId).toBe(DEMO_ROOM_IDS.cafe);
    expect(getParentSpace(mx, mx.getRoom(DEMO_ROOM_IDS.gameNight)!)?.roomId).toBe(DEMO_ROOM_IDS.arcade);
  });

  it('configures voice on one Space and deliberately leaves the other bare', () => {
    const mx = createDemoClient();
    const cafe = readVoiceServerConfig(mx, mx.getRoom(DEMO_ROOM_IDS.cafe)!);
    expect(cafe?.botUserId).toBe(DEMO_BOT_USER_ID);
    expect(cafe?.url).toMatch(/^wss:\/\//);
    expect(readVoiceServerConfig(mx, mx.getRoom(DEMO_ROOM_IDS.arcade)!)).toBeUndefined();
  });

  it('seeds one voice channel with the bot present and one without', () => {
    // The pair that makes the bot-invite flow visible: Lounge is ready to go, AFK exercises
    // ensureVoiceBotInvited and the 409 retry.
    const mx = createDemoClient();
    const config = readVoiceServerConfig(mx, mx.getRoom(DEMO_ROOM_IDS.cafe)!);
    expect(voiceBotPresence(mx, mx.getRoom(DEMO_ROOM_IDS.lounge)!, config)).toEqual({ status: 'present' });
    expect(voiceBotPresence(mx, mx.getRoom(DEMO_ROOM_IDS.afk)!, config)).toEqual({
      status: 'missing',
      canInvite: true,
    });
  });

  it('gives the demo user enough power to reach the admin UI', () => {
    const mx = createDemoClient();
    expect(canInviteToRoom(mx.getRoom(DEMO_ROOM_IDS.afk)!, DEMO_USER_ID)).toBe(true);
    expect(mx.getRoom(DEMO_ROOM_IDS.cafe)!.getMember(DEMO_USER_ID)?.powerLevel).toBe(100);
  });

  it('seeds channel categories for the configured Space', () => {
    const mx = createDemoClient();
    const categories = getChannelCategories(mx.getRoom(DEMO_ROOM_IDS.cafe)!);
    expect(categories.map((c) => c.name)).toEqual(['Text channels', 'Voice channels']);
    expect(categories[1].channelIds).toContain(DEMO_ROOM_IDS.lounge);
  });

  it('puts messages on the timeline, including a mention of the demo user', () => {
    const mx = createDemoClient();
    const events = mx.getRoom(DEMO_ROOM_IDS.general)!.getLiveTimeline().getEvents();
    expect(events.length).toBeGreaterThan(5);
    expect(events.some((e) => e.getContent()['m.mentions'] !== undefined)).toBe(true);
    expect(events.some((e) => e.getType() === 'm.reaction')).toBe(true);
  });

  it('keeps DMs out of every Space so they land in the Home list', () => {
    const mx = createDemoClient();
    const dm = mx.getRoom(DEMO_ROOM_IDS.dmNibbles)!;
    expect(getParentSpace(mx, dm)).toBeUndefined();
    expect(dm.getJoinedMembers()).toHaveLength(2);
  });
});

describe('demo client writes', () => {
  it('appends a sent message to the real timeline', async () => {
    const mx = createDemoClient();
    const room = mx.getRoom(DEMO_ROOM_IDS.general)!;
    const before = room.getLiveTimeline().getEvents().length;

    await mx.sendTextMessage(DEMO_ROOM_IDS.general, 'typed in the demo');

    const events = room.getLiveTimeline().getEvents();
    expect(events).toHaveLength(before + 1);
    expect(events[events.length - 1].getContent().body).toBe('typed in the demo');
  });

  it('applies a state event so settings forms read back what they saved', async () => {
    const mx = createDemoClient();
    const space = mx.getRoom(DEMO_ROOM_IDS.arcade)!;
    expect(readVoiceServerConfig(mx, space)).toBeUndefined();

    await mx.sendStateEvent(
      DEMO_ROOM_IDS.arcade,
      'xyz.nekous.voice_server' as never,
      { url: 'wss://x', tokenEndpoint: 'https://y', botUserId: DEMO_BOT_USER_ID } as never,
      ''
    );

    expect(readVoiceServerConfig(mx, space)?.tokenEndpoint).toBe('https://y');
  });

  it('has the service bot accept its invite, the way the real one does', async () => {
    const mx = createDemoClient();
    const afk = mx.getRoom(DEMO_ROOM_IDS.afk)!;
    expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBeUndefined();

    await mx.invite(DEMO_ROOM_IDS.afk, DEMO_BOT_USER_ID);
    expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBe('invite');

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(afk.getMember(DEMO_BOT_USER_ID)?.membership).toBe('join');
  });
});
