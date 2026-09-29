import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaptureResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { useUIStore } from '@/stores/uiStore';
import { formatDuration } from './captureFormat';
import { CopyButton } from './TranscriptCard';

function Heading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-[11px] uppercase tracking-wider', className)}>
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  );
}

/**
 * A Command Mode capture (docs/plans/COMMAND_MODE.md): the rewrite that
 * replaced the selection, what was asked, and the original selection with a
 * copy button, so a bad rewrite can be put back in any app.
 */
export function CommandDetail({ capture }: { capture: CaptureResponse }) {
  const { t } = useTranslation();
  const result = capture.transcript_refined ?? null;
  const original = capture.command_selection ?? '';
  const said = capture.transcript_raw.trim();
  const instruction = capture.command_instruction ?? said;
  const detailsOpen = useUIStore((s) => s.capturesDetailsOpen);

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col gap-3 px-6 pt-6 pb-3">
        <section
          aria-label={t('captures.command.result')}
          className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/[0.045] px-5 pt-4 pb-6"
        >
          <div className="flex items-center gap-2">
            <Heading className="text-accent">{t('captures.command.result')}</Heading>
            <span className="flex-1" />
            {result && <CopyButton text={result} label={t('captures.command.copyResult')} />}
          </div>
          {result ? (
            <p className="m-0 whitespace-pre-wrap break-words text-base leading-[1.6] font-medium">
              {result}
            </p>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">{t('captures.command.failed')}</p>
          )}
        </section>

        <section className="flex flex-col gap-1.5 rounded-xl border border-border px-5 py-4">
          <Heading className="text-muted-foreground">
            {capture.command_transform
              ? `${t('captures.command.transform')} · ${capture.command_transform}`
              : t('captures.command.instruction')}
          </Heading>
          <p className="m-0 whitespace-pre-wrap break-words text-sm leading-normal">
            {instruction || '∅'}
          </p>
          {capture.command_transform && said && (
            <p className="m-0 text-xs text-muted-foreground">
              {t('captures.command.said')}: “{said}”
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Heading className="text-muted-foreground">{t('captures.command.original')}</Heading>
            <span className="flex-1" />
            {original && <CopyButton text={original} label={t('captures.command.copyOriginal')} />}
          </div>
          <p className="m-0 whitespace-pre-wrap break-words text-sm leading-normal text-muted-foreground">
            {original || '∅'}
          </p>
          <p className="m-0 text-xs text-muted-foreground/80">{t('captures.command.undoHint')}</p>
        </section>
      </div>
      {detailsOpen && (
        <aside className="w-[250px] shrink-0 flex flex-col border-l border-border bg-card">
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 px-5 py-6">
            {capture.duration_ms != null && (
              <Row
                label={t('captures.inspector.length')}
                value={formatDuration(capture.duration_ms)}
              />
            )}
            {capture.stt_model && (
              <Row
                label={t('captures.inspector.speech')}
                value={t('captures.inspector.whisper', { model: capture.stt_model })}
              />
            )}
            {capture.llm_model && (
              <Row
                label={t('captures.command.rewriting')}
                value={t('captures.inspector.qwen', { model: capture.llm_model })}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
