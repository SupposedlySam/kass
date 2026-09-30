import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { useDictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { usePlatform } from '@/platform/PlatformContext';

/**
 * Set while setup is the open screen. macOS makes the user quit Kass for
 * some permissions to take effect, and after that relaunch dictation may
 * already be able to record, so readiness alone would never bring them back.
 */
const SETUP_OPEN_KEY = 'kass.setup.open';

function readSetupOpen(): boolean {
  try {
    return localStorage.getItem(SETUP_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSetupOpen(open: boolean) {
  try {
    if (open) localStorage.setItem(SETUP_OPEN_KEY, '1');
    else localStorage.removeItem(SETUP_OPEN_KEY);
  } catch {
    // Private windows can refuse storage; setup just won't reopen by itself.
  }
}

// Module scope so the decision is made once per launch, not once per mount.
let decided = false;

/**
 * Sends a user to ``/setup`` once per launch: when setup was still open at
 * the last quit, or when dictation can't record yet and there are no
 * captures. Waits for the real readiness and captures answers (not their
 * loading states), so a slow server never counts as "not ready". After the
 * first decision it stays out of the way, so leaving setup is never undone.
 * Only redirects from the landing screen.
 *
 * Web only: the desktop app opens its onboarding window instead
 * (`useOnboardingLauncher`).
 */
export function useFirstRunRedirect() {
  const isTauri = usePlatform().metadata.isTauri;
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const readiness = useDictationReadiness();
  // Same key and page size as the Captures screen, so the two share a cache.
  const { data: captures } = useQuery({
    queryKey: ['captures'],
    queryFn: () => apiClient.listCaptures(200, 0),
  });

  const readinessLoaded = !readiness.isLoading && readiness.stt !== undefined;

  useEffect(() => {
    if (isTauri || decided) return;
    const onLanding = pathname === '/' || pathname === '/captures';
    // Coming back from a quit mid-setup needs no readiness answer.
    if (readSetupOpen()) {
      decided = true;
      if (onLanding) navigate({ to: '/setup' });
      return;
    }
    if (!readinessLoaded || !captures) return;
    decided = true;
    if (readiness.canRecord || captures.items.length > 0) return;
    // Readiness can take ~30 s after launch; don't pull someone out of a
    // screen they've already opened in the meantime.
    if (onLanding) navigate({ to: '/setup' });
  }, [isTauri, readinessLoaded, captures, readiness.canRecord, pathname, navigate]);

  // Remember whether setup is open, so a quit from it comes back to it.
  // Leaving setup for any other screen counts as done with it.
  useEffect(() => {
    if (!isTauri && decided) writeSetupOpen(pathname === '/setup');
  }, [isTauri, pathname]);
}
