import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api/client';
import { useUIStore } from '@/stores/uiStore';
import { ALL_APPS, CAPTURE_APPS_KEY } from './captureApps';

/**
 * The app list's counts and the app Captures and Insights show. The
 * selection is shared, so each tab opens on the app the other showed. An app
 * whose captures were all deleted leaves the list; then every app's show.
 */
export function useAppFilter() {
  const appFilter = useUIStore((s) => s.appFilter);
  const setAppFilter = useUIStore((s) => s.setAppFilter);
  const { data: apps } = useQuery({
    queryKey: CAPTURE_APPS_KEY,
    queryFn: () => apiClient.listCaptureApps(),
  });
  const filteredApp =
    appFilter.kind === 'app'
      ? apps?.apps.find((app) => app.app_bundle_id === appFilter.bundleId)
      : undefined;

  useEffect(() => {
    if (!apps) return;
    const gone =
      (appFilter.kind === 'app' && !filteredApp) ||
      (appFilter.kind === 'unknown' && !apps.unknown_count);
    if (gone) setAppFilter(ALL_APPS);
  }, [apps, appFilter, filteredApp, setAppFilter]);

  return { apps, appFilter, setAppFilter, filteredApp };
}
