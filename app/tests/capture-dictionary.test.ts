import { describe, expect, test } from 'bun:test';
import {
  dictionaryWord,
  firedPhrases,
  markPhrases,
  phraseFromHunk,
  phraseKey,
  respellSelection,
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

describe('respellSelection', () => {
  test('the selected word takes the new spelling inside the punctuation it picked up', () => {
    expect(respellSelection('ask sagar, then', 4, 11, 'Saggar')).toBe('ask Saggar, then');
  });
});

describe('phraseFromHunk', () => {
  test('words replaced by other text are what to say and what to write', () => {
    expect(phraseFromHunk({ removed: 'Add my email', added: 'you@example.com' })).toEqual({
      said: 'add my email',
      written: 'you@example.com',
    });
  });

  test('words only added or removed, or a sentence said, are not a phrase', () => {
    expect(phraseFromHunk({ removed: '', added: 'you@example.com' })).toBeNull();
    expect(phraseFromHunk({ removed: 'my email', added: '' })).toBeNull();
    expect(
      phraseFromHunk({ removed: 'one two three four five six seven eight nine', added: 'x' }),
    ).toBeNull();
  });
});

describe('firedPhrases', () => {
  const email = {
    id: 'e',
    spoken: 'insert my email',
    written: 'you@example.com',
    phrase: true,
  };

  test('a phrase said and written fired', () => {
    expect(
      firedPhrases('send it to insert-my email thanks', 'Send it to you@example.com. Thanks!', [
        email,
      ]),
    ).toEqual([{ id: 'e', spoken: 'insert my email', written: 'you@example.com' }]);
  });

  test('a phrase not said, said inside other words, or a word fix, did not', () => {
    expect(firedPhrases('send it to you', 'Send it to you@example.com', [email])).toEqual([]);
    expect(
      firedPhrases('reinsert my emails', 'you@example.com', [email, { ...email, id: 'f' }]),
    ).toEqual([]);
    expect(
      firedPhrases('insert my email', 'you@example.com', [{ ...email, phrase: false }]),
    ).toEqual([]);
  });
});

describe('markPhrases', () => {
  test('marks every place a phrase wrote, the longest first', () => {
    const short = { id: 's', spoken: 'my site', written: 'example.com' };
    const long = { id: 'l', spoken: 'my email', written: 'you@example.com' };
    expect(markPhrases('Mail you@example.com or see example.com.', [short, long])).toEqual([
      { text: 'Mail ' },
      { text: 'you@example.com', phrase: long },
      { text: ' or see ' },
      { text: 'example.com', phrase: short },
      { text: '.' },
    ]);
  });

  test('compares written text by letters and digits only', () => {
    expect(phraseKey('Thanks,\nMorgan')).toBe(phraseKey('thanks morgan'));
  });
});
