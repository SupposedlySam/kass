import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * A chart's hover tip: a small popover card that never takes the pointer.
 * `align` keeps it inside the chart at the edges: centered on its anchor in
 * the middle, flush with it at the start or end.
 */
export function ChartTip({
  children,
  align = 'center',
  className,
  style,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      role="tooltip"
      style={style}
      className={cn(
        'pointer-events-none absolute z-20 whitespace-nowrap rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11.5px] leading-snug text-popover-foreground shadow-md',
        align === 'center' && '-translate-x-1/2',
        align === 'end' && '-translate-x-full',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Where a tip sits over column `index` of `count`: flush with the chart at the two ends. */
export function tipAlign(index: number, count: number, edge = 2): 'start' | 'center' | 'end' {
  if (count <= edge * 2) return index < count / 2 ? 'start' : 'end';
  if (index < edge) return 'start';
  if (index >= count - edge) return 'end';
  return 'center';
}
