import type { DictionaryEntryCreate, DictionaryPlaceInput } from '@/lib/api/types';
import { type DiffHunk, diffWords } from './wordDiff';

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
 * A correction's change as a dictionary word: a word or short phrase Kass
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

/** `text` with its word or phrase, inside any punctuation around it, spelled `written`. */
function swapPhrase(text: string, written: string): string {
  const lead = text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
  const trail = text.slice(lead.length).match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
  return lead + written.trim() + trail;
}

/**
 * A correction's `draft` with the word it changed to `from` spelled `to`
 * instead, wherever it made that change, so respelling a changed word for
 * the dictionary fixes the correction too.
 */
export function respellChange(original: string, draft: string, from: string, to: string): string {
  return diffWords(original, draft)
    .after.map((segment) =>
      segment.changed && selectionPhrase(segment.text) === from
        ? swapPhrase(segment.text, to)
        : segment.text,
    )
    .join('');
}

/** `text` with the phrase selected in `start`..`end` spelled `written`, keeping the punctuation around it. */
export function respellSelection(
  text: string,
  start: number,
  end: number,
  written: string,
): string {
  return text.slice(0, start) + swapPhrase(text.slice(start, end), written) + text.slice(end);
}

/** A phrase to make from a correction: the words Kass heard, and the text the user wants there. */
export interface PhraseDraft {
  said: string;
  written: string;
}

/**
 * A correction's change as a phrase: words Kass heard that the user
 * replaced with other text, which saying them could write next time. Null
 * for words only added or removed, or more said than a phrase.
 */
export function phraseFromHunk(hunk: DiffHunk): PhraseDraft | null {
  const said = selectionPhrase(hunk.removed).toLowerCase();
  const written = hunk.added.trim();
  return said && written ? { said, written } : null;
}

/** A phrase from the dictionary that wrote its text into a capture. */
export interface FiredPhrase {
  id: string;
  spoken: string;
  written: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `spoken` said in `text`: whole words, any case, spaces or hyphens between them, as the server matches. */
function said(text: string, spoken: string): boolean {
  const words = spoken
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (!words.length) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{N}_'’-])${words.join('[\\s-]+')}(?![\\p{L}\\p{N}_'’-])`,
    'iu',
  ).test(text);
}

/**
 * The dictionary's phrases a capture used: said in what Kass heard, and
 * written in what it delivered. One per text written, newest entry first.
 */
export function firedPhrases(
  raw: string,
  delivered: string,
  entries: { id: string; spoken: string | null; written: string; phrase?: boolean }[],
): FiredPhrase[] {
  const fired: FiredPhrase[] = [];
  for (const entry of entries) {
    if (!entry.phrase || !entry.spoken || !entry.written) continue;
    if (fired.some((f) => f.written === entry.written)) continue;
    if (delivered.includes(entry.written) && said(raw, entry.spoken)) {
      fired.push({ id: entry.id, spoken: entry.spoken, written: entry.written });
    }
  }
  return fired;
}

/** A run of delivered text, and the phrase that wrote it, if one did. */
export interface PhraseRun {
  text: string;
  phrase?: FiredPhrase;
}

/** Text with where each phrase wrote into it marked, in order; the longest wins where two overlap. */
export function markPhrases(text: string, phrases: FiredPhrase[]): PhraseRun[] {
  const byLength = [...phrases].sort((a, b) => b.written.length - a.written.length);
  const parts: PhraseRun[] = [];
  let at = 0;
  let plain = '';
  while (at < text.length) {
    const phrase = byLength.find((p) => text.startsWith(p.written, at));
    if (phrase) {
      if (plain) parts.push({ text: plain });
      plain = '';
      parts.push({ text: phrase.written, phrase });
      at += phrase.written.length;
    } else {
      plain += text[at];
      at += 1;
    }
  }
  if (plain) parts.push({ text: plain });
  return parts;
}

/** Letters and digits only, for telling whether a change wrote a phrase's text. */
export function phraseKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
