import { Info } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageStatsResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import {
  formatCount,
  formatDay,
  formatSaved,
  formatShortDate,
  parseLocal,
  percentChange,
} from './usageFormat';

type Trend = 'up' | 'down' | 'flat';

/** Weekend days named in the tip before the rest are summed up. */
const WEEKEND_DAYS_LISTED = 3;

interface Card {
  label: string;
  value: string;
  unit?: string;
  note: string;
  trend: Trend;
  /** The tip on the note's info icon: a heading and what it refers to. */
  tip?: { heading: string; body: ReactNode };
}

function trendOf(change: number): Trend {
  return change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
}

function arrow(trend: Trend): string {
  return trend === 'up' ? '▲ ' : trend === 'down' ? '▼ ' : '';
}

function StatCard({ card }: { card: Card }) {
  const tipId = useId();
  const noteClass = cn(
    'text-xs font-semibold tabular-nums',
    card.trend === 'up' && 'text-success',
    card.trend === 'down' && 'text-destructive',
    card.trend === 'flat' && 'text-muted-foreground',
  );
  return (
    <div className="min-w-0 flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3.5">
      <span className="truncate text-xs text-muted-foreground">{card.label}</span>
      <span className="whitespace-nowrap text-[28px] font-bold leading-[1.1] tracking-tight tabular-nums">
        {card.value}
        {card.unit && (
          <small className="ml-1 text-[15px] font-semibold text-muted-foreground">
            {card.unit}
          </small>
        )}
      </span>
      {card.tip ? (
        // A button so the tip opens on focus as well as hover.
        <button
          type="button"
          aria-describedby={tipId}
          className="group relative self-start inline-flex items-center gap-1.5 rounded-sm cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={noteClass}>{card.note}</span>
          <Info
            aria-hidden="true"
            className="size-3.5 text-muted-foreground/70 group-hover:text-foreground group-focus-visible:text-foreground"
            strokeWidth={1.8}
          />
          <span
            id={tipId}
            role="tooltip"
            className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-left text-[11.5px] font-normal leading-snug text-popover-foreground shadow-md group-hover:block group-focus-visible:block"
          >
            <span className="block text-muted-foreground">{card.tip.heading}</span>
            {card.tip.body && <span className="block font-semibold">{card.tip.body}</span>}
          </span>
        </button>
      ) : (
        <span className={cn(noteClass, 'self-start')}>{card.note}</span>
      )}
    </div>
  );
}

/**
 * The four numbers at the top of Insights: words, pace, time saved, and the
 * weekdays dictated on, each against the equal period before. All time has
 * nothing before it, so its cards say where the count starts instead.
 * Today counts hours dictated in place of weekdays.
 */
