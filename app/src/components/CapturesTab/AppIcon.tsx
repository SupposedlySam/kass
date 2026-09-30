import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The icon of the app a capture was dictated into, looked up by bundle id.
 * Renders `fallback` (nothing by default) when the app isn't installed or
 * the capture has no app.
 */
export function AppIcon({
  bundleId,
  className,
  fallback = null,
}: {
  bundleId?: string | null;
  className?: string;
  fallback?: ReactNode;
}) {
  const { data: src } = useQuery({
    queryKey: ['appIcon', bundleId],
    queryFn: () => invoke<string | null>('app_icon', { bundleId }),
    enabled: !!bundleId,
    // An app's icon doesn't change while Herga runs.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" aria-hidden className={cn('size-3.5 shrink-0', className)} />;
}
