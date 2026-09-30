/**
 * Herga was Voicebox, and its local-storage keys started with `voicebox.`
 * or `voicebox-` (the UI store is `voicebox-ui`). Copies each one to its
 * `herga` name once, so the theme, onboarding progress and dismissed prompts
 * carry over. Must run before any store reads storage (see
 * tauri/src/carryOverStorage.ts).
 */
export function carryOverRenamedStorage(storage: Storage = localStorage) {
  try {
    const old = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key !== null && /^voicebox[.-]/.test(key),
    );
    for (const key of old) {
      const renamed = `herga${key.slice('voicebox'.length)}`;
      const value = storage.getItem(key);
      if (storage.getItem(renamed) === null && value !== null) storage.setItem(renamed, value);
      storage.removeItem(key);
    }
  } catch {
    // Storage can be refused; there's just nothing to carry over.
  }
}
