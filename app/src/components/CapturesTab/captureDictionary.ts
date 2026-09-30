import type { DictionaryEntryCreate, DictionaryPlaceInput } from '@/lib/api/types';
import type { DiffHunk } from './wordDiff';

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

/**
 * A correction's change as a dictionary word: a word or short phrase Herga
 * heard, and what the user wrote instead. Null for words only added or
 * removed, or a rewrite too long to be a word or phrase.
 */
export function dictionaryWord(hunk: DiffHunk): { said: string; written: string } | null {
  const said = selectionPhrase(hunk.removed);
  const written = selectionPhrase(hunk.added);
  return said && written ? { said, written } : null;
}

function same(a: string, b: string): boolean {
  return a.trim().split(/\s+/).join(' ') === b.trim().split(/\s+/).join(' ');
}

/**
 * The entry for a word picked from a capture, spelled the user's way, in
 * `places` (everywhere unless the user picks). Spelled as it was written, it only teaches the
 * spelling; spelled otherwise, what was written is also replaced, so a
 * mishearing Whisper repeats is fixed however far it is from the word.
 */
export function spellingEntry(
  said: string,
  written: string,
  places: DictionaryPlaceInput[] = [{ scope: 'global' }],
): DictionaryEntryCreate {
  return {
    written: written.trim(),
    spoken: same(said, written) ? null : said.trim() || null,
    places,
  };
}
