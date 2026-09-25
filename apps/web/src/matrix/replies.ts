import type { MatrixEvent } from 'matrix-js-sdk';

/** The `m.in_reply_to` target of a quote-reply, if this event is one — Matrix's reply relation
 *  predates the newer `rel_type`-based ones (edits, threads, reactions) and lives at
 *  `m.relates_to.m.in_reply_to.event_id` instead. No plain-text/HTML fallback body is sent
 *  alongside it (see matrix/replies.ts's buildReplyRelation) — a deliberate scope cut like the
 *  rest of this app's Matrix-feature narrowing: clients without reply support just won't show
 *  the quoted context, which is an acceptable tradeoff for a Purrlor-authored message. */
export function getReplyEventId(event: MatrixEvent): string | undefined {
  return event.getContent()?.['m.relates_to']?.['m.in_reply_to']?.event_id;
}

export function buildReplyRelation(eventId: string): { 'm.in_reply_to': { event_id: string } } {
  return { 'm.in_reply_to': { event_id: eventId } };
}

/** What the composer needs to know about the message being replied to — set from a timeline
 *  row's "Reply" action, cleared once the reply actually sends (see MainPane.tsx). */
export type ReplyTarget = {
  eventId: string;
  senderName: string;
  preview: string;
};
