import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { type DragEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTile } from '@/components/CapturesTab/CaptureAppList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { StyledApp, WritingStyle, WritingStylesResponse } from '@/lib/api/types';
import { defaultStyle, useConfirmApps, WRITING_STYLES_KEY } from '@/lib/hooks/useWritingStyle';
import { cn } from '@/lib/utils/cn';
import { useMoveApp } from './MoveAppDialog';

const DRAG_TYPE = 'application/x-herga-app';

/** App icons a style's card shows before "+N more". */
const PREVIEW_APPS = 3;

export function appLabel(app: Pick<StyledApp, 'name' | 'bundle_id'>): string {
  return app.name || app.bundle_id;
}

/** A style's apps, most dictated first. */
export function appsIn(data: WritingStylesResponse | undefined, styleId: string): StyledApp[] {
  return (data?.apps ?? [])
    .filter((app) => app.style_id === styleId)
    .sort((a, b) => b.count - a.count || appLabel(a).localeCompare(appLabel(b)));
}

/** What the app list shows: every app, one style's, or only new ones. */
export type AppListFilter = { kind: 'style'; styleId: string } | { kind: 'new' } | null;

/**
 * One card per style with a preview of its apps: a few icons, most dictated
 * first, then "+N more". Icons are dragged between cards. Clicking a card
 * selects the style for editing below and filters the app list to it. An
 * app the user hasn't assigned sits in the default style, dotted as new.
 */
export function StyleBoard({
  data,
  selectedId,
  onSelect,
  filter,
  onFilter,
}: {
  data: WritingStylesResponse;
  selectedId: string;
  onSelect: (styleId: string) => void;
  filter: AppListFilter;
  onFilter: (filter: AppListFilter) => void;
}) {
  const { t } = useTranslation();
  const mover = useMoveApp();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Names being typed, one card each. Adding another saves the one in progress.
  const [drafts, setDrafts] = useState<number[]>([]);
  const nextDraft = useRef(0);
  const full = data.styles.length >= data.max_styles;
  const canAdd = data.styles.length + drafts.length < data.max_styles;

  const move = (bundleId: string, styleId: string) => {
    const app = data.apps.find((a) => a.bundle_id === bundleId);
    if (app) mover.move(app, styleId);
  };
  const show = (styleId: string) => {
    onSelect(styleId);
    onFilter({ kind: 'style', styleId });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-end gap-3">
        {full && (
          <span id="style-limit" className="text-[11.5px] text-muted-foreground">
            {t('writingStyle.styles.limit', { count: data.max_styles })}
          </span>
        )}
        <button
          type="button"
          disabled={!canAdd}
          aria-describedby={full ? 'style-limit' : undefined}
          onClick={() => setDrafts((current) => [...current, nextDraft.current++])}
          className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-3 text-[12.5px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:border-input disabled:hover:text-muted-foreground"
        >
          <Plus className="size-3.5" />
          {t('writingStyle.styles.new')}
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
        {data.styles.map((style) => (
          <StyleCard
            key={style.id}
            style={style}
            apps={appsIn(data, style.id)}
            selected={style.id === selectedId}
            filtered={filter?.kind === 'style' && filter.styleId === style.id}
            over={over === style.id}
            dragging={dragging}
            onShow={() => {
              const same = filter?.kind === 'style' && filter.styleId === style.id;
              onSelect(style.id);
              onFilter(same ? null : { kind: 'style', styleId: style.id });
            }}
            onShowAll={() => show(style.id)}
            onDragState={setDragging}
            onOver={(isOver) =>
              setOver((current) => (isOver ? style.id : current === style.id ? null : current))
            }
            onDrop={(bundleId) => {
              setOver(null);
              setDragging(null);
              move(bundleId, style.id);
            }}
          />
        ))}
        {drafts.map((draft) => (
          <NewStyleCard
            key={draft}
            onDone={(styleId) => {
              setDrafts((current) => current.filter((d) => d !== draft));
              if (styleId) onSelect(styleId);
            }}
          />
        ))}
      </div>
      {mover.dialog}
    </div>
  );
}

function StyleCard({
  style,
  apps,
  selected,
  filtered,
  over,
  dragging,
  onShow,
  onShowAll,
  onDragState,
  onOver,
  onDrop,
}: {
  style: WritingStyle;
  apps: StyledApp[];
  selected: boolean;
  filtered: boolean;
  over: boolean;
  dragging: string | null;
  onShow: () => void;
  onShowAll: () => void;
  onDragState: (bundleId: string | null) => void;
  onOver: (over: boolean) => void;
  onDrop: (bundleId: string) => void;
}) {
  const { t } = useTranslation();
  const shown = apps.slice(0, PREVIEW_APPS);
  const rest = apps.length - shown.length;

  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(DRAG_TYPE);

  return (
    <section
      aria-label={t('writingStyle.styles.columnLabel', { style: style.name })}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onOver(false);
      }}
      onDrop={(event) => {
        const bundleId = event.dataTransfer.getData(DRAG_TYPE);
        if (!bundleId) return;
        event.preventDefault();
        onDrop(bundleId);
      }}
      className={cn(
        'relative flex flex-col gap-2.5 rounded-[10px] border p-3 transition-colors',
        over
          ? 'border-dashed border-accent bg-accent/[0.08]'
          : selected
            ? 'border-accent/55 bg-accent/[0.04]'
            : 'border-border bg-card/40 hover:border-ring/40',
      )}
    >
      {/* The button stretches over the whole card so any of it is clickable;
          app icons and "+N more" sit above it to stay draggable and clickable. */}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('writingStyle.styles.edit', { style: style.name })}
        onClick={onShow}
        className="flex w-full items-center gap-2 text-left before:absolute before:inset-0 before:rounded-[10px] focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-ring"
      >
        <span className="truncate text-sm font-semibold">{style.name}</span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {t('writingStyle.styles.count', { count: apps.length })}
        </span>
        {style.is_default && (
          <span className="shrink-0 rounded-full border border-input px-1.5 text-[10.5px] font-semibold text-muted-foreground">
            {t('writingStyle.styles.default')}
          </span>
        )}
        {filtered && (
          <span className="ml-auto shrink-0 text-[11px] text-accent">
            {t('writingStyle.styles.showing')}
          </span>
        )}
      </button>
      <ul className="flex min-h-8 flex-wrap items-center gap-2">
        {shown.map((app) => (
          <li
            key={app.bundle_id}
            draggable
            title={app.confirmed ? appLabel(app) : `${appLabel(app)} · ${t('captures.apps.new')}`}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, app.bundle_id);
              event.dataTransfer.setData('text/plain', appLabel(app));
              event.dataTransfer.effectAllowed = 'move';
              onDragState(app.bundle_id);
            }}
            onDragEnd={() => {
              onDragState(null);
              onOver(false);
            }}
            className={cn(
              'relative z-10 shrink-0 cursor-grab select-none rounded-lg hover:ring-2 hover:ring-ring/40',
              dragging === app.bundle_id && 'opacity-40',
            )}
          >
            <AppTile
              bundleId={app.bundle_id}
              name={appLabel(app)}
              className="size-8 rounded-lg text-[13px]"
            />
            {/* New: in the default style only because the user hasn't chosen one. */}
            {!app.confirmed && (
              <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-accent ring-2 ring-background" />
            )}
            <span className="sr-only">
              {app.confirmed ? appLabel(app) : `${appLabel(app)}, ${t('captures.apps.new')}`}
            </span>
          </li>
        ))}
        {rest > 0 && (
          <li className="relative z-10">
            <button
              type="button"
              onClick={onShowAll}
              aria-label={t('writingStyle.styles.moreLabel', {
                count: apps.length,
                style: style.name,
              })}
              className="h-8 rounded-lg bg-secondary px-2.5 text-xs text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('writingStyle.styles.more', { count: rest })}
            </button>
          </li>
        )}
        {apps.length === 0 && (
          <li className="text-xs text-muted-foreground/70">{t('writingStyle.styles.empty')}</li>
        )}
      </ul>
    </section>
  );
}

