import { describe, expect, test } from 'bun:test';
import {
  heardParts,
  isLocked,
  missingDiskMb,
  nextStep,
  parseProgress,
  previousStep,
  shouldRetryAutomatically,
  standardCleanup,
} from '../src/components/Onboarding/onboardingFlow';

describe('onboarding order', () => {
  test('downloads come right after the welcome, before the permission that quits', () => {
    expect(nextStep('welcome')).toBe('download');
    expect(nextStep('download')).toBe('inputMonitoring');
  });

  test('the last step stays put, and so does the first going back', () => {
    expect(nextStep('done')).toBe('done');
    expect(previousStep('welcome')).toBe('welcome');
  });
});

describe('model lock', () => {
  test('only the spoken steps wait for the models', () => {
    for (const step of ['name', 'messy', 'style', 'rewrite'] as const) {
      expect(isLocked(step, false)).toBe(true);
      expect(isLocked(step, true)).toBe(false);
    }
    for (const step of ['welcome', 'download', 'inputMonitoring', 'microphone', 'keys'] as const) {
      expect(isLocked(step, false)).toBe(false);
    }
  });
});

describe('saved progress', () => {
  test('reopens on the saved step after a quit', () => {
    expect(parseProgress('{"step":"inputMonitoring","downloadsStarted":true}')).toEqual({
      step: 'inputMonitoring',
      downloadsStarted: true,
    });
  });

  test('starts over on anything it cannot read', () => {
    const start = { step: 'welcome', downloadsStarted: false };
    expect(parseProgress(null)).toEqual(start);
    expect(parseProgress('not json')).toEqual(start);
    expect(parseProgress('{"step":"gone"}')).toEqual(start);
  });
});

describe('download failures', () => {
  test('retries by itself three times, then asks', () => {
    expect(shouldRetryAutomatically(0)).toBe(false);
    expect(shouldRetryAutomatically(1)).toBe(true);
    expect(shouldRetryAutomatically(3)).toBe(true);
    expect(shouldRetryAutomatically(4)).toBe(false);
  });

  test('says how much space to free, with room to spare', () => {
    expect(missingDiskMb(10_000, 2_000)).toBe(0);
    expect(missingDiskMb(2_000, 2_000)).toBe(500);
  });
});

describe('what cleanup dropped', () => {
  test('marks filler and a changed mind as dropped', () => {
    const parts = heardParts(
      'um, can we move lunch to noon? no, actually, one. at the usual place',
      'Can we move lunch to one? At the usual place.',
    );
    expect(parts).toEqual([
      { text: 'um,', dropped: true },
      { text: 'can we move lunch to', dropped: false },
      { text: 'noon? no, actually,', dropped: true },
      { text: 'one. at the usual place', dropped: false },
    ]);
  });

  test('keeps everything when nothing was dropped', () => {
    expect(heardParts('see you soon', 'See you soon.')).toEqual([
      { text: 'see you soon', dropped: false },
    ]);
  });
});

describe('standard cleanup', () => {
  test('capitalizes sentences and "i", and ends with a period', () => {
    expect(standardCleanup('yeah for sure, i’ll be there around 7. grab chips lol')).toBe(
      'Yeah for sure, I’ll be there around 7. Grab chips lol.',
    );
  });

  test('keeps text that already reads that way', () => {
    expect(standardCleanup('Sounds good!')).toBe('Sounds good!');
    expect(standardCleanup('')).toBe('');
  });
});
