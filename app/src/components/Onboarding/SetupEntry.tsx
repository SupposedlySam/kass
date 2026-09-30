import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SetupFlow } from '@/components/Setup/SetupFlow';
import { usePlatform } from '@/platform/PlatformContext';
import { openOnboarding } from './openOnboarding';

/**
 * `/setup`: on desktop it opens the onboarding window and goes back to
 * Captures; the web build, which has no windows, keeps the setup page.
 */
export function SetupEntry() {
  const isTauri = usePlatform().metadata.isTauri;
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri) return;
    openOnboarding();
    navigate({ to: '/captures', replace: true });
  }, [isTauri, navigate]);
  return isTauri ? null : <SetupFlow />;
}
