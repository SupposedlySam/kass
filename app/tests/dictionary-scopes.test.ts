import { describe, expect, test } from 'bun:test';
import {
  buildScopeOptions,
  EVERYWHERE,
  entriesIn,
  inheritedEntries,
  newEntry,
  parseScopeKey,
  scopeKey,
} from '../src/components/Settings/dictionaryScopes';
import type {
  DictionaryEntry,
  ResolvedDictionaryEntry,
  WritingStylesResponse,
} from '../src/lib/api/types';

function entry(
  written: string,
  scope: DictionaryEntry['scope'] = 'global',
  scope_id: string | null = null,
  spoken: string | null = null,
): DictionaryEntry {
  return {
    id: `${scope}-${scope_id}-${written}`,
    scope,
    scope_id,
    app_name: null,
    written,
    spoken,
    created_at: '2026-09-28T10:00:00',
  };
}

const styles = {
  styles: [
    { id: 'casual', name: 'Casual', position: 1, is_default: false },
    { id: 'formal', name: 'Formal', position: 0, is_default: true },
  ],
  apps: [
    { bundle_id: 'com.tinyspeck.slackmacgap', name: 'Slack', style_id: 'casual' },
    { bundle_id: 'com.apple.mail', name: null, style_id: 'formal' },
  ],
  max_styles: 5,
} as unknown as WritingStylesResponse;

describe('dictionary scope keys', () => {
  test('round-trip through the picker key', () => {
    for (const scope of [
      EVERYWHERE,
      { kind: 'style', styleId: 'casual' } as const,
      { kind: 'app', bundleId: 'com.apple.mail' } as const,
    ]) {
      expect(parseScopeKey(scopeKey(scope))).toEqual(scope);
    }
  });

  test('a missing or malformed key is everywhere', () => {
    expect(parseScopeKey(undefined)).toEqual(EVERYWHERE);
    expect(parseScopeKey('style:')).toEqual(EVERYWHERE);
    expect(parseScopeKey('nonsense')).toEqual(EVERYWHERE);
  });
});

describe('dictionary entries by scope', () => {
  const all = [
    entry('kubernetes'),
    entry('Voicebox', 'global', null, 'voice box'),
    entry('LGTM', 'style', 'casual'),
    entry('Morgan', 'app', 'com.tinyspeck.slackmacgap'),
  ];

  test('a scope keeps only its own entries, alphabetical ignoring case', () => {
    expect(entriesIn(all, EVERYWHERE).map((e) => e.written)).toEqual(['kubernetes', 'Voicebox']);
    expect(entriesIn(all, { kind: 'style', styleId: 'casual' }).map((e) => e.written)).toEqual([
      'LGTM',
    ]);
    expect(entriesIn(all, { kind: 'style', styleId: 'formal' })).toEqual([]);
  });

  test('options list styles by position and apps by name, with counts', () => {
    const orphan = { ...entry('x', 'app', 'com.gone.app'), app_name: 'Gone' };
    const options = buildScopeOptions(styles, [...all, orphan]);
    expect(options.everywhere.count).toBe(2);
    expect(options.styles.map((o) => [o.name, o.count])).toEqual([
      ['Formal', 0],
      ['Casual', 1],
    ]);
    // Mail has no name, so its bundle id stands in; an app with entries but gone from styles stays.
    expect(options.apps.map((o) => [o.name, o.count])).toEqual([
      ['com.apple.mail', 0],
      ['Gone', 1],
      ['Slack', 1],
    ]);
  });
});

describe('adding an entry', () => {
  test('a blank "when I say" makes a term', () => {
    expect(newEntry(EVERYWHERE, ' Kubernetes ', '  ')).toEqual({
      scope: 'global',
      written: 'Kubernetes',
      spoken: null,
    });
  });

  test('style and app entries carry their id, apps their name', () => {
    expect(newEntry({ kind: 'style', styleId: 'casual' }, 'LGTM', 'looks good')).toEqual({
      scope: 'style',
      scope_id: 'casual',
      written: 'LGTM',
      spoken: 'looks good',
    });
    expect(newEntry({ kind: 'app', bundleId: 'com.apple.mail' }, 'Hi', '', 'Mail')).toEqual({
      scope: 'app',
      scope_id: 'com.apple.mail',
      app_name: 'Mail',
      written: 'Hi',
      spoken: null,
    });
  });
});

test("an app's inherited entries leave out its own, style first", () => {
  const resolved: ResolvedDictionaryEntry[] = [
    { ...entry('b-global'), overridden: false },
    { ...entry('own', 'app', 'com.apple.mail'), overridden: false },
    { ...entry('z-style', 'style', 'formal'), overridden: true },
    { ...entry('a-global'), overridden: false },
  ];
  expect(inheritedEntries(resolved).map((e) => e.written)).toEqual([
    'z-style',
    'a-global',
    'b-global',
  ]);
});
