import { describe, expect, test } from 'bun:test';
import {
  ALL_APPS,
  capturesKey,
  matchesAppFilter,
  sameAppFilter,
} from '../src/components/CapturesTab/captureApps';
import type { CaptureResponse } from '../src/lib/api/types';

function capture(app_bundle_id: string | null): CaptureResponse {
  return {
    id: 'c',
    audio_path: 'captures/c.wav',
    source: 'dictation',
    transcript_raw: 'hi',
    app_bundle_id,
    created_at: '2026-09-28T10:00:00',
  } as CaptureResponse;
}

describe('capture app filter', () => {
  const slack = { kind: 'app', bundleId: 'com.tinyspeck.slackmacgap' } as const;

  test('all apps keeps the shared captures key', () => {
    expect(capturesKey(ALL_APPS)).toEqual(['captures']);
    expect(capturesKey(slack)).toEqual(['captures', 'list', slack]);
  });

  test('an app keeps only its own captures, unknown only those with no app', () => {
    expect(matchesAppFilter(capture('com.tinyspeck.slackmacgap'), slack)).toBe(true);
    expect(matchesAppFilter(capture('com.apple.mail'), slack)).toBe(false);
    expect(matchesAppFilter(capture(null), { kind: 'unknown' })).toBe(true);
    expect(matchesAppFilter(capture('com.apple.mail'), { kind: 'unknown' })).toBe(false);
    expect(matchesAppFilter(capture(null), ALL_APPS)).toBe(true);
  });

  test('filters compare by app', () => {
    expect(sameAppFilter(slack, { kind: 'app', bundleId: slack.bundleId })).toBe(true);
    expect(sameAppFilter(slack, { kind: 'app', bundleId: 'com.apple.mail' })).toBe(false);
    expect(sameAppFilter(ALL_APPS, { kind: 'all' })).toBe(true);
    expect(sameAppFilter(ALL_APPS, { kind: 'unknown' })).toBe(false);
  });
});
