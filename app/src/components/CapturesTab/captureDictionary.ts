import { EVERYWHERE_KEY, scopeKey } from '@/components/Settings/dictionaryScopes';
import type { DictionaryEntryCreate, DictionaryPlaceInput } from '@/lib/api/types';

/** Matches the server's limit on either side of an entry. */
const MAX_LENGTH = 200;
/** A word or a short phrase; a selected sentence is not a dictionary entry. */
const MAX_WORDS = 8;

/**
 * Selected transcript text as a dictionary phrase: one line, without the
 * punctuation the selection picked up around it ("box," is "box"). Empty
 * when the selection is too long to be a word or phrase.
 */
export function selectionPhrase(selected: string): string {
  const phrase = selected
    .split(/\s+/)
    .join(' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!phrase || phrase.length > MAX_LENGTH || phrase.split(' ').length > MAX_WORDS) return '';
  return phrase;
}

/** Where a word from a capture applies unless the user picks otherwise: the capture's app, else everywhere. */
export function defaultPlaceKeys(appBundleId: string | null | undefined): string[] {
  return appBundleId ? [scopeKey({ kind: 'app', bundleId: appBundleId })] : [EVERYWHERE_KEY];
}

function same(a: string, b: string): boolean {
  return a.trim().split(/\s+/).join(' ') === b.trim().split(/\s+/).join(' ');
}

/**
 * The entry for a word picked from a capture. Written as it was said, it
 * only teaches the spelling, so nothing is said to replace; the capture's
 * app is named when the scope list didn't know it.
 */
export function entryFromCapture(
  said: string,
  written: string,
  places: DictionaryPlaceInput[],
  app: { bundleId?: string | null; name?: string | null },
): DictionaryEntryCreate {
  return {
    written: written.trim(),
    spoken: same(said, written) ? null : said.trim() || null,
    places: places.map((place) =>
      place.scope === 'app' && place.scope_id === app.bundleId && !place.app_name
        ? { ...place, app_name: app.name ?? null }
        : place,
    ),
  };
}
