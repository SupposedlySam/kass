import { useTranslation } from 'react-i18next';
import type { UsagePoint, UsageStatsResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { ChartTip, tipAlign } from './ChartTip';
import {
  formatChange,
  formatCount,
  formatDay,
  formatShortDate,
  formatWeekday,
  hourLabel,
  parseLocal,
  percentChange,
  smoothPath,
} from './usageFormat';

const W = 700;
const H = 170;
/** Hours Today always shows, widened to take in any dictation outside them. */
const FIRST_HOUR = 7;
const LAST_HOUR = 22;
/** Past this many points, dots only show on the hovered one. */
const MAX_DOTS = 14;
/** About how many x labels fit without crowding. */
const MAX_LABELS = 8;
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The chart's top: three even, round steps above the highest point, with headroom. */
function axisTop(peak: number): number {
  const raw = Math.max((peak * 1.1) / 3, 5);
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = (STEPS.find((m) => m * p >= raw) ?? 10) * p;
  return step * 3;
}

/** Today's hours from 7a to 10p, or wider when there was dictation outside them. */
function shownPoints(stats: UsageStatsResponse): UsagePoint[] {
  if (stats.bucket !== 'hour') return stats.series;
  const active = stats.series.flatMap((p, i) => (p.words || p.previous_words ? [i] : []));
  return stats.series.slice(Math.min(FIRST_HOUR, ...active), Math.max(LAST_HOUR, ...active) + 1);
}

/** Every `step`th point gets an x label, counted back from the newest so it's always labeled. */
function labelStep(stats: UsageStatsResponse, count: number): number {
  if (stats.bucket === 'hour') return 3;
  return Math.max(1, Math.ceil(count / MAX_LABELS));
}

/**
 * Words over the period against the period before, on one axis: the
 * current period solid with a light fill, the one before dashed. Today is
 * by hour against yesterday; All time is weekly totals with nothing to
 * compare. Hovering a point shows both values and the change.
 */
export function WordsChart({ stats, appName }: { stats: UsageStatsResponse; appName: string }) {
  const { t } = useTranslation();
  const points = shownPoints(stats);
  const n = points.length;
  const compare = stats.bucket !== 'week';
  const top = axisTop(Math.max(0, ...points.flatMap((p) => [p.words ?? 0, p.previous_words ?? 0])));
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (v: number) => H - (v / top) * H;
  const pct = (v: number) => (v / top) * 100;

  const current = points.flatMap((p, i) =>
    p.words == null ? [] : [[x(i), y(p.words)] as [number, number]],
  );
  const previous = compare
    ? points.flatMap((p, i) =>
        p.previous_words == null ? [] : [[x(i), y(p.previous_words)] as [number, number]],
      )
    : [];
  const currentPath = smoothPath(current);
  const area =
    current.length > 1
      ? `${currentPath} L${current[current.length - 1][0].toFixed(1)},${H} L${current[0][0].toFixed(1)},${H} Z`
      : '';

  const title = t(`insights.chart.${stats.bucket}`);
  const legendCurrent = t(`insights.legend.current.${stats.period}`);
  const legendPrevious = compare ? t(`insights.legend.previous.${stats.period}`) : '';
  const step = labelStep(stats, n);
  const words = (v: number | null) =>
    v
      ? t('insights.chart.words', { count: v, formatted: formatCount(v) })
      : t('insights.chart.noDictation');

  const pointTitle = (p: UsagePoint, last: boolean) => {
    const date = parseLocal(p.start);
    if (stats.bucket === 'hour') {
      const hours = `${hourLabel(date.getHours())}–${hourLabel(date.getHours() + 1)}`;
      return `${hours} ${t('insights.chart.today')}`;
    }
    if (stats.bucket === 'week') {
      const week = t('insights.chart.weekOf', { date: formatShortDate(date) });
      return last ? `${week} · ${t('insights.chart.thisWeek')}` : week;
    }
    return last ? `${formatDay(date)} · ${t('insights.chart.today')}` : formatDay(date);
  };

  const xLabel = (p: UsagePoint) => {
    const date = parseLocal(p.start);
    if (stats.bucket === 'hour') return { main: hourLabel(date.getHours()) };
    if (stats.bucket === 'week') return { main: formatShortDate(date) };
    return { main: formatWeekday(date).charAt(0), sub: formatShortDate(date) };
  };

  return (
    <section className="min-w-0 flex flex-col gap-3.5 rounded-lg border border-border bg-card px-[18px] py-4">
      <h3 className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        {title}
        {compare && (
          <span className="flex gap-3.5 text-[11.5px] font-normal text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="w-4 border-t-2 border-accent" />
              {legendCurrent}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="w-4 border-t-2 border-dashed border-muted-foreground/70" />
              {legendPrevious}
            </span>
          </span>
        )}
      </h3>

      <div
        role="img"
        aria-label={t('insights.chart.label', { title, app: appName })}
        className="relative ml-11 mt-1.5"
        style={{ height: H }}
      >
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="absolute inset-x-0" style={{ bottom: `${(k / 3) * 100}%` }}>
            <div className={cn('border-t', k === 0 ? 'border-input' : 'border-border/70')} />
            <span className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[10.5px] tabular-nums text-muted-foreground">
              {formatCount((top * k) / 3)}
            </span>
          </div>
        ))}

        <svg
          aria-hidden="true"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          {area && <path d={area} className="fill-accent/12" />}
          {previous.length > 1 && (
            <path
              d={smoothPath(previous)}
              vectorEffect="non-scaling-stroke"
              className="fill-none stroke-muted-foreground/70 [stroke-dasharray:5_5] [stroke-linejoin:round] [stroke-width:2]"
            />
          )}
          {current.length > 1 && (
            <path
              d={currentPath}
              vectorEffect="non-scaling-stroke"
              className="fill-none stroke-accent [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.5]"
            />
          )}
        </svg>

        {/* Few points get a dot each; many show dots on the hovered one only. */}
        {n <= MAX_DOTS &&
          points.map((p, i) => (
            <Dots
              key={p.start}
              point={p}
              compare={compare}
              pct={pct}
              left={`${((i + 0.5) / n) * 100}%`}
            />
          ))}

        <div className="absolute inset-0 flex">
          {points.map((p, i) => {
            const last = i === n - 1;
            const change =
              compare && p.words != null && p.previous_words != null
                ? percentChange(p.words, p.previous_words)
                : null;
            const higher = Math.max(p.words ?? 0, p.previous_words ?? 0);
            const align = tipAlign(i, n);
            return (
              <div key={p.start} className="group/col relative flex-1">
                <span className="absolute inset-y-0 left-1/2 hidden border-l border-input group-hover/col:block" />
                {n > MAX_DOTS && (
                  <span className="hidden group-hover/col:block">
                    <Dots point={p} compare={compare} pct={pct} left="50%" />
                  </span>
                )}
                <ChartTip
                  align={align}
                  className={cn(
                    'hidden group-hover/col:block',
                    align === 'start' ? 'left-0' : align === 'end' ? 'left-full' : 'left-1/2',
                  )}
                  style={{ bottom: `calc(${Math.min(pct(higher), 100)}% + 10px)` }}
                >
                  <b className="block text-[12.5px] tabular-nums">{pointTitle(p, last)}</b>
                  {p.words != null && (
                    <span className="flex items-center gap-2 tabular-nums">
                      {compare && (
                        <i aria-hidden className="w-4 shrink-0 border-t-2 border-accent" />
                      )}
                      {words(p.words)}
                    </span>
                  )}
                  {compare && p.previous_words != null && p.previous_start && (
                    <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                      <i
                        aria-hidden
                        className="w-4 shrink-0 border-t-2 border-dashed border-muted-foreground/70"
                      />
                      {t('insights.chart.on', {
                        value: words(p.previous_words),
                        date: formatShortDate(parseLocal(p.previous_start)),
                      })}
                    </span>
                  )}
                  {change !== null && change !== 0 && (
                    <span
                      className={cn(
                        'block tabular-nums',
                        change > 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {t('insights.chart.change', {
                        pct: `${change > 0 ? '▲' : '▼'} ${formatChange(change)}`,
                        period: legendPrevious.toLowerCase(),
                      })}
                    </span>
                  )}
                </ChartTip>
              </div>
            );
          })}
        </div>
      </div>

      <div aria-hidden="true" className="ml-11 flex">
        {points.map((p, i) => {
          const shown = (n - 1 - i) % step === 0;
          const label = xLabel(p);
          return (
            <span key={p.start} className="relative flex-1 h-7">
              {shown && (
                <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap text-center text-[10.5px] leading-[1.35] tabular-nums text-muted-foreground">
                  {label.main}
                  {label.sub && (
                    <i className="block not-italic text-muted-foreground/60">{label.sub}</i>
                  )}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** A point's dots: the current period's filled, the one before hollow. */
function Dots({
  point,
  compare,
  pct,
  left,
}: {
  point: UsagePoint;
  compare: boolean;
  pct: (v: number) => number;
  left: string;
}) {
  return (
    <>
      {compare && point.previous_words != null && (
        <span
          className="absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-muted-foreground/70 bg-card"
          style={{ left, bottom: `${pct(point.previous_words)}%` }}
        />
      )}
      {point.words != null && (
        <span
          className="absolute size-[9px] -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-card bg-accent"
          style={{ left, bottom: `${pct(point.words)}%` }}
        />
      )}
    </>
  );
}
