import type { CaptureAppFilter, CaptureResponse } from '@/lib/api/types';

export const ALL_APPS: CaptureAppFilter = { kind: 'all' };

/** The per-app counts for the app list. Under ['captures'], so every capture change refreshes it. */
export const CAPTURE_APPS_KEY = ['captures', 'apps'] as const;

/**
 * The capture list's query key. Every app keeps the plain ['captures'] key
 * that the command palette and first-run check share; a filtered list gets
 * its own entry beside it.
 */
export function capturesKey(filter: CaptureAppFilter): readonly unknown[] {
  return filter.kind === 'all' ? ['captures'] : ['captures', 'list', filter];
}

export function matchesAppFilter(capture: CaptureResponse, filter: CaptureAppFilter): boolean {
  if (filter.kind === 'app') return capture.app_bundle_id === filter.bundleId;
  if (filter.kind === 'unknown') return !capture.app_bundle_id;
  return true;
}

export function sameAppFilter(a: CaptureAppFilter, b: CaptureAppFilter): boolean {
  if (a.kind === 'app' && b.kind === 'app') return a.bundleId === b.bundleId;
  return a.kind === b.kind;
}
