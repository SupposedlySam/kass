import { expect, test } from 'bun:test';
import { chordTakenBy } from '../src/lib/utils/chordConflicts';

const settings = {
  chord_push_to_talk_keys: ['MetaRight', 'AltGr'],
  chord_toggle_to_talk_keys: ['MetaRight', 'AltGr', 'Space'],
  chord_command_keys: ['MetaRight', 'ShiftRight'],
  chord_speak_keys: ['AltGr', 'ShiftRight'],
};

test('a shortcut can keep its own keys', () => {
  expect(chordTakenBy(['AltGr', 'ShiftRight'], 'speak', settings)).toBeNull();
  expect(chordTakenBy(['MetaRight', 'AltGr'], 'push', settings)).toBeNull();
});

test('keys another shortcut uses are taken, whatever order they were pressed in', () => {
  expect(chordTakenBy(['ShiftRight', 'MetaRight'], 'speak', settings)).toBe('command');
  expect(chordTakenBy(['AltGr', 'MetaRight'], 'command', settings)).toBe('push');
  expect(chordTakenBy(['ShiftRight', 'AltGr'], 'push', settings)).toBe('speak');
  expect(chordTakenBy(['Space', 'AltGr', 'MetaRight'], 'speak', settings)).toBe('toggle');
});

test('a shortcut that is turned off takes no keys', () => {
  const off = { ...settings, chord_command_keys: [] };
  expect(chordTakenBy(['MetaRight', 'ShiftRight'], 'speak', off)).toBeNull();
  expect(chordTakenBy([], 'command', settings)).toBeNull();
});

test('new keys nobody uses are free', () => {
  expect(chordTakenBy(['ControlRight', 'AltGr'], 'speak', settings)).toBeNull();
  expect(chordTakenBy(['AltGr'], 'speak', undefined)).toBeNull();
});
