import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTile, appDisplayName } from '@/components/CapturesTab/CaptureAppList';
import { ALL_APPS } from '@/components/CapturesTab/captureApps';
import type {
  CaptureAppFilter,
  CaptureAppsResponse,
  UsageStatsResponse,
  UsageTotals,
} from '@/lib/api/types';
import { formatCount } from './usageFormat';

/** "34%", "<1%" for a share too small to round up to 1. */
function formatShare(part: number, whole: number): string {
  if (!whole) return '—';
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

function fixRate(totals: UsageTotals): string {
  if (!totals.captures) return '—';
  const pct = (totals.fixed_captures / totals.captures) * 100;
  return `${pct.toFixed(pct === 0 || pct >= 10 ? 0 : 1)}%`;
}

function Chip({
  icon,
  name,
  value,
  sub,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  value: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-left transition-colors hover:border-input hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      <span className="flex min-w-0 flex-col gap-px">
        <span className="max-w-[160px] truncate text-xs text-muted-foreground">{name}</span>
        <span className="text-base font-bold leading-tight tabular-nums">{value}</span>
      </span>
      <span className="ml-1 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
        {sub}
      </span>
    </button>
  );
}

/**
 * Where you dictate: every app's words and share of the period, most first;
 * clicking one shows only its stats. With an app shown, the row compares it
 * with all apps instead (its share, its pace, how often it needed a fix),
 * and clicking goes back to all apps.
 */
export function WhereYouDictate({
  stats,
  apps,
  filter,
  appName,
  appIcon,
  unknownIcon,
  onFilterChange,
}: {
  stats: UsageStatsResponse;
  apps: CaptureAppsResponse | undefined;
  filter: CaptureAppFilter;
  appName: string;
  appIcon: ReactNode;
  unknownIcon: ReactNode;
  onFilterChange: (filter: CaptureAppFilter) => void;
}) {
  const { t } = useTranslation();
  const all = stats.all_apps;
  const cur = stats.current;
  const names = new Map(apps?.apps.map((app) => [app.app_bundle_id, appDisplayName(app)]));
  const back = () => onFilterChange(ALL_APPS);

  if (filter.kind !== 'all') {
    const paceDiff =
      cur.pace_wpm != null && all.pace_wpm != null ? cur.pace_wpm - all.pace_wpm : null;
    return (
      <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-[18px] py-4">
        <h3 className="flex items-center justify-between gap-2 text-[13px] font-semibold">
          {t('insights.where.compareTitle', { app: appName })}
          <small className="text-[11.5px] font-normal text-muted-foreground">
            {t('insights.where.compareHint')}
          </small>
        </h3>
        <div className="flex flex-wrap gap-2.5">
          <Chip
            icon={appIcon}
            name={t('insights.where.shareTitle')}
            value={formatShare(cur.words, all.words)}
            sub={t('insights.where.shareSub', {
              words: formatCount(cur.words),
              total: formatCount(all.words),
            })}
            onClick={back}
          />
          <Chip
            icon={appIcon}
            name={t('insights.where.paceTitle')}
            value={
              paceDiff === null
                ? '—'
                : `${paceDiff >= 0 ? '+' : '−'}${Math.abs(paceDiff)} ${t('insights.stats.wpm')}`
            }
            sub={t('insights.where.paceSub', {
              pace: cur.pace_wpm ?? '—',
              all: all.pace_wpm ?? '—',
            })}
            onClick={back}
          />
          <Chip
            icon={appIcon}
            name={t('insights.where.fixTitle')}
            value={fixRate(cur)}
            sub={t('insights.where.fixSub', { pct: fixRate(all) })}
            onClick={back}
          />
        </div>
      </section>
    );
  }

  const rows = stats.apps.filter((app) => app.captures > 0);
  // Shares go by words; a period of empty dictations falls back to how many there were.
  const byWords = all.words > 0;
  return (
    <section className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-[18px] py-4">
      <h3 className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        {t('insights.where.title')}
        {rows.length > 1 && (
          <small className="text-[11.5px] font-normal text-muted-foreground">
            {t('insights.where.hint')}
          </small>
        )}
      </h3>
      {rows.length ? (
        <div className="flex flex-wrap gap-2.5">
          {rows.map((app) => {
            const id = app.app_bundle_id;
            const name = id ? (names.get(id) ?? id) : t('captures.apps.unknown');
            return (
              <Chip
                key={id ?? 'unknown'}
                icon={id ? <AppTile bundleId={id} name={name} /> : unknownIcon}
                name={name}
                value={formatCount(app.words)}
                sub={t('insights.where.share', {
                  pct: byWords
                    ? formatShare(app.words, all.words)
                    : formatShare(app.captures, all.captures),
                })}
                onClick={() =>
                  onFilterChange(id ? { kind: 'app', bundleId: id } : { kind: 'unknown' })
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{t('insights.where.none')}</p>
      )}
    </section>
  );
}
