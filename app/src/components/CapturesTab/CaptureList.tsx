import { Link } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd } from '@/components/ui/kbd';
import { StyleCalibrationPrompt } from '@/components/WritingStyle/StyleCalibrationPrompt';
import type { CaptureResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { AppIcon } from './AppIcon';
import {
  captureTag,
  deliveredText,
  formatDuration,
  formatRowTime,
  snippetParts,
} from './captureFormat';
import { NewAppPrompt } from './NewAppPrompt';
import type { AppStyles } from './useAppStyles';

function CaptureRow({
  capture,
  active,
  showApp,
  styleLabel,
  prompt,
  onSelect,
}: {
  capture: CaptureResponse;
  active: boolean;
  /** Off in one app's list, where every row is that app. */
  showApp: boolean;
  /** The style the capture was cleaned up with; "Work?" while its app's style is unconfirmed. */
  styleLabel?: string;
  /** The new-app prompt, under the newest capture of an app without a confirmed style. */
  prompt?: ReactNode;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const tag = captureTag(capture);
  const text = deliveredText(capture).trim();
  const parts = text ? snippetParts(text, capture.refinement_review?.added ?? []) : [];
  return (
    <div
      className={cn(
        'rounded-lg transition-colors has-[>button:focus-visible]:bg-muted',
        active ? 'bg-muted' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        data-capture-id={capture.id}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
        className="w-full flex flex-col gap-2 p-3 rounded-lg text-left focus-visible:outline-none"
      >
        <span className="text-[14px] leading-normal text-foreground line-clamp-2 [overflow-wrap:anywhere]">
          {text
            ? parts.map((part, i) =>
                part.changed ? (
                  <mark
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
                    key={i}
                    className="rounded-[2px] px-0.5 bg-warning/10 text-warning border-b-[1.5px] border-dashed border-warning/70"
                  >
                    {part.text}
                  </mark>
                ) : (
                  part.text
                ),
              )
            : t('captures.snippetEmpty')}
        </span>
        <span className="flex items-center gap-[7px] min-w-0 text-[11.5px] text-muted-foreground">
          {showApp && <AppIcon bundleId={capture.app_bundle_id} />}
          {showApp && capture.app_name && (
            <>
              <span className="min-w-0 truncate">{capture.app_name}</span>
              <span className="shrink-0 text-muted-foreground/50">·</span>
            </>
          )}
          <span className="shrink-0 whitespace-nowrap">
            {formatRowTime(capture.created_at, t('captures.list.yesterday'))}
          </span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className="shrink-0 tabular-nums">{formatDuration(capture.duration_ms)}</span>
          <span className="flex-1" />
          {styleLabel && (
            <span className="shrink-0 flex items-center gap-1.5 font-semibold text-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              {styleLabel}
            </span>
          )}
          {tag === 'review' && (
            <span className="shrink-0 flex items-center gap-1.5 font-semibold text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              {t('captures.tag.review')}
            </span>
          )}
          {(tag === 'command' || tag === 'commandFailed') && (
            <span className="shrink-0 flex items-center gap-1.5 font-semibold text-accent">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  tag === 'command' ? 'bg-accent' : 'border-[1.5px] border-accent',
                )}
              />
              {capture.command_transform ??
                t(tag === 'command' ? 'captures.tag.command' : 'captures.tag.commandFailed')}
            </span>
          )}
          {tag === 'raw' && (
            <span className="shrink-0 flex items-center gap-1.5">
              <span className="size-1.5 rounded-full border-[1.5px] border-muted-foreground/70" />
              {t('captures.tag.raw')}
            </span>
          )}
        </span>
      </button>
      {prompt}
    </div>
  );
}

/**
 * The capture list: the last 7 days' card, the selected app's card, search
 * (⌘K hint), the not-set-up banner, the style calibration prompt, and one
 * row per capture.
 * It narrows from 440px to 400px while the app list beside it is open.
 */
export function CaptureList({
  captures,
  visible,
  loading,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  allReady,
  appName,
  summary,
  appHeader,
  appStyles,
  narrow,
}: {
  captures: CaptureResponse[];
  /** The captures left after search, in display order. */
  visible: CaptureResponse[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  allReady: boolean;
  /** The app the list is filtered to, if any. */
  appName?: string;
  /** The last 7 days' card, at the top. */
  summary?: ReactNode;
  /** The filtered app's card, above search. */
  appHeader?: ReactNode;
  appStyles: AppStyles;
  narrow: boolean;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchLabel = appName
    ? t('captures.apps.searchPlaceholder', { app: appName })
    : t('captures.searchPlaceholder');

  const rowStyle = (capture: CaptureResponse) => {
    const used = capture.style_id ? appStyles.byId.get(capture.style_id) : undefined;
    if (!used) return undefined;
    return appStyles.forApp(capture.app_bundle_id)?.confirmed ? used.name : `${used.name}?`;
  };
  // One prompt per app without a confirmed style, under its newest capture.
  const prompted = useMemo(() => {
    const prompts = new Map<string, ReactNode>();
    const seen = new Set<string>();
    for (const capture of visible) {
      const bundleId = capture.app_bundle_id;
      if (!bundleId || capture.source === 'command' || seen.has(bundleId)) continue;
      seen.add(bundleId);
      const current = appStyles.forApp(bundleId);
      if (!current || current.confirmed) continue;
      prompts.set(
        capture.id,
        <NewAppPrompt
          bundleId={bundleId}
          name={capture.app_name || bundleId}
          suggested={current.suggested}
          styles={appStyles.styles}
        />,
      );
    }
    return prompts;
  }, [visible, appStyles]);

  // Keep the selected row in view as the arrow keys move through the list.
  useEffect(() => {
    if (!selectedId) return;
    scrollRef.current
      ?.querySelector(`[data-capture-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <section
      aria-label={appName ? t('captures.apps.listLabel', { app: appName }) : t('captures.title')}
      className={cn(
        'shrink-0 flex flex-col border-r border-border',
        narrow ? 'w-[400px]' : 'w-[440px]',
      )}
    >
      <div className="flex flex-col gap-2 p-4 border-b border-border">
        {summary}
        {appHeader}
        <label className="flex items-center gap-2.5 h-10 px-3 rounded-lg border border-input bg-popover focus-within:border-ring">
          <Search className="h-[15px] w-[15px] shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          <Kbd>⌘K</Kbd>
        </label>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        {!allReady && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-warning/10 text-[13px]">
            <span>{t('captures.notReady.title')}</span>
            <Link
              to="/setup"
              className="shrink-0 text-accent hover:underline focus-visible:outline-none focus-visible:underline"
            >
              {t('captures.notReady.action')}
            </Link>
          </div>
        )}
        {/* The prompt brings its own mx-1 mb-3, which completes the 16px inset. */}
        <div className="px-3 pt-4 pb-1 border-b border-border empty:hidden">
          <StyleCalibrationPrompt hasCaptures={captures.length > 0} />
        </div>
        {loading ? (
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-label={t('captures.empty.loading')} />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">
            {search.trim()
              ? t('captures.empty.noMatches', { query: search })
              : captures.length
                ? t('captures.empty.noneInFilter')
                : t('captures.empty.none')}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {visible.map((capture) => (
              <CaptureRow
                key={capture.id}
                capture={capture}
                active={capture.id === selectedId}
                showApp={!appName}
                styleLabel={rowStyle(capture)}
                prompt={prompted.get(capture.id)}
                onSelect={() => onSelect(capture.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
