import type {
  DictionaryEntry,
  DictionaryEntryCreate,
  ResolvedDictionaryEntry,
  WritingStylesResponse,
} from '@/lib/api/types';

/** A place dictionary entries apply: everywhere, one writing style or one app. */
export type DictionaryScopeRef =
  | { kind: 'global' }
  | { kind: 'style'; styleId: string }
  | { kind: 'app'; bundleId: string };

export const EVERYWHERE: DictionaryScopeRef = { kind: 'global' };

/** The scope as one string, for the picker and `?scope=`: `global`, `style:<id>` or `app:<bundle id>`. */
export function scopeKey(scope: DictionaryScopeRef): string {
  if (scope.kind === 'style') return `style:${scope.styleId}`;
  if (scope.kind === 'app') return `app:${scope.bundleId}`;
  return 'global';
}

export function parseScopeKey(key: string | undefined): DictionaryScopeRef {
  if (key?.startsWith('style:') && key.length > 6) return { kind: 'style', styleId: key.slice(6) };
  if (key?.startsWith('app:') && key.length > 4) return { kind: 'app', bundleId: key.slice(4) };
  return EVERYWHERE;
}

export function inScope(entry: DictionaryEntry, scope: DictionaryScopeRef): boolean {
  if (scope.kind === 'style') return entry.scope === 'style' && entry.scope_id === scope.styleId;
  if (scope.kind === 'app') return entry.scope === 'app' && entry.scope_id === scope.bundleId;
  return entry.scope === 'global';
}

/** A scope's entries, alphabetical by what gets written. */
export function entriesIn(
  entries: DictionaryEntry[] | undefined,
  scope: DictionaryScopeRef,
): DictionaryEntry[] {
  return (entries ?? [])
    .filter((entry) => inScope(entry, scope))
    .sort((a, b) => a.written.localeCompare(b.written, undefined, { sensitivity: 'base' }));
}

export interface ScopeOption {
  key: string;
  scope: DictionaryScopeRef;
  /** A style's or app's name; empty for everywhere, which the page labels. */
  name: string;
  count: number;
}

/**
 * The picker's choices: everywhere, then each style in order, then each app
 * by name. An app with entries but no longer in the styles listing still
 * shows, so its entries stay reachable.
 */
export function buildScopeOptions(
  data: WritingStylesResponse | undefined,
  entries: DictionaryEntry[] | undefined,
): { everywhere: ScopeOption; styles: ScopeOption[]; apps: ScopeOption[] } {
  const counts = new Map<string, number>();
  for (const entry of entries ?? []) {
    const key = scopeKey(entryScope(entry));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const option = (scope: DictionaryScopeRef, name: string): ScopeOption => {
    const key = scopeKey(scope);
    return { key, scope, name, count: counts.get(key) ?? 0 };
  };

  const styles = [...(data?.styles ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((style) => option({ kind: 'style', styleId: style.id }, style.name));

  const appNames = new Map<string, string>();
  for (const app of data?.apps ?? []) appNames.set(app.bundle_id, app.name || app.bundle_id);
  for (const entry of entries ?? []) {
    if (entry.scope === 'app' && entry.scope_id && !appNames.has(entry.scope_id)) {
      appNames.set(entry.scope_id, entry.app_name || entry.scope_id);
    }
  }
  const apps = [...appNames]
    .map(([bundleId, name]) => option({ kind: 'app', bundleId }, name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return { everywhere: option(EVERYWHERE, ''), styles, apps };
}

export function entryScope(entry: DictionaryEntry): DictionaryScopeRef {
  if (entry.scope === 'style' && entry.scope_id) return { kind: 'style', styleId: entry.scope_id };
  if (entry.scope === 'app' && entry.scope_id) return { kind: 'app', bundleId: entry.scope_id };
  return EVERYWHERE;
}

/** The body that adds an entry to a scope; a blank "when I say" makes it a term. */
export function newEntry(
  scope: DictionaryScopeRef,
  written: string,
  spoken: string,
  appName?: string | null,
): DictionaryEntryCreate {
  const said = spoken.trim();
  const body: DictionaryEntryCreate = {
    scope: scope.kind,
    written: written.trim(),
    spoken: said || null,
  };
  if (scope.kind === 'style') body.scope_id = scope.styleId;
  if (scope.kind === 'app') {
    body.scope_id = scope.bundleId;
    body.app_name = appName ?? null;
  }
  return body;
}

/** An app's resolved entries that come from its style or from everywhere, style first. */
export function inheritedEntries(
  entries: ResolvedDictionaryEntry[] | undefined,
): ResolvedDictionaryEntry[] {
  const rank = (entry: ResolvedDictionaryEntry) => (entry.scope === 'style' ? 0 : 1);
  return (entries ?? [])
    .filter((entry) => entry.scope !== 'app')
    .sort(
      (a, b) =>
        rank(a) - rank(b) || a.written.localeCompare(b.written, undefined, { sensitivity: 'base' }),
    );
}
