import { invoke } from '@tauri-apps/api/core';
import { restartProgress } from './onboardingFlow';

/**
 * Open the onboarding window. Opened by the user (`/setup`, the ⌘K palette,
 * Settings › Features) it starts from the beginning; `resume` picks up the
 * step it was on, for the launch after a permission made Herga quit.
 */
export function openOnboarding({ resume = false }: { resume?: boolean } = {}) {
  if (!resume) restartProgress();
  invoke('open_onboarding').catch((err) =>
    console.warn('[onboarding] open_onboarding failed:', err),
  );
}
