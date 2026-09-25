import { describe, expect, it } from 'vitest';
import { describeTyping, sanitizeTypingVerb, TYPING_VERB_MAX_LENGTH } from './typingVerb';

describe('sanitizeTypingVerb', () => {
  it('keeps an ordinary verb as typed', () => {
    expect(sanitizeTypingVerb('yelling')).toBe('yelling');
    expect(sanitizeTypingVerb('plotting something')).toBe('plotting something');
  });

  it('drops the "is" and the dots the indicator adds itself', () => {
    expect(sanitizeTypingVerb('is yelling...')).toBe('yelling');
    expect(sanitizeTypingVerb('Is purring…')).toBe('purring');
  });

  it('keeps it to one clean line', () => {
    expect(sanitizeTypingVerb('  yelling\n\nloudly\t ')).toBe('yelling loudly');
    // A bidi override could flip the rest of the line; zero-width characters hide text.
    expect(sanitizeTypingVerb('yel‮ling​')).toBe('yelling');
  });

  it('caps the length, counting characters rather than UTF-16 units', () => {
    expect([...sanitizeTypingVerb('a'.repeat(100))]).toHaveLength(TYPING_VERB_MAX_LENGTH);
    expect([...sanitizeTypingVerb('😼'.repeat(40))]).toHaveLength(TYPING_VERB_MAX_LENGTH);
  });

  it('treats anything that is not text, or nothing left after cleaning, as unset', () => {
    expect(sanitizeTypingVerb(undefined)).toBe('');
    expect(sanitizeTypingVerb(42)).toBe('');
    expect(sanitizeTypingVerb(' ... ')).toBe('');
  });
});

describe('describeTyping', () => {
  it('uses each person’s own verb, falling back to "typing"', () => {
    expect(describeTyping([{ name: 'Alice', verb: 'yelling' }])).toBe('Alice is yelling…');
    expect(describeTyping([{ name: 'Alice' }])).toBe('Alice is typing…');
  });

  it('pairs two people, sharing the verb when it is the same', () => {
    expect(describeTyping([{ name: 'Alice', verb: 'yelling' }, { name: 'Bob' }])).toBe('Alice is yelling and Bob is typing…');
    expect(describeTyping([{ name: 'Alice' }, { name: 'Bob' }])).toBe('Alice and Bob are typing…');
    expect(describeTyping([{ name: 'Alice', verb: 'purring' }, { name: 'Bob', verb: 'purring' }])).toBe(
      'Alice and Bob are purring…'
    );
  });

  it('counts three or more plainly', () => {
    expect(describeTyping([{ name: 'A', verb: 'yelling' }, { name: 'B' }, { name: 'C' }])).toBe('3 people are typing…');
  });
});
