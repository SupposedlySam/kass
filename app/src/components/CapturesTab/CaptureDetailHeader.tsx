import { Link } from '@tanstack/react-router';
import { PanelRightClose, PanelRightOpen, Settings2 } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import type { CaptureResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';
import { AppIcon } from './AppIcon';
import { CaptureDeleteButton } from './CaptureDeleteButton';
import { CaptureInlinePlayer } from './CaptureInlinePlayer';
import { formatDetailStamp, isInOverlay } from './captureFormat';

/**
 * The capture's recording: a player, or a note that it was deleted
 * automatically. A command run from ⌘K never had a recording and shows nothing.
 */
function CaptureRecording({ capture }: { capture: CaptureResponse }) {
  const { t } = useTranslation();

  if (!capture.audio_path) {
    return capture.audio_deleted ? (
      <p className="shrink-0 text-xs text-muted-foreground">{t('captures.detail.audioDeleted')}</p>
    ) : null;
  }
  return (
    <CaptureInlinePlayer
      audioUrl={apiClient.getCaptureAudioUrl(capture.id)}
      fallbackDurationMs={capture.duration_ms}
      className="w-60 shrink-0"
    />
  );
}

/**
 * Shows or hides the capture's details, and ⌘I does the same from anywhere
 * on the screen but an open overlay. Whether they're open is remembered.
 */
function DetailsToggle() {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.capturesDetailsOpen);
  const setOpen = useUIStore((s) => s.setCapturesDetailsOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.metaKey) return;
      if (event.altKey || event.ctrlKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'i' || isInOverlay(event.target)) return;
      event.preventDefault();
      const { capturesDetailsOpen, setCapturesDetailsOpen } = useUIStore.getState();
      setCapturesDetailsOpen(!capturesDetailsOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const Icon = open ? PanelRightClose : PanelRightOpen;
  const label = t(open ? 'captures.details.hide' : 'captures.details.show');
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        open
          ? 'bg-muted text-accent hover:text-accent'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={label}
      aria-expanded={open}
      title={`${label} ⌘I`}
      onClick={() => setOpen(!open)}
    >
      <Icon strokeWidth={1.7} />
    </Button>
  );
}

/**
 * The detail pane's header: the app the capture went to and when, its audio,
 * and a link to the settings of the style its app uses (Command Mode's, for
 * a command), Delete, and the button that shows the capture's details.
 */
export function CaptureDetailHeader({
  capture,
  styleId,
}: {
  capture: CaptureResponse | null;
  /** The style the capture's app uses now. */
  styleId?: string;
}) {
  const { t } = useTranslation();

  return (
    <header className="h-16 shrink-0 flex items-center gap-3 pl-6 pr-3 border-b border-border">
      {capture ? (
        <>
          <AppIcon bundleId={capture.app_bundle_id} className="size-6" />
          <div className="flex-1 min-w-0 flex flex-col">
            <p className="truncate text-sm font-semibold">
              {capture.app_name || t(`captures.source.${capture.source}`)}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {formatDetailStamp(capture.created_at, {
                today: t('captures.detail.today'),
                yesterday: t('captures.detail.yesterday'),
              })}
            </p>
          </div>
          <CaptureRecording capture={capture} />
        </>
      ) : (
        <span className="flex-1" />
      )}
      <Button variant="ghost" size="icon" asChild>
        {capture?.source === 'command' ? (
          <Link to="/settings/command-mode" aria-label={t('captures.actions.configureCommand')}>
            <Settings2 />
          </Link>
        ) : (
          <Link
            to="/settings/writing-style"
            search={styleId ? { style: styleId } : {}}
            aria-label={t('captures.actions.configure')}
          >
            <Settings2 />
          </Link>
        )}
      </Button>
      {capture && (
        <>
          <CaptureDeleteButton key={capture.id} capture={capture} />
          <DetailsToggle />
        </>
      )}
    </header>
  );
}
