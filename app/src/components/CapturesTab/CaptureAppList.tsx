import { CircleHelp, LayoutGrid, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { CaptureAppFilter, CaptureAppsResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';
import { AppIcon } from './AppIcon';
import { sameAppFilter } from './captureApps';

/** One row of the app list, whether "All apps", an app or "Unknown app". */
interface AppListRow {
  filter: CaptureAppFilter;
  name: string;
  count: number;
  icon: ReactNode;
  /** An app's writing style, and whether it's new: not confirmed yet. */
  style?: string;
  isNew?: boolean;
}

/** An app's icon at `size`, or its initial when the app isn't installed. */
export function AppTile({
  bundleId,
  name,
  className,
}: {
  bundleId: string;
  name: string;
  className?: string;
}) {
  return (
    <AppIcon
      bundleId={bundleId}
      className={cn('size-6', className)}
      fallback={
        <span
          aria-hidden
          className={cn(
            'size-6 shrink-0 grid place-items-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground',
            className,
          )}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      }
    />
  );
}

/** A glyph in an app-sized tile, for "All apps" and "Unknown app". */
export function SymbolTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="size-6 shrink-0 grid place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-3.5"
    >
      {children}
    </span>
  );
}

/** The display name of an app in the list: its saved name, else its bundle id. */
export function appDisplayName(app: { app_name?: string | null; app_bundle_id: string }): string {
  return app.app_name || app.app_bundle_id;
}

/**
 * The Captures app list between the main rail and the capture list: "All
 * apps", then every app with captures, most first, with its writing style
 * underneath. An app whose style the user hasn't confirmed shows New (a dot
 * when collapsed). Counts come from the server, since the list below only
 * loads the newest captures. Captures with no app recorded (uploads,
 * dictation from before apps were saved) get an "Unknown app" row at the
 * end. The header button shrinks it to icons, with each icon's name, style
 * and count in its tooltip.
 */
export function CaptureAppList({
  apps,
  styleNames,
  filter,
  onFilterChange,
}: {
  apps: CaptureAppsResponse | undefined;
  styleNames: Map<string, string>;
  filter: CaptureAppFilter;
  onFilterChange: (filter: CaptureAppFilter) => void;
}) {
  const { t } = useTranslation();
  const collapsed = useUIStore((s) => s.capturesAppsCollapsed);
  const setCollapsed = useUIStore((s) => s.setCapturesAppsCollapsed);

  const rows: AppListRow[] = [
    {
      filter: { kind: 'all' },
      name: t('captures.apps.all'),
      count: apps?.total ?? 0,
      icon: (
        <SymbolTile>
          <LayoutGrid />
        </SymbolTile>
      ),
    },
    ...(apps?.apps ?? []).map((app) => ({
      filter: { kind: 'app', bundleId: app.app_bundle_id } as const,
      name: appDisplayName(app),
      count: app.count,
      icon: <AppTile bundleId={app.app_bundle_id} name={appDisplayName(app)} />,
      style: app.confirmed ? styleNames.get(app.style_id ?? '') : undefined,
      isNew: !app.confirmed,
    })),
    ...(apps?.unknown_count
      ? [
          {
            filter: { kind: 'unknown' } as const,
            name: t('captures.apps.unknown'),
            count: apps.unknown_count,
            icon: (
              <SymbolTile>
                <CircleHelp />
              </SymbolTile>
            ),
          },
        ]
      : []),
  ];

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggle = (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={t(collapsed ? 'captures.apps.expand' : 'captures.apps.collapse')}
      aria-expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)}
    >
      <ToggleIcon strokeWidth={1.7} />
    </Button>
  );

  return (
    <nav
      aria-label={t('captures.apps.title')}
      className={cn(
        'shrink-0 flex flex-col min-h-0 py-3 border-r border-border bg-sidebar',
        collapsed ? 'w-16 items-center px-2.5' : 'w-[220px] px-3',
      )}
    >
      {collapsed ? (
        <div className="mb-1.5">{toggle}</div>
      ) : (
        <div className="h-8 mb-1.5 flex items-center justify-between pl-2.5">
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('captures.apps.title')}
          </h2>
          {toggle}
        </div>
      )}
      <ul className="flex-1 min-h-0 flex flex-col gap-0.5 overflow-y-auto">
        {rows.map((row) => {
          const active = sameAppFilter(row.filter, filter);
          const key = row.filter.kind === 'app' ? row.filter.bundleId : row.filter.kind;
          const count = row.count.toLocaleString();
          const style = row.isNew ? t('captures.apps.noStyle') : row.style;
          const label = [row.name, style, count].filter(Boolean).join(' · ');
          return (
            <li key={key}>
              {collapsed ? (
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  aria-label={label}
                  // A native tooltip, since a drawn one would be clipped by the scrolling list.
                  title={label}
                  onClick={() => onFilterChange(row.filter)}
                  className={cn(
                    'relative size-11 grid place-items-center rounded-[7px] transition-colors',
                    'focus-visible:outline-none focus-visible:bg-muted',
                    active ? 'bg-muted' : 'hover:bg-muted/50',
                  )}
                >
                  {row.icon}
                  {row.isNew && (
                    <span className="absolute top-[7px] right-[7px] size-[7px] rounded-full bg-accent ring-2 ring-sidebar" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onFilterChange(row.filter)}
                  className={cn(
                    'w-full h-11 grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-2.5 rounded-[7px] text-left text-[13px] transition-colors',
                    'focus-visible:outline-none focus-visible:bg-muted',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-foreground/80 hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  {row.icon}
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="truncate">{row.name}</span>
                    {style && (
                      <span className="truncate text-[11px] text-muted-foreground">{style}</span>
                    )}
                  </span>
                  {row.isNew ? (
                    <span className="text-right text-[10.5px] font-semibold text-accent">
                      {t('captures.apps.new')}
                    </span>
                  ) : (
                    <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
