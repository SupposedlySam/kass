import type { CaptureSettings } from '@/lib/api/types';
import { sortChordKeys } from '@/lib/utils/keyCodes';

/** The global shortcuts a chord can be set for. */
export type ChordSlot = 'push' | 'toggle' | 'command' | 'speak';

type ChordSettings = Pick<
  CaptureSettings,
  | 'chord_push_to_talk_keys'
  | 'chord_toggle_to_talk_keys'
  | 'chord_command_keys'
  | 'chord_speak_keys'
>;

const SLOT_KEYS: Record<ChordSlot, keyof ChordSettings> = {
  push: 'chord_push_to_talk_keys',
  toggle: 'chord_toggle_to_talk_keys',
  command: 'chord_command_keys',
  speak: 'chord_speak_keys',
};

export const sameChord = (a: string[], b: string[]) =>
  sortChordKeys(a).join('+') === sortChordKeys(b).join('+');

/**
 * The other shortcut already set to `keys`, if any. The same keys for two
 * shortcuts would start both at once. An empty chord (a shortcut turned off)
 * never clashes.
 */
export function chordTakenBy(
  keys: string[],
  slot: ChordSlot,
  settings: ChordSettings | undefined,
): ChordSlot | null {
  if (!settings || keys.length === 0) return null;
  for (const other of Object.keys(SLOT_KEYS) as ChordSlot[]) {
    if (other === slot) continue;
    const theirs = settings[SLOT_KEYS[other]];
    if (theirs && theirs.length > 0 && sameChord(theirs, keys)) return other;
  }
  return null;
}
