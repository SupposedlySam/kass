import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api/client';
import type { CorrectionLearningStatus } from '@/lib/api/types';

const V = 'settings.captures.voiceTraining';
const queryKey = ['correction-learning'];

/**
 * Voice training (beta): the background sounds download, the takes Kass keeps
 * to train on, and the trained voice model with Train now and Undo.
 */
export function VoiceTrainingSection({ sttModel }: { sttModel: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey,
    queryFn: () => apiClient.correctionLearningStatus(),
    refetchInterval: (query) =>
      query.state.data?.model?.running ||
      query.state.data?.model?.voice?.sounds?.state === 'downloading'
        ? 2000
        : 60_000,
  });
  const set = (data: CorrectionLearningStatus) => queryClient.setQueryData(queryKey, data);
  const download = useMutation({
    mutationFn: () => apiClient.downloadVoiceSounds(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  const train = useMutation({
    mutationFn: () => apiClient.runCorrectionLearning(),
    onSuccess: set,
  });
  const undo = useMutation({
    mutationFn: () => apiClient.rollbackCorrectionLearning(),
    onSuccess: set,
  });

  const model = status.data?.model;
  const voice = model?.voice;
  if (!voice?.enabled) return null;
  const sounds = voice.sounds;
  const bank = voice.bank;
  const metrics = voice.metrics;
  const collecting = !bank || bank.train < voice.min_train || bank.test < voice.min_test;
  // Takes are split 85/15 into training and test takes, by id.
  const needed = Math.ceil(Math.max(voice.min_train / 0.85, voice.min_test / 0.15));

  return (
    <SettingSection title={t(`${V}.title`)} description={t(`${V}.description`)}>
      {sttModel !== 'turbo' && (
        <p className="py-3 text-xs text-muted-foreground">{t(`${V}.needsTurbo`)}</p>
      )}

      <SettingRow
        title={t(`${V}.sounds.title`)}
        description={sounds?.error ?? t(`${V}.sounds.description`)}
        action={
          sounds?.state === 'ready' ? (
            <span className="text-[13px] text-muted-foreground">{t(`${V}.sounds.ready`)}</span>
          ) : sounds?.state === 'downloading' ? (
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {t(`${V}.sounds.downloading`, { percent: Math.round(sounds.fraction * 100) })}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={download.isPending}
              onClick={() => download.mutate()}
            >
              {t(sounds?.state === 'failed' ? `${V}.sounds.retry` : `${V}.sounds.download`)}
            </Button>
          )
        }
      />

      <SettingRow
        title={t(`${V}.takes.title`)}
        description={t(`${V}.takes.description`)}
        action={
          <span className="text-[13px] tabular-nums text-muted-foreground">
            {collecting
              ? t(`${V}.takes.collecting`, {
                  count: bank?.takes ?? 0,
                  needed: Math.max(needed, (bank?.takes ?? 0) + 1),
                })
              : t(`${V}.takes.kept`, { count: bank?.takes ?? 0, minutes: bank?.minutes ?? 0 })}
          </span>
        }
      />

      <SettingRow
        title={t(`${V}.model.title`)}
        description={
          <>
            {voice.active
              ? t(`${V}.model.active`, {
                  date: voice.active_since ? new Date(voice.active_since).toLocaleDateString() : '',
                })
              : t(`${V}.model.plain`)}
            {metrics?.candidate && (
              <>
                <br />
                {t(metrics.passed ? `${V}.model.lastPassed` : `${V}.model.lastKept`, {
                  before: metrics.production?.noisy ?? 0,
                  after: metrics.candidate.noisy,
                })}
                {!metrics.passed && metrics.reasons[0] ? ` ${metrics.reasons[0]}.` : ''}
              </>
            )}
            {model?.error && (
              <>
                <br />
                <span className="text-destructive">{model.error}</span>
              </>
            )}
          </>
        }
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={train.isPending || model?.running}
              onClick={() => train.mutate()}
            >
              {t(model?.running ? `${V}.model.training` : `${V}.model.train`)}
            </Button>
            {voice.can_undo && (
              <Button
                size="sm"
                variant="ghost"
                disabled={undo.isPending}
                onClick={() => undo.mutate()}
              >
                {t(`${V}.model.undo`)}
              </Button>
            )}
          </div>
        }
      />
    </SettingSection>
  );
}