/**
 * A card that names a new style. Enter or leaving it with a name adds it, so
 * clicking "New style" mid-name keeps what was typed; Escape or leaving it
 * empty cancels.
 */
function NewStyleCard({ onDone }: { onDone: (styleId?: string) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const submitted = useRef(false);
  const create = useMutation({
    mutationFn: (value: string) => apiClient.createWritingStyle(value),
    onSuccess: async (style) => {
      await queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
      onDone(style.id);
    },
    onError: (error: Error) => {
      submitted.current = false;
      toast({
        title: t('writingStyle.styles.createFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  const submit = () => {
    if (submitted.current || !name.trim()) return;
    submitted.current = true;
    create.mutate(name.trim());
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-[10px] border border-dashed border-accent/60 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={name}
        maxLength={40}
        placeholder={t('writingStyle.styles.namePlaceholder')}
        aria-label={t('writingStyle.styles.nameLabel')}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            submitted.current = true;
            onDone();
          }
        }}
        onBlur={() => {
          if (submitted.current) return;
          if (name.trim()) submit();
          else onDone();
        }}
        className="h-8 text-[13px]"
      />
      <p className="text-[11.5px] text-muted-foreground">{t('writingStyle.styles.newHint')}</p>
    </form>
  );
}

/**
 * Every app, most dictated first, each with its style. A new app shows its
 * suggested style until the user picks one; "Keep all" confirms every new
 * app in the style it's already using.
 */
export function StyleAppList({
  data,
  filter,
  onFilter,
}: {
  data: WritingStylesResponse;
  filter: AppListFilter;
  onFilter: (filter: AppListFilter) => void;
}) {
  const { t } = useTranslation();
  const mover = useMoveApp();
  const confirmApps = useConfirmApps();
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const fallback = defaultStyle(data);
  const names = new Map(data.styles.map((s) => [s.id, s.name]));
  const fresh = data.apps.filter((app) => !app.confirmed);

  const q = query.trim().toLowerCase();
  const rows = [...data.apps]
    .sort((a, b) => b.count - a.count || appLabel(a).localeCompare(appLabel(b)))
    .filter((app) => {
      if (filter?.kind === 'style' && app.style_id !== filter.styleId) return false;
      if (filter?.kind === 'new' && app.confirmed) return false;
      return !q || appLabel(app).toLowerCase().includes(q);
    });

  const filterLabel =
    filter?.kind === 'style'
      ? t('writingStyle.styles.filterStyle', { style: names.get(filter.styleId) ?? '' })
      : filter?.kind === 'new'
        ? t('writingStyle.styles.filterNew')
        : null;

  return (
    <div className="flex flex-col gap-2.5">
      {fresh.length > 0 && fallback && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2 text-[12.5px]">
          <span className="size-[7px] shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 flex-1">
            {t('writingStyle.styles.newNotice', { count: fresh.length, style: fallback.name })}
          </span>
          <Button size="sm" variant="outline" onClick={() => onFilter({ kind: 'new' })}>
            {t('writingStyle.styles.showNew')}
          </Button>
          <Button
            size="sm"
            className="font-semibold"
            onClick={() => {
              confirmApps.mutate(fresh);
              if (filter?.kind === 'new') onFilter(null);
            }}
          >
            {t('writingStyle.styles.keepAll', { style: fallback.name })}
          </Button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('writingStyle.styles.search')}
            aria-label={t('writingStyle.styles.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {filterLabel && (
          <button
            type="button"
            onClick={() => onFilter(null)}
            aria-label={t('writingStyle.styles.clearFilter')}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-accent/50 bg-accent/[0.08] px-2.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {filterLabel}
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_88px_180px] items-center gap-4 border-b border-border bg-card px-3.5 py-2 font-mono text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{t('writingStyle.styles.colApp')}</span>
          <span className="text-right">{t('writingStyle.styles.colCount')}</span>
          <span>{t('writingStyle.styles.colStyle')}</span>
        </div>
        <ul className="max-h-[340px] overflow-y-auto">
          {rows.map((app) => {
            const suggested = app.suggested_style_id ?? app.style_id;
            return (
              <li
                key={app.bundle_id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TYPE, app.bundle_id);
                  event.dataTransfer.setData('text/plain', appLabel(app));
                  event.dataTransfer.effectAllowed = 'move';
                  // Drag the app's icon, not a picture of the whole row.
                  const icon = event.currentTarget.querySelector('[data-drag-icon]');
                  if (icon) event.dataTransfer.setDragImage(icon, 10, 10);
                  setDragging(app.bundle_id);
                }}
                onDragEnd={() => setDragging(null)}
                className={cn(
                  'grid h-11 cursor-grab grid-cols-[minmax(0,1fr)_88px_180px] items-center gap-4 border-t border-border/60 px-3.5 text-[13.5px] first:border-t-0 hover:bg-card',
                  dragging === app.bundle_id && 'opacity-40',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span data-drag-icon className="shrink-0">
                    <AppTile
                      bundleId={app.bundle_id}
                      name={appLabel(app)}
                      className="size-5 rounded-[5px] text-[10px]"
                    />
                  </span>
                  <span className="truncate">{appLabel(app)}</span>
                  {!app.confirmed && (
                    <span className="shrink-0 rounded border border-accent/40 px-1 text-[10px] font-bold uppercase tracking-wide text-accent">
                      {t('captures.apps.new')}
                    </span>
                  )}
                </span>
                <span className="text-right text-[12.5px] tabular-nums text-muted-foreground">
                  {app.count.toLocaleString()}
                </span>
                <Select
                  value={app.confirmed ? app.style_id : ''}
                  onValueChange={(styleId) => mover.move(app, styleId)}
                >
                  <SelectTrigger
                    aria-label={t('writingStyle.styles.moveTo', { app: appLabel(app) })}
                    className={cn(!app.confirmed && 'border-accent/40 text-accent')}
                  >
                    <SelectValue
                      placeholder={t('writingStyle.styles.suggested', {
                        style: names.get(suggested) ?? fallback?.name ?? '',
                      })}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {data.styles.map((style) => (
                      <SelectItem key={style.id} value={style.id}>
                        {style.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="px-3.5 py-4 text-[12.5px] text-muted-foreground">
              {t('writingStyle.styles.noMatch')}
            </li>
          )}
        </ul>
      </div>
      {mover.dialog}
    </div>
  );
}
