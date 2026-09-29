import { describe, expect, test } from 'bun:test';
import {
  defaultPlaceKeys,
  entryFromCapture,
  selectionPhrase,
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

describe('defaultPlaceKeys', () => {
  test("the capture's app, else everywhere", () => {
    expect(defaultPlaceKeys('dev.zed.Zed')).toEqual(['app:dev.zed.Zed']);
    expect(defaultPlaceKeys(null)).toEqual(['global']);
    expect(defaultPlaceKeys(undefined)).toEqual(['global']);
  });
});

describe('entryFromCapture', () => {
  const zed = { bundleId: 'dev.zed.Zed', name: 'Zed' };

  test('a fixed spelling replaces what was said', () => {
    expect(entryFromCapture(' voice box ', 'Voicebox ', [{ scope: 'global' }], zed)).toEqual({
      written: 'Voicebox',
      spoken: 'voice box',
      places: [{ scope: 'global' }],
    });
  });

  test('written as it was said, it only teaches the spelling', () => {
    expect(
      entryFromCapture('Tailscale', ' Tailscale', [{ scope: 'global' }], zed).spoken,
    ).toBeNull();
  });

  test("names the capture's app when the scope list didn't know it", () => {
    const entry = entryFromCapture(
      'zed',
      'Zed',
      [
        { scope: 'app', scope_id: 'dev.zed.Zed', app_name: null },
        { scope: 'app', scope_id: 'com.tinyspeck.slackmacgap', app_name: 'Slack' },
      ],
      zed,
    );
    expect(entry.places).toEqual([
      { scope: 'app', scope_id: 'dev.zed.Zed', app_name: 'Zed' },
      { scope: 'app', scope_id: 'com.tinyspeck.slackmacgap', app_name: 'Slack' },
    ]);
  });
});
