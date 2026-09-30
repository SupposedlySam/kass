import { invoke } from '@tauri-apps/api/core';

/** Open the onboarding window (first run, `/setup`, or the ⌘K palette). */
export function openOnboarding() {
  invoke('open_onboarding').catch((err) =>
    console.warn('[onboarding] open_onboarding failed:', err),
  );
}
