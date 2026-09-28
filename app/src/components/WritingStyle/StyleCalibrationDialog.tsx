import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type {
  WritingStyle,
  WritingStyleCalibrationResult,
  WritingStyleCalibrationStep,
} from '@/lib/api/types';
import {
  defaultStyle,
  useWritingStyles,
  WRITING_STYLE_KEY,
  WRITING_STYLES_KEY,
} from '@/lib/hooks/useWritingStyle';
import { CalibrationStepView } from './CalibrationStepView';
import { CalibrationSummary } from './CalibrationSummary';
import { PERSONAL_EXAMPLES_KEY } from './PersonalExamples';

/** What calibration learns from; each has a line on the start screen. */
const CALIBRATION_CHANGES = ['falseStarts', 'order', 'grammar', 'punctuation'] as const;

type Stage =
  | { kind: 'intro' }
  | { kind: 'step'; step: WritingStyleCalibrationStep }
  | { kind: 'summary'; changes: number[]; result: WritingStyleCalibrationResult };

/**
 * Five paragraphs, one at a time: the user rewrites each the way they would
 * type it, and the next arrives already styled with what Voicebox learned.
 * It teaches `style`, or the default style.
 */
export function StyleCalibrationDialog({
  open,
  onOpenChange,
  style: given,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  style?: WritingStyle;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const styles = useWritingStyles();
  const style = given ?? defaultStyle(styles.data);
  const [stage, setStage] = useState<Stage>({ kind: 'intro' });
  const [draft, setDraft] = useState('');
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (open) setStage({ kind: 'intro' });
  }, [open]);

  const fail = (error: Error) =>
    toast({
      title: t('writingStyle.calibration.failed'),
      description: error.message,
      variant: 'destructive',
    });

  const matchWriting = useMutation({
    mutationFn: (styleId: string) =>
      apiClient.updateWritingStyle(styleId, { punctuation_style: 'learned' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY }),
    onError: fail,
  });

  const showStep = (step: WritingStyleCalibrationStep) => {
    sessionRef.current = step.session_id;
    setDraft(step.paragraph ?? '');
    setStage({ kind: 'step', step });
  };

  const start = useMutation({
    mutationFn: () => apiClient.startStyleCalibration(style?.id),
    onSuccess: showStep,
    onError: fail,
  });

  const finish = useMutation({
    mutationFn: (sessionId: string) => apiClient.finishStyleCalibration(sessionId),
    onError: fail,
  });

  const submit = useMutation({
    mutationFn: ({ sessionId, written }: { sessionId: string; written: string }) =>
      apiClient.submitStyleCalibrationStep(sessionId, written),
    onSuccess: async (step) => {
      if (!step.done) {
        showStep(step);
        return;
      }
      const result = await finish.mutateAsync(step.session_id);
      sessionRef.current = null;
      queryClient.setQueryData([...WRITING_STYLE_KEY, style?.id ?? 'default'], result.status);
      queryClient.invalidateQueries({ queryKey: WRITING_STYLE_KEY });
      queryClient.invalidateQueries({ queryKey: PERSONAL_EXAMPLES_KEY });
      setStage({ kind: 'summary', changes: step.changes, result });
    },
    onError: fail,
  });

  const close = () => {
    // Leaving midway keeps nothing from this run.
    if (sessionRef.current) {
      void apiClient.discardStyleCalibration(sessionRef.current).catch(() => undefined);
      sessionRef.current = null;
    }
    onOpenChange(false);
  };

  const busy = start.isPending || submit.isPending || finish.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        className={
          stage.kind === 'step'
            ? 'gap-0 p-0 sm:max-w-[760px]'
            : 'max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-[660px]'
        }
      >
        {stage.kind === 'intro' && (
          <>
            <div className="space-y-2 border-b border-border px-7 pt-6 pb-[18px]">
              <DialogTitle className="text-lg">{t('writingStyle.calibration.title')}</DialogTitle>
              <DialogDescription className="text-[13px] leading-normal">
                {t('writingStyle.calibration.intro')}
              </DialogDescription>
            </div>
            <div className="space-y-2 px-7 py-5 text-[13px]">
              <p className="font-mono text-[11px] uppercase text-muted-foreground">
                {t('writingStyle.calibration.changesTitle')}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-foreground/85">
                {CALIBRATION_CHANGES.map((change) => (
                  <li key={change}>{t(`writingStyle.calibration.changes.${change}`)}</li>
                ))}
              </ul>
              <p className="pt-1 text-xs text-muted-foreground">
                {t('writingStyle.calibration.wordsNote')}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-7 py-4">
              <Button variant="ghost" className="text-muted-foreground" onClick={close}>
                {t('writingStyle.calibration.notNow')}
              </Button>
              <Button className="font-semibold" onClick={() => start.mutate()} disabled={busy}>
                {start.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('writingStyle.calibration.start')}
              </Button>
            </div>
          </>
        )}

        {stage.kind === 'step' && (
          <CalibrationStepView
            step={stage.step}
            draft={draft}
            onDraftChange={setDraft}
            busy={busy}
            submitting={submit.isPending}
            onSubmit={(written) => submit.mutate({ sessionId: stage.step.session_id, written })}
          />
        )}

        {stage.kind === 'summary' && (
          <CalibrationSummary
            changes={stage.changes}
            result={stage.result}
            learnedStyleOn={style?.punctuation_style === 'learned'}
            restarting={start.isPending}
            onRunAgain={() => start.mutate()}
            onUseLearned={() => {
              if (style) matchWriting.mutate(style.id);
              close();
            }}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
