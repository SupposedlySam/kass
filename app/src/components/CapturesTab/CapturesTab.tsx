import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { CaptureListResponse, CaptureResponse } from '@/lib/api/types';
import { useDictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { useUIStore } from '@/stores/uiStore';
import { CaptureAppHeader } from './CaptureAppHeader';
import { appDisplayName, CaptureAppList } from './CaptureAppList';
import { CaptureDetail } from './CaptureDetail';
import { CaptureDetailHeader } from './CaptureDetailHeader';
import { CaptureList } from './CaptureList';
import { CaptureWeekCard } from './CaptureWeekCard';
import { ALL_APPS, capturesKey, matchesAppFilter } from './captureApps';
import { isInOverlay, isTypingTarget, matchesSearch, wentIntoKass } from './captureFormat';
import { EmptyDetail } from './EmptyDetail';
import { useAppFilter } from './useAppFilter';
import { useAppStyles } from './useAppStyles';

/**
 * The Captures screen: the app list, the capture list (all apps' or one
 * app's), and the selected capture on the right.
 */
export function CapturesTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/captures' });
  const { capture: linkedId } = useSearch({ from: '/captures' });
  const readiness = useDictationReadiness();
  const { t } = useTranslation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { apps, appFilter, setAppFilter, filteredApp } = useAppFilter();
  const appsCollapsed = useUIStore((s) => s.capturesAppsCollapsed);
  const appStyles = useAppStyles();
  const styleNames = useMemo(
    () => new Map(appStyles.styles.map((style) => [style.id, style.name])),
    [appStyles],
  );

  const {
    data: capturesData,
    isLoading: capturesLoading,
    isPlaceholderData: capturesPlaceholder,
  } = useQuery({
    queryKey: capturesKey(appFilter),
    queryFn: () => apiClient.listCaptures(200, 0, appFilter),
    // Switching apps keeps the last list up until the new one lands.
    placeholderData: keepPreviousData,
  });
  const captures = capturesData?.items ?? [];

  const visible = useMemo(
    () => captures.filter((c) => matchesSearch(c, search)),
    [captures, search],
  );

  // The list the selection was last seen in, for the app it was loaded for.
  // Not while another app's list is still loading in its place.
  const lastSeen = useRef<{ visible: CaptureResponse[]; appFilter: typeof appFilter } | null>(null);

  // Keep a selection. If the current selection disappears from the same
  // list (a deletion), the capture that took its place is selected, or the
  // one above it at the end; otherwise the first capture, then null.
  useEffect(() => {
    if (!captures.length) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && captures.find((c) => c.id === selectedId)) {
      if (!capturesPlaceholder) lastSeen.current = { visible, appFilter };
      return;
    }
    const before = lastSeen.current;
    const index =
      before && before.appFilter === appFilter
        ? before.visible.findIndex((c) => c.id === selectedId)
        : -1;
    if (index !== -1 && visible.length) {
      const remaining = new Set(visible.map((c) => c.id));
      const next =
        before?.visible.slice(index + 1).find((c) => remaining.has(c.id)) ??
        before?.visible
          .slice(0, index)
          .reverse()
          .find((c) => remaining.has(c.id));
      if (next) {
        setSelectedId(next.id);
        return;
      }
    }
    setSelectedId(captures[0].id);
  }, [captures, visible, selectedId, appFilter, capturesPlaceholder]);

  // `?capture=<id>` (from the command palette or a kass:// link) selects
  // that capture once it is in the list, clears whatever would hide it, then
  // drops the parameter so the same link works again. A capture older than
  // the loaded page is fetched and added to the end of the list.
  useEffect(() => {
    if (!linkedId || !capturesData) return;
    if (!captures.some((c) => c.id === linkedId)) {
      // Show every app's captures first; the capture may be another app's.
      if (appFilter.kind !== 'all') {
        setAppFilter(ALL_APPS);
        return;
      }
      if (capturesPlaceholder) return;
      let cancelled = false;
      apiClient
        .getCapture(linkedId)
        .then((capture) => {
          if (cancelled) return;
          queryClient.setQueryData<CaptureListResponse>(['captures'], (prev) =>
            prev && !prev.items.some((c) => c.id === capture.id)
              ? { ...prev, items: [...prev.items, capture] }
              : prev,
          );
        })
        .catch(() => {
          if (!cancelled) navigate({ search: {}, replace: true });
        });
      return () => {
        cancelled = true;
      };
    }
    setSelectedId(linkedId);
    setSearch('');
    navigate({ search: {}, replace: true });
  }, [
    linkedId,
    capturesData,
    capturesPlaceholder,
    captures,
    appFilter,
    setAppFilter,
    navigate,
    queryClient,
  ]);

  // Live sync from sibling Tauri webviews (the floating dictate window).
  // ``capture:created`` carries the full row so we can seed the cache before
  // the refetch lands and focus the new capture in one shot — without the
  // seed, the selection-guard effect would snap back to ``captures[0]`` in
  // the race window between ``setSelectedId(new)`` and the refetched list
  // actually containing the new row.
  //
  // A capture dictated into a field on this screen (e.g. a correction on the
  // selected capture) leaves the selection put. It is recorded with
  // Kass as its app; the focus check covers captures without one. A
  // capture for another app than the one shown isn't selected either: it
  // isn't in the list.
  const appFilterRef = useRef(appFilter);
  appFilterRef.current = appFilter;
  useEffect(() => {
    const unlistens: Promise<UnlistenFn>[] = [];
    unlistens.push(
      listen<{ capture: CaptureResponse }>('capture:created', (event) => {
        const capture = event.payload?.capture;
        if (capture) {
          const filter = appFilterRef.current;
          const seed = (prev: CaptureListResponse | undefined) => {
            if (!prev) return prev;
            if (prev.items.some((c) => c.id === capture.id)) return prev;
            return { ...prev, items: [capture, ...prev.items], total: prev.total + 1 };
          };
          queryClient.setQueryData<CaptureListResponse>(['captures'], seed);
          const shown = matchesAppFilter(capture, filter);
          if (shown && filter.kind !== 'all') {
            queryClient.setQueryData<CaptureListResponse>(capturesKey(filter), seed);
          }
          const typingHere = document.hasFocus() && isTypingTarget(document.activeElement);
          if (shown && !wentIntoKass(capture) && !typingHere) {
            setSelectedId(capture.id);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['captures'] });
      }),
    );
    unlistens.push(
      listen('capture:updated', () => {
        queryClient.invalidateQueries({ queryKey: ['captures'] });
      }),
    );
    return () => {
      for (const p of unlistens) p.then((fn) => fn()).catch(() => {});
    };
  }, [queryClient]);

  // ↑/↓ move through the visible list, from anywhere but a text field. The
  // search box is the exception, so the user can search and then arrow down.
  const navState = useRef({ visible, selectedId });
  navState.current = { visible, selectedId };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const inSearch = event.target instanceof HTMLInputElement && event.target.type === 'search';
      if ((isTypingTarget(event.target) && !inSearch) || isInOverlay(event.target)) return;
      const { visible, selectedId } = navState.current;
      if (!visible.length) return;
      event.preventDefault();
      const index = visible.findIndex((c) => c.id === selectedId);
      const next =
        index === -1
          ? 0
          : Math.min(visible.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setSelectedId(visible[next].id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selected = captures.find((c) => c.id === selectedId) ?? null;
  const appName = filteredApp
    ? appDisplayName(filteredApp)
    : appFilter.kind === 'unknown'
      ? t('captures.apps.unknown')
      : undefined;

  return (
    <div className="h-full flex overflow-hidden">
      <CaptureAppList
        apps={apps}
        styleNames={styleNames}
        filter={appFilter}
        onFilterChange={(filter) => {
          setAppFilter(filter);
          setSearch('');
        }}
      />
      <CaptureList
        captures={captures}
        visible={visible}
        loading={capturesLoading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        search={search}
        onSearchChange={setSearch}
        allReady={readiness.isLoading || readiness.allReady}
        appName={appName}
        summary={apps && apps.total > 0 && <CaptureWeekCard filter={appFilter} appName={appName} />}
        appHeader={
          filteredApp && (
            <CaptureAppHeader
              bundleId={filteredApp.app_bundle_id}
              name={appDisplayName(filteredApp)}
              count={filteredApp.count}
              appStyles={appStyles}
            />
          )
        }
        appStyles={appStyles}
        narrow={!appsCollapsed}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <CaptureDetailHeader
          capture={selected}
          styleId={selected ? appStyles.forApp(selected.app_bundle_id)?.style.id : undefined}
        />
        {selected ? (
          <CaptureDetail key={selected.id} capture={selected} />
        ) : (
          <EmptyDetail
            loading={capturesLoading}
            hasCaptures={captures.length > 0}
            canRecord={readiness.canRecord}
          />
        )}
      </div>
    </div>
  );
}
