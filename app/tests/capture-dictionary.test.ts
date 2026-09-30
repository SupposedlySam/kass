import { describe, expect, test } from 'bun:test';
import {
  dictionaryWord,
  selectionPhrase,
  spellingEntry,
} from '../src/components/CapturesTab/captureDictionary';

describe('selectionPhrase', () => {
  test('trims the punctuation and spacing a selection picks up', () => {
    expect(selectionPhrase('  voice box, ')).toBe('voice box');
    expect(selectionPhrase('“Voicebox.”')).toBe('Voicebox');
    expect(selectionPhrase('voice\n  box')).toBe('voice box');
  });

  test('keeps punctuation inside the phrase', () => {
    expect(selectionPhrase('capture_stream.py')).toBe('capture_stream.py');
    expect(selectionPhrase('mrgnhnt96@gmail.com')).toBe('mrgnhnt96@gmail.com');
  });

  test('a sentence, or nothing but punctuation, is not a phrase', () => {
    expect(selectionPhrase('one two three four five six seven eight nine')).toBe('');
    expect(selectionPhrase(' ... ')).toBe('');
    expect(selectionPhrase('x'.repeat(201))).toBe('');
  });
});

describe('dictionaryWord', () => {
  test('a changed word or phrase is what was heard and what to write', () => {
    expect(dictionaryWord({ removed: 'post grass,', added: 'Postgres,' })).toEqual({
      said: 'post grass',
      written: 'Postgres',
    });
  });

  test('words only added or removed, or a long rewrite, are not a dictionary word', () => {
    expect(dictionaryWord({ removed: '', added: 'Postgres' })).toBeNull();
    expect(dictionaryWord({ removed: 'um', added: '' })).toBeNull();
    expect(
      dictionaryWord({ removed: 'so', added: 'one two three four five six seven eight nine' }),
    ).toBeNull();
  });
});

describe('spellingEntry', () => {
  test('a fixed spelling replaces what was written, everywhere', () => {
    expect(spellingEntry(' voice box ', 'Voicebox ')).toEqual({
      written: 'Voicebox',
      spoken: 'voice box',
      places: [{ scope: 'global' }],
    });
  });

  test('spelled as it was written, it only teaches the spelling', () => {
    expect(spellingEntry('Tailscale', ' Tailscale').spoken).toBeNull();
  });
});
