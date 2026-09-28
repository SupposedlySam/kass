import { useTranslation } from 'react-i18next';
import type { UsageStatsResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { ChartTip, tipAlign } from './ChartTip';
import { formatCount, hourLabel } from './usageFormat';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Hours always shown, widened to take in any dictation outside them. */
const FIRST_HOUR = 7;
const LAST_HOUR = 22;
/** Label every third hour. */
const LABEL_EVERY = 3;
/** The lightest a cell with any words gets, so a quiet hour still reads as used. */
const MIN_ALPHA = 0.15;
const LEGEND = [0.15, 0.36, 0.58, 0.79, 1];
/** Weekends under this share of the words are called out as nearly empty. */
const QUIET_WEEKEND = 0.05;
/** Weekdays with dictation needed before the weekend is called quiet. */
const MIN_WEEKDAYS = 3;

function shade(alpha: number) {
  return { background: `hsl(var(--accent) / ${alpha.toFixed(2)})` };
}

/**
 * When you dictate: words by weekday and hour, one accent ramp from fewer
 * to more, with the busiest slot named underneath. Hovering a cell shows
 * its words and time slot.
 */
export function HeatMap({ stats }: { stats: UsageStatsResponse }) {
  const { t } = useTranslation();
  const grid = stats.heatmap;
  const active = grid.flatMap((row) => row.flatMap((v, h) => (v ? [h] : [])));
  const first = Math.min(FIRST_HOUR, ...active);
  const last = Math.max(LAST_HOUR, ...active);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const max = Math.max(0, ...grid.flat());
  const total = grid.flat().reduce((sum, v) => sum + v, 0);

  let busiest = '';
  let best = 0;
  grid.forEach((row, d) => {
    row.forEach((v, h) => {
      if (v > best) {
        best = v;
        busiest = `${WEEKDAYS[d]} ${hourLabel(h)}–${hourLabel(h + 1)}`;
      }
    });
  });
  const weekend = grid[5].concat(grid[6]).reduce((sum, v) => sum + v, 0);
  // Only said once there are enough weekdays to set the weekend against.
  const weekdaysUsed = grid.slice(0, 5).filter((row) => row.some(Boolean)).length;
  const quietWeekend = weekdaysUsed >= MIN_WEEKDAYS && total > 0 && weekend / total < QUIET_WEEKEND;

  return (
    <section className="min-w-0 flex flex-col gap-3.5 rounded-lg border border-border bg-card px-[18px] py-4">
      <h3 className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        {t('insights.when.title')}
        <span className="flex items-center gap-1.5 text-[10.5px] font-normal text-muted-foreground">
          {t('insights.when.fewer')}
          {LEGEND.map((alpha) => (
            <i
              key={alpha}
              aria-hidden="true"
              className="h-2.5 w-3.5 rounded-[2px]"
              style={shade(alpha)}
            />
          ))}
          {t('insights.when.more')}
        </span>
      </h3>
      <div
        className="grid items-center gap-[3px]"
        style={{ gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))` }}
      >
        {grid.map((row, d) => (
          <div key={WEEKDAYS[d]} className="contents">
            <span className="text-[10.5px] text-muted-foreground">{WEEKDAYS[d]}</span>
            {hours.map((h, c) => {
              const v = row[h];
              const key = `${d}-${h}`;
              const align = tipAlign(c, hours.length, 3);
              return (
                <div
                  key={key}
                  className={cn(
                    'group/cell relative h-[18px] rounded-[3px] hover:outline hover:outline-[1.5px] hover:outline-offset-1 hover:outline-foreground/60',
                    !v && 'bg-muted',
                  )}
                  style={v ? shade(MIN_ALPHA + (1 - MIN_ALPHA) * (v / max)) : undefined}
                >
                  <ChartTip
                    align={align}
                    className={cn(
                      'hidden group-hover/cell:block bottom-[calc(100%+6px)]',
                      align === 'start' ? 'left-0' : align === 'end' ? 'left-full' : 'left-1/2',
                    )}
                  >
                    <b className="block text-[12.5px] tabular-nums">
                      {v
                        ? t('insights.chart.words', { count: v, formatted: formatCount(v) })
                        : t('insights.chart.noDictation')}
                    </b>
                    <span className="text-muted-foreground">
                      {WEEKDAYS[d]}, {hourLabel(h)}–{hourLabel(h + 1)}
                    </span>
                  </ChartTip>
                </div>
              );
            })}
          </div>
        ))}
        <span />
        {hours.map((h) => (
          <span key={h} className="relative h-3.5">
            {(h - first) % LABEL_EVERY === 0 && (
              <span className="absolute left-0 whitespace-nowrap text-[10px] text-muted-foreground">
                {hourLabel(h)}
              </span>
            )}
          </span>
        ))}
      </div>
      <span className="text-[11.5px] text-muted-foreground">
        {best
          ? [
              t('insights.when.busiest', { slot: busiest }),
              quietWeekend && t('insights.when.weekendsQuiet'),
            ]
              .filter(Boolean)
              .join(' ')
          : t('insights.when.none')}
      </span>
    </section>
  );
}
