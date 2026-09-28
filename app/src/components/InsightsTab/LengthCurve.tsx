import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { UsageLengths } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { ChartTip, tipAlign } from './ChartTip';
import { smoothPath } from './usageFormat';

const W = 600;
const H = 150;
/** Where the open-ended last bin is drawn to end. */
const LAST_BIN_END_S = 60;
/** The curve's ends run down past the first and last bins, toward these fractions of them. */
const START_TAPER = 0.7;
const END_TAPER = 0.5;

function binLabels(edges: number[]): string[] {
  return [
    `<${edges[0]}s`,
    ...edges.slice(1).map((edge, i) => `${edges[i]}–${edge}s`),
    `${edges[edges.length - 1]}s+`,
  ];
}

/** "3.4 s", "12 s", "1:05". */
function formatSeconds(ms: number): string {
  const s = ms / 1000;
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

/**
 * How long you talk: the share of dictations in each length bin as one
 * smooth curve, the middle half of them (quartile to quartile) shaded
 * darker, and a line at the median. Bins are evenly spaced, so a length
 * maps onto the x axis through the bin it falls in.
 */
export function LengthCurve({ lengths }: { lengths: UsageLengths }) {
  const { t } = useTranslation();
  // React's ids have colons, which url(#…) doesn't take.
  const clipId = `band${useId().replace(/:/g, '')}`;
  const { counts, bin_edges_s: edges } = lengths;
  const n = counts.length;
  const total = counts.reduce((sum, c) => sum + c, 0);
  const labels = binLabels(edges);

  if (!total || lengths.median_ms == null) {
    return (
      <Frame>
        <p className="text-[12.5px] text-muted-foreground">{t('insights.length.none')}</p>
      </Frame>
    );
  }

  const top = Math.max(...counts) * 1.15;
  const x = (i: number) => ((i + 0.5) / n) * W;
  const y = (c: number) => H - (c / top) * H;
  const points: Array<[number, number]> = [
    [0, y(counts[0] * START_TAPER)],
    ...counts.map((c, i): [number, number] => [x(i), y(c)]),
    [W, y(counts[n - 1] * END_TAPER)],
  ];
  const edge = smoothPath(points);
  const fill = `${edge} L${W},${H} L0,${H} Z`;

  // A length's place on the axis: its bin, then how far through it.
  const bounds = [0, ...edges, LAST_BIN_END_S];
  const frac = (ms: number) => {
    const s = ms / 1000;
    let bin = 0;
    while (bin < n - 1 && s >= bounds[bin + 1]) bin++;
    const within = Math.min(1, (s - bounds[bin]) / (bounds[bin + 1] - bounds[bin]));
    return (bin + within) / n;
  };
  const median = frac(lengths.median_ms);
  const lo = frac(lengths.p25_ms ?? lengths.median_ms);
  const hi = frac(lengths.p75_ms ?? lengths.median_ms);
  const most = counts.indexOf(Math.max(...counts));
  const medianText = t('insights.length.median', { value: formatSeconds(lengths.median_ms) });

  return (
    <Frame>
      <div className="relative" style={{ height: H }}>
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={lo * W} y={0} width={Math.max(1, (hi - lo) * W)} height={H} />
            </clipPath>
          </defs>
          <path d={fill} className="fill-accent/20" />
          <path d={fill} clipPath={`url(#${clipId})`} className="fill-accent/35" />
          <path
            d={edge}
            vectorEffect="non-scaling-stroke"
            className="fill-none stroke-accent [stroke-width:2]"
          />
        </svg>
        <div
          className="pointer-events-none absolute inset-y-0 border-l-[1.5px] border-foreground"
          style={{ left: `${median * 100}%` }}
        >
          <span
            className={cn(
              'absolute -top-0.5 whitespace-nowrap text-[11px] font-semibold',
              // Past two thirds, the label sits left of the line so it stays in the card.
              median > 0.66 ? 'right-[7px]' : 'left-[7px]',
            )}
          >
            {medianText}
          </span>
        </div>
        <div className="absolute inset-0 flex">
          {counts.map((count, i) => {
            const align = tipAlign(i, n, 1);
            return (
              <div key={labels[i]} className="group/bin relative flex-1 hover:bg-foreground/[0.03]">
                <ChartTip
                  align={align}
                  className={cn(
                    'hidden group-hover/bin:block',
                    align === 'start' ? 'left-0' : align === 'end' ? 'left-full' : 'left-1/2',
                  )}
                  style={{ bottom: `calc(${Math.min((count / top) * 100, 100)}% + 10px)` }}
                >
                  <b className="block text-[12.5px] tabular-nums">
                    {t('insights.length.share', { pct: Math.round((count / total) * 100) })}
                  </b>
                  <span className="text-muted-foreground">
                    {t('insights.length.count', { count, bin: labels[i] })}
                  </span>
                </ChartTip>
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden="true" className="flex">
        {labels.map((label) => (
          <span
            key={label}
            className="flex-1 text-center text-[10.5px] tabular-nums text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>
      <span className="text-[11.5px] text-muted-foreground">
        {t('insights.length.most', { bin: labels[most] })} {t('insights.length.band')}
      </span>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 flex flex-col gap-3.5 rounded-lg border border-border bg-card px-[18px] py-4">
      <h3 className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        {t('insights.length.title')}
        <small className="text-[11.5px] font-normal text-muted-foreground">
          {t('insights.length.hint')}
        </small>
      </h3>
      {children}
    </section>
  );
}
