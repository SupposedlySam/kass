import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTile } from '@/components/CapturesTab/CaptureAppList';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { StyledApp, WritingStyle, WritingStylesResponse } from '@/lib/api/types';
import { WRITING_STYLES_KEY } from '@/lib/hooks/useWritingStyle';
import { cn } from '@/lib/utils/cn';
import { useMoveApp } from './MoveAppDialog';

const DRAG_TYPE = 'application/x-voicebox-app';

export function appLabel(app: Pick<StyledApp, 'name' | 'bundle_id'>): string {
  return app.name || app.bundle_id;
}

/** A style's apps, most dictated first. */
export function appsIn(data: WritingStylesResponse | undefined, styleId: string): StyledApp[] {
  return (data?.apps ?? [])
    .filter((app) => app.style_id === styleId)
    .sort((a, b) => b.count - a.count || appLabel(a).localeCompare(appLabel(b)));
}

/**
 * One column per style with the apps assigned to it. Apps are dragged
 * between columns; each app's menu moves it without dragging. Clicking a
 * column selects that style for editing below. An app the user hasn't
 * assigned sits in the default style's column, marked New.
 */
export function StyleBoard({
  data,
  selectedId,
  onSelect,
}: {
  data: WritingStylesResponse;
  selectedId: string;
  onSelect: (styleId: string) => void;
}) {
  const mover = useMoveApp();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const move = (bundleId: string, styleId: string) => {
    const app = data.apps.find((a) => a.bundle_id === bundleId);
    if (app) mover.move(app, styleId);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5">
      {data.styles.map((style) => (
        <StyleColumn
          key={style.id}
          style={style}
          styles={data.styles}
          apps={appsIn(data, style.id)}
          selected={style.id === selectedId}
          over={over === style.id}
          dragging={dragging}
          onSelect={() => onSelect(style.id)}
          onDragState={setDragging}
          onOver={(isOver) =>
            setOver((current) => (isOver ? style.id : current === style.id ? null : current))
          }
          onDrop={(bundleId) => {
            setOver(null);
            setDragging(null);
            move(bundleId, style.id);
          }}
          onMove={move}
        />
      ))}
      <NewStyleColumn
        onCreated={onSelect}
        full={data.styles.length >= data.max_styles}
        max={data.max_styles}
      />
      {mover.dialog}
    </div>
  );
}

function StyleColumn({
  style,
  styles,
  apps,
  selected,
  over,
  dragging,
  onSelect,
  onDragState,
  onOver,
  onDrop,
  onMove,
}: {
  style: WritingStyle;
  styles: WritingStyle[];
  apps: StyledApp[];
  selected: boolean;
  over: boolean;
  dragging: string | null;
  onSelect: () => void;
  onDragState: (bundleId: string | null) => void;
  onOver: (over: boolean) => void;
  onDrop: (bundleId: string) => void;
  onMove: (bundleId: string, styleId: string) => void;
}) {
  const { t } = useTranslation();

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
        'min-h-[200px] flex flex-col gap-2 rounded-[10px] border p-2 transition-colors',
        over
          ? 'border-dashed border-accent bg-accent/[0.08]'
          : selected
            ? 'border-accent/55 bg-accent/[0.04]'
            : 'border-border bg-card/40',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('writingStyle.styles.edit', { style: style.name })}
        onClick={onSelect}
        className="flex flex-col items-start gap-0.5 rounded-md px-1 pt-0.5 pb-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-sm font-semibold">{style.name}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {style.is_default
            ? t('writingStyle.styles.countDefault', { count: apps.length })
            : t('writingStyle.styles.count', { count: apps.length })}
        </span>
      </button>
      <ul className="flex flex-col gap-1.5">
        {apps.map((app) => (
          <li
            key={app.bundle_id}
            draggable
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
              'flex min-w-0 items-center gap-1.5 rounded-lg border border-input bg-popover py-1.5 pr-0.5 pl-1.5 text-[13px] cursor-grab select-none hover:border-ring/40',
              dragging === app.bundle_id && 'opacity-40',
            )}
          >
            <span className="relative shrink-0">
              <AppTile
                bundleId={app.bundle_id}
                name={appLabel(app)}
                className="size-5 rounded-[5px] text-[10px]"
              />
              {/* New: in the default style only because the user hasn't chosen one. */}
              {!app.confirmed && (
                <span
                  role="img"
                  aria-label={t('captures.apps.new')}
                  title={t('captures.apps.new')}
                  className="absolute -top-1 -right-1 size-[7px] rounded-full bg-accent ring-2 ring-popover"
                />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate" title={appLabel(app)}>
              {appLabel(app)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('writingStyle.styles.move', { app: appLabel(app) })}
                className="grid h-6 w-5 shrink-0 place-items-center rounded-[5px] text-muted-foreground/70 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GripVertical className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t('writingStyle.styles.moveTo', { app: appLabel(app) })}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={app.confirmed ? app.style_id : ''}
                  onValueChange={(styleId) => onMove(app.bundle_id, styleId)}
                >
                  {styles.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id}>
                      {option.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The "+ New style" column: a button that becomes a name field. */
function NewStyleColumn({
  onCreated,
  full,
  max,
}: {
  onCreated: (styleId: string) => void;
  /** At the limit: each style keeps a prompt cache, so there are at most `max`. */
  full: boolean;
  max: number;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => apiClient.createWritingStyle(value),
    onSuccess: async (style) => {
      await queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
      setNaming(false);
      setName('');
      onCreated(style.id);
    },
    onError: (error: Error) =>
      toast({
        title: t('writingStyle.styles.createFailed'),
        description: error.message,
        variant: 'destructive',
      }),
  });

  if (!naming || full) {
    return (
      <button
        type="button"
        disabled={full}
        aria-describedby={full ? 'style-limit' : undefined}
        onClick={() => setNaming(true)}
        className="min-h-[200px] flex flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-input px-3 text-center text-[13px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:border-input disabled:hover:text-muted-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Plus className="size-3.5" />
          {t('writingStyle.styles.new')}
        </span>
        {full && (
          <span id="style-limit" className="text-[11.5px] leading-snug">
            {t('writingStyle.styles.limit', { count: max })}
          </span>
        )}
      </button>
    );
  }
  return (
    <form
      className="min-h-[200px] flex flex-col gap-2 rounded-[10px] border border-dashed border-accent/60 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.mutate(name.trim());
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
            setNaming(false);
            setName('');
          }
        }}
        onBlur={() => {
          if (!name.trim() && !create.isPending) setNaming(false);
        }}
        className="h-8 text-[13px]"
      />
      <p className="text-[11.5px] text-muted-foreground">{t('writingStyle.styles.newHint')}</p>
    </form>
  );
}
