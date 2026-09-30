import { useQuery } from '@tanstack/react-query';
import { fetchLatestRelease, isNewerVersion, type Release } from '@/lib/utils/releases';
import { usePlatform } from '@/platform/PlatformContext';
import { version } from '../../../package.json';

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * The newer release to update to, or `null` while this is the latest.
 * Checks GitHub at launch and every six hours; a failed check just waits
 * for the next one.
 */
export function useUpdateCheck(): Release | null {
  const platform = usePlatform();
  const { data } = useQuery({
    queryKey: ['latestRelease'],
    queryFn: fetchLatestRelease,
    enabled: platform.metadata.isTauri,
    staleTime: SIX_HOURS,
    refetchInterval: SIX_HOURS,
    retry: false,
  });
  return data && isNewerVersion(data.version, version) ? data : null;
}
