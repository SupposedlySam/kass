import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChartColumn, CircleHelp, LayoutGrid, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppTile,
  appDisplayName,
  CaptureAppList,
  SymbolTile,
} from '@/components/CapturesTab/CaptureAppList';
import { useAppFilter } from '@/components/CapturesTab/useAppFilter';
import { useAppStyles } from '@/components/CapturesTab/useAppStyles';
import { apiClient } from '@/lib/api/client';
import type { UsagePeriod } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';
import { HeatMap } from './HeatMap';
import { LengthCurve } from './LengthCurve';
import { StatCards } from './StatCards';
import { statsKey } from './usageFormat';
import { WhereYouDictate } from './WhereYouDictate';
import { WordsChart } from './WordsChart';

const PERIODS: UsagePeriod[] = ['today', '7d', '30d', 'all'];

function PeriodSwitch({
  value,
  onChange,
}: {
  value: UsagePeriod;
  onChange: (period: UsagePeriod) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      aria-label={t('insights.period.label')}
      className="ml-auto flex rounded-[7px] bg-muted p-0.5"
    >
      {PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          aria-pressed={period === value}
          onClick={() => onChange(period)}
          className={cn(
            'rounded-[5px] px-3 py-[5px] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            period === value
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`insights.period.${period}`)}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Insights: how much, how fast and where the user dictates, for all apps or
 * the one picked in the app list (shared with Captures), over a period
 * against the one before it. Everything is counted on the server.
 */
export function InsightsTab() {
  const { t } = useTranslation();
  const { apps, appFilter, setAppFilter, filteredApp } = useAppFilter();
  const period = useUIStore((s) => s.insightsPeriod);
  const setPeriod = useUIStore((s) => s.setInsightsPeriod);
  const appStyles = useAppStyles();
  const styleNames = useMemo(
    () => new Map(appStyles.styles.map((style) => [style.id, style.name])),
    [appStyles],
  );
  const { data: stats, isLoading } = useQuery({
    queryKey: statsKey(period, appFilter),
    queryFn: () => apiClient.getCaptureStats(period, appFilter),
    // Switching apps or periods keeps the last stats up until the new ones land.
    placeholderData: keepPreviousData,
  });

  const unknownIcon = (
    <SymbolTile>
      <CircleHelp />
    </SymbolTile>
  );
  const appName = filteredApp
    ? appDisplayName(filteredApp)
    : appFilter.kind === 'unknown'
      ? t('captures.apps.unknown')
      : undefined;
  const appIcon = filteredApp ? (
    <AppTile bundleId={filteredApp.app_bundle_id} name={appDisplayName(filteredApp)} />
  ) : appFilter.kind === 'unknown' ? (
    unknownIcon
  ) : (
    <SymbolTile>
      <LayoutGrid />
    </SymbolTile>
  );
  const noCaptures = apps?.total === 0;

  return (
    <div className="h-full flex overflow-hidden">
      <CaptureAppList
        apps={apps}
        styleNames={styleNames}
        filter={appFilter}
        onFilterChange={setAppFilter}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 flex items-center gap-3 px-8 border-b border-border">
          {appIcon}
          <h1 className="min-w-0 truncate text-[15px] font-semibold">
            {appName ? t('insights.titleApp', { app: appName }) : t('insights.title')}
          </h1>
          <PeriodSwitch value={period} onChange={setPeriod} />
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {noCaptures ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
              <ChartColumn className="size-6 text-muted-foreground" strokeWidth={1.7} />
              <p className="text-sm font-semibold">{t('insights.empty.title')}</p>
              <p className="max-w-xs text-[13px] text-muted-foreground">
                {t('insights.empty.body')}
              </p>
            </div>
          ) : !stats ? (
            <div className="py-12 flex justify-center text-muted-foreground">
              {isLoading && <Loader2 className="size-4 animate-spin" />}
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-8 py-6">
              <StatCards stats={stats} />
              <WordsChart stats={stats} appName={appName ?? t('captures.apps.all')} />
              <WhereYouDictate
                stats={stats}
                apps={apps}
                filter={appFilter}
                appName={appName ?? ''}
                appIcon={appIcon}
                unknownIcon={unknownIcon}
                onFilterChange={setAppFilter}
              />
              <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
                <HeatMap stats={stats} />
                <LengthCurve lengths={stats.lengths} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
