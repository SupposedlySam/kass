import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CaptureAppFilter, UsagePeriod } from '@/lib/api/types';

export type Theme = 'light' | 'dark' | 'system';

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

interface UIStore {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  // The Captures app list, shrunk to icons.
  capturesAppsCollapsed: boolean;
  setCapturesAppsCollapsed: (collapsed: boolean) => void;
  // The app Captures and Insights show, shared so each opens on the other's.
  appFilter: CaptureAppFilter;
  setAppFilter: (filter: CaptureAppFilter) => void;
  // The period Insights shows.
  insightsPeriod: UsagePeriod;
  setInsightsPeriod: (period: UsagePeriod) => void;
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      capturesAppsCollapsed: false,
      setCapturesAppsCollapsed: (capturesAppsCollapsed) => set({ capturesAppsCollapsed }),
      appFilter: { kind: 'all' },
      setAppFilter: (appFilter) => set({ appFilter }),
      insightsPeriod: '7d',
      setInsightsPeriod: (insightsPeriod) => set({ insightsPeriod }),
    }),
    {
      name: 'voicebox-ui',
      partialize: (state) => ({
        theme: state.theme,
        capturesAppsCollapsed: state.capturesAppsCollapsed,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
