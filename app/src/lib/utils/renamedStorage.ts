/**
 * Kass was Herga, and before that Voicebox. Its local-storage keys started
 * with `herga.` or `herga-` (the UI store is `herga-ui`), and earlier with
 * `voicebox.` or `voicebox-`. Copies each one to its `kass` name once, so
 * the theme, onboarding progress and dismissed prompts carry over. Must run
 * before any store reads storage (see tauri/src/carryOverStorage.ts).
 */
const OLD_PREFIX = /^(?:herga|voicebox)([.-])/;

export function carryOverRenamedStorage(storage: Storage = localStorage) {
  try {
    const old = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key !== null && OLD_PREFIX.test(key),
    );
    // Herga's keys first, so they win over older Voicebox ones.
    old.sort((a, b) => Number(b.startsWith('herga')) - Number(a.startsWith('herga')));
    for (const key of old) {
      const renamed = key.replace(OLD_PREFIX, 'kass$1');
      const value = storage.getItem(key);
      if (storage.getItem(renamed) === null && value !== null) storage.setItem(renamed, value);
      storage.removeItem(key);
    }
  } catch {
    // Storage can be refused; there's just nothing to carry over.
  }
}
