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
  // The selected capture's details (recording, models, corrections) beside it.
  capturesDetailsOpen: boolean;
  setCapturesDetailsOpen: (open: boolean) => void;
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
      capturesAppsCollapsed: true,
      setCapturesAppsCollapsed: (capturesAppsCollapsed) => set({ capturesAppsCollapsed }),
      capturesDetailsOpen: false,
      setCapturesDetailsOpen: (capturesDetailsOpen) => set({ capturesDetailsOpen }),
      appFilter: { kind: 'all' },
      setAppFilter: (appFilter) => set({ appFilter }),
      insightsPeriod: '7d',
      setInsightsPeriod: (insightsPeriod) => set({ insightsPeriod }),
    }),
    {
      name: 'voicebox-ui',
      // Version 1 starts Captures with the app list collapsed, once, over
      // the expanded list version 0 saved by default.
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<UIStore>;
        return (version < 1 ? { ...state, capturesAppsCollapsed: true } : state) as UIStore;
      },
      partialize: (state) => ({
        theme: state.theme,
        capturesAppsCollapsed: state.capturesAppsCollapsed,
        capturesDetailsOpen: state.capturesDetailsOpen,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
