export type LiveKitGrants = {
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  canUpdateOwnMetadata: boolean;
  roomAdmin?: boolean;
};

/**
 * Maps a user's Matrix power level in the room to LiveKit grant flags — this replaces a
 * separate roles table entirely. Default threshold matches Matrix's own conventional moderator
 * level (50); tunable via env if a deployment wants something different.
 */
const MODERATOR_POWER_LEVEL = Number(process.env.VOICE_MODERATOR_POWER_LEVEL ?? 50);

export function grantsForPowerLevel(powerLevel: number): LiveKitGrants {
  const isModerator = powerLevel >= MODERATOR_POWER_LEVEL;
  return {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    // Needed for the deafened indicator: VoiceChannelPanel.tsx broadcasts your own deafened
    // state via localParticipant.setAttributes, which LiveKit rejects without this grant.
    canUpdateOwnMetadata: true,
    ...(isModerator ? { roomAdmin: true } : {}),
  };
}
