import { describe, expect, it } from 'vitest';
import { findSlashCommand, parseSlashInput, SLASH_COMMANDS } from './slashCommands';

describe('parseSlashInput', () => {
  it('returns null for plain text', () => {
    expect(parseSlashInput('hello world')).toBeNull();
  });

  it('parses a command with no arguments', () => {
    expect(parseSlashInput('/leave')).toEqual({ type: 'command', name: 'leave', args: '' });
  });

  it('parses a command with arguments', () => {
    expect(parseSlashInput('/kick @alice:example.org being rude')).toEqual({
      type: 'command',
      name: 'kick',
      args: '@alice:example.org being rude',
    });
  });

  it('treats a leading "//" as an escaped literal message starting with "/"', () => {
    expect(parseSlashInput('//not/a/command')).toEqual({ type: 'escaped', text: '/not/a/command' });
  });
});

describe('findSlashCommand', () => {
  it('finds a registered command case-insensitively', () => {
    expect(findSlashCommand('ME')?.name).toBe('me');
  });

  it('returns undefined for an unknown command', () => {
    expect(findSlashCommand('nonexistent')).toBeUndefined();
  });

  it('every registered command has a non-empty usage and description', () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.usage).toContain(`/${command.name}`);
      expect(command.description.length).toBeGreaterThan(0);
    }
  });
});
