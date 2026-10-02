import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

/**
 * Features that ship in every release but only show on internal builds:
 * ones installed from a checkout with scripts/install.sh. Add a name here and
 * gate the feature with `useInternalFeature`. To move it to beta, remove the
 * name: every place that still checks it stops compiling, which shows what to
 * change.
 *
 * The server keeps its own list in backend/internal.py.
 */
export const INTERNAL_FEATURES = [] as const;

export type InternalFeature = (typeof INTERNAL_FEATURES)[number];

/** Whether an internal feature shows: only on internal builds. */
export function useInternalFeature(_feature: InternalFeature): boolean {
  const { data } = useQuery({
    queryKey: ['internal-build'],
    queryFn: () => apiClient.getInternal(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data?.internal ?? false;
}