export function StatCards({ stats }: { stats: UsageStatsResponse }) {
  const { t } = useTranslation();
  const cur = stats.current;
  const prev = stats.previous;
  const since = formatShortDate(parseLocal(stats.start));
  const comparedWith = prev
    ? t('insights.stats.compared', { period: t(`insights.previous.${stats.period}`) })
    : '';
  const sinceNote = {
    note: t('insights.stats.since', { date: since }),
    trend: 'flat' as const,
    tip: { heading: t('insights.stats.firstDictation'), body: formatDay(parseLocal(stats.start)) },
  };

  const words: Card = {
    label: t('insights.stats.words'),
    value: formatCount(cur.words),
    ...(prev
      ? (() => {
          const pct = percentChange(cur.words, prev.words);
          const trend = pct === null ? (cur.words ? 'up' : 'flat') : trendOf(pct);
          const note =
            pct === null
              ? cur.words
                ? `${arrow('up')}${t('insights.stats.new')}`
                : t('insights.stats.noChange')
              : pct === 0
                ? t('insights.stats.noChange')
                : `${arrow(trend)}${Math.abs(pct)}%`;
          return {
            note,
            trend,
            tip: {
              heading: comparedWith,
              body: t('insights.stats.prevWords', {
                count: prev.words,
                formatted: formatCount(prev.words),
              }),
            },
          };
        })()
      : sinceNote),
  };

  const pace: Card = {
    label: t('insights.stats.pace'),
    value: cur.pace_wpm != null ? String(cur.pace_wpm) : '—',
    unit: t('insights.stats.wpm'),
    ...(prev
      ? (() => {
          const tip = {
            heading: comparedWith,
            body:
              prev.pace_wpm != null
                ? t('insights.stats.prevPace', { count: prev.pace_wpm })
                : t('insights.stats.noPace'),
          };
          if (cur.pace_wpm == null || prev.pace_wpm == null) {
            return { note: t('insights.stats.nothingBefore'), trend: 'flat' as const, tip };
          }
          const change = cur.pace_wpm - prev.pace_wpm;
          const trend = trendOf(change);
          const note = change
            ? `${arrow(trend)}${Math.abs(change)} ${t('insights.stats.wpm')}`
            : t('insights.stats.noChange');
          return { note, trend, tip };
        })()
      : sinceNote),
  };

  const saved: Card = {
    label: t('insights.stats.saved'),
    value: formatSaved(cur.time_saved_ms),
    ...(prev
      ? (() => {
          const change = Math.round((cur.time_saved_ms - prev.time_saved_ms) / 60_000);
          const trend = trendOf(change);
          return {
            note: change
              ? `${arrow(trend)}${formatSaved(change * 60_000)}`
              : t('insights.stats.noChange'),
            trend,
            tip: {
              heading: comparedWith,
              body: t('insights.stats.prevSaved', { time: formatSaved(prev.time_saved_ms) }),
            },
          };
        })()
      : sinceNote),
  };

  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard card={words} />
      <StatCard card={pace} />
      <StatCard card={saved} />
      <StatCard card={stats.period === 'today' ? hoursCard() : weekdaysCard()} />
    </div>
  );

  function hoursCard(): Card {
    const change = prev ? cur.hours_dictated - prev.hours_dictated : 0;
    const trend = trendOf(change);
    return {
      label: t('insights.stats.hours'),
      value: String(cur.hours_dictated),
      note: change
        ? `${arrow(trend)}${t('insights.stats.prevHours', { count: Math.abs(change) })}`
        : t('insights.stats.noChange'),
      trend,
      tip: prev
        ? {
            heading: comparedWith,
            body: t('insights.stats.prevHours', { count: prev.hours_dictated }),
          }
        : undefined,
    };
  }

  function weekdaysCard(): Card {
    const weekend = cur.weekend_days;
    const base = {
      label: t('insights.stats.weekdays'),
      value: String(cur.weekdays_dictated),
      unit: t('insights.stats.of', { count: cur.weekdays_in_period }),
      trend: 'flat' as const,
    };
    if (weekend.length) {
      const listed = weekend.slice(0, WEEKEND_DAYS_LISTED);
      const rest = weekend.length - listed.length;
      return {
        ...base,
        note: t('insights.stats.weekend', { count: weekend.length }),
        tip: {
          heading: t('insights.stats.weekendTip'),
          body: (
            <>
              {listed.map((day) => (
                <span key={day.date} className="block">
                  {t('insights.stats.weekendDay', {
                    day: formatDay(parseLocal(day.date)),
                    words: t('insights.chart.words', {
                      count: day.words,
                      formatted: formatCount(day.words),
                    }),
                  })}
                </span>
              ))}
              {rest > 0 && (
                <span className="block font-normal text-muted-foreground">
                  {t('insights.stats.weekendMore', { count: rest })}
                </span>
              )}
            </>
          ),
        },
      };
    }
    return { ...base, note: t('insights.stats.weekdaysOnly'), tip: noWeekendTip() };
  }

  /** The weekend days the period covers, by name when there are two or fewer. */
  function noWeekendTip(): Card['tip'] {
    const days: Date[] = [];
    for (let d = parseLocal(stats.start); d <= parseLocal(stats.end); d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) days.push(new Date(d));
    }
    if (!days.length || days.length > 2) {
      return { heading: t('insights.stats.noWeekendAny'), body: null };
    }
    return {
      heading: t('insights.stats.noWeekend'),
      body: days.map(formatDay).join(' or '),
    };
  }
}
