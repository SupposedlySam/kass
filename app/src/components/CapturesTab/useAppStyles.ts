import { useMemo } from 'react';
import type { WritingStyle } from '@/lib/api/types';
import { defaultStyle, stylesById, useWritingStyles } from '@/lib/hooks/useWritingStyle';

export interface AppStyle {
  style: WritingStyle;
  /** False while the app only uses the default because the user hasn't chosen. */
  confirmed: boolean;
  /** Until confirmed: the style most apps of its App Store category use. */
  suggested: WritingStyle;
}

export interface AppStyles {
  styles: WritingStyle[];
  byId: Map<string, WritingStyle>;
  fallback: WritingStyle | undefined;
  /** The style an app's dictation uses now; the default for no app or an unknown one. */
  forApp: (bundleId?: string | null) => AppStyle | undefined;
}

/** Writing styles as the Captures screen shows them (docs/plans/PER_APP_STYLE.md). */
export function useAppStyles(): AppStyles {
  const { data } = useWritingStyles();
  return useMemo(() => {
    const byId = stylesById(data);
    const fallback = defaultStyle(data);
    const apps = new Map((data?.apps ?? []).map((app) => [app.bundle_id, app]));
    return {
      styles: data?.styles ?? [],
      byId,
      fallback,
      forApp: (bundleId) => {
        const app = bundleId ? apps.get(bundleId) : undefined;
        const style = (app && byId.get(app.style_id)) || fallback;
        if (!style) return undefined;
        const suggested = (app?.suggested_style_id && byId.get(app.suggested_style_id)) || style;
        return { style, confirmed: !!app?.confirmed, suggested };
      },
    };
  }, [data]);
}
