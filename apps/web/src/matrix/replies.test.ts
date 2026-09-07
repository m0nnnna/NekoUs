import { describe, expect, it } from 'vitest';
import { buildReplyRelation, getReplyEventId } from './replies';

function fakeEvent(content: Record<string, unknown>) {
  return { getContent: () => content } as unknown as Parameters<typeof getReplyEventId>[0];
}

describe('getReplyEventId', () => {
  it('extracts the in-reply-to event id when present', () => {
    const event = fakeEvent({ 'm.relates_to': { 'm.in_reply_to': { event_id: '$abc123' } } });
    expect(getReplyEventId(event)).toBe('$abc123');
  });

  it('returns undefined for a plain message with no relation', () => {
    const event = fakeEvent({ body: 'hello' });
    expect(getReplyEventId(event)).toBeUndefined();
  });

  it('returns undefined for a different relation type (e.g. an edit)', () => {
    const event = fakeEvent({ 'm.relates_to': { rel_type: 'm.replace', event_id: '$abc123' } });
    expect(getReplyEventId(event)).toBeUndefined();
  });
});

describe('buildReplyRelation', () => {
  it('builds the m.in_reply_to shape for a given event id', () => {
    expect(buildReplyRelation('$xyz789')).toEqual({ 'm.in_reply_to': { event_id: '$xyz789' } });
  });
});
