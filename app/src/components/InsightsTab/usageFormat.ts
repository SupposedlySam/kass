import type { CaptureAppFilter, UsagePeriod } from '@/lib/api/types';

/**
 * The stats' query key. Under ['captures'], so every capture change (a new
 * dictation, a deletion, a saved correction) refreshes them.
 */
export function statsKey(period: UsagePeriod, filter: CaptureAppFilter): readonly unknown[] {
  return ['captures', 'stats', period, filter];
}

/**
 * A local day or hour from the stats ("2026-09-28", "2026-09-28T14:00").
 * The server has already turned them into the Mac's time, so they're read
 * as local, never as UTC.
 */
export function parseLocal(value: string): Date {
  const [day, time] = value.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const hour = time ? Number(time.slice(0, 2)) : 0;
  return new Date(y, m - 1, d, hour);
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Time saved: "2h 21m", "47m", "0m". */
export function formatSaved(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "Mon, Sep 28". */
export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Sep 28". */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Mon". */
export function formatWeekday(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

/** A compact hour for axes: "7a", "12p", "10p". */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Percent change from `previous` to `current`, or null when there's nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * A percent change as people read it: "18%", or a multiple once it's at least
 * tripled ("16×"), where a percentage like 1550% stops meaning much. Unsigned;
 * callers add the arrow.
 */
export function formatChange(pct: number): string {
  if (pct >= 200) return `${Math.round((pct + 100) / 100)}×`;
  return `${Math.abs(pct)}%`;
}

/**
 * A smooth path through points, as monotone cubic Béziers (Fritsch–Carlson):
 * the curve never swings above a peak or below a zero between two points,
 * so it never shows words that weren't there. Points go left to right.
 */
export function smoothPath(points: Array<[number, number]>): string {
  if (!points.length) return '';
  const n = points.length;
  const f = (v: number) => v.toFixed(1);
  const slopes = points
    .slice(0, -1)
    .map((p, i) => (points[i + 1][1] - p[1]) / (points[i + 1][0] - p[0] || 1));
  // Each point's tangent: flat at a turn, else its neighbours' mean slope, limited to
  // what keeps the curve between them (as d3's curveMonotoneX does).
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0] ?? 0;
    if (i === n - 1) return slopes[n - 2];
    const a = slopes[i - 1];
    const b = slopes[i];
    const mean = (a + b) / 2;
    return (Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs(mean));
  });
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = (x1 - x0) / 3;
    d += ` C${f(x0 + dx)},${f(y0 + tangents[i] * dx)} ${f(x1 - dx)},${f(y1 - tangents[i + 1] * dx)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
