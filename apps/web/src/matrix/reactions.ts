import { EventType, RelationType, type MatrixClient } from 'matrix-js-sdk';

/** Sends an `m.reaction` annotation — see `useReactions.ts` for how these get aggregated back. */
export async function sendReaction(mx: MatrixClient, roomId: string, eventId: string, key: string): Promise<void> {
  await mx.sendEvent(roomId, EventType.Reaction, {
    'm.relates_to': { rel_type: RelationType.Annotation, event_id: eventId, key },
  });
}

/** Un-reacting is redacting your own reaction event, same as any other message. */
export async function removeReaction(mx: MatrixClient, roomId: string, reactionEventId: string): Promise<void> {
  await mx.redactEvent(roomId, reactionEventId);
}
