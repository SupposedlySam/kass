import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadPercent, useModelDownloads } from '@/components/ServerSettings/useModelDownloads';
import { READ_ALOUD_MODEL } from '@/components/Settings/ReadAloudPage';
import { apiClient } from '@/lib/api/client';
import type { CaptureSettings } from '@/lib/api/types';
import {
  Actions,
  Headline,
  Keycaps,
  Lead,
  Panel,
  PosterButton,
  ProgressBar,
  StatusLine,
} from '../Poster';

/**
 * Read Aloud (docs/plans/READ_ALOUD.md), offered but optional: its voice is a
 * separate download, so the user can get it now, or skip and get it later in
 * Settings. Once it's here, a sample is read aloud. The chord can't show it
 * off, since Read Aloud doesn't read Kass's own windows.
 */
export function ReadAloudStep({
  settings,
  onNext,
}: {
  settings: CaptureSettings | undefined;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { data: modelStatus } = useQuery({
    queryKey: ['modelStatus'],
    queryFn: () => apiClient.getModelStatus(),
    refetchInterval: 2000,
  });
  const downloads = useModelDownloads(modelStatus?.models);
  const model = modelStatus?.models.find((m) => m.model_name === READ_ALOUD_MODEL);
  const state = model ? downloads.stateOf(model) : undefined;
  const speakKeys = settings?.chord_speak_keys ?? [];

  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => player.current?.pause(), []);

  const listen = async () => {
    setPlaying(true);
    setError(null);
    try {
      const audio = await apiClient.speak(t('onboarding.readAloud.sample'));
      player.current?.pause();
      const url = URL.createObjectURL(audio);
      const element = new Audio(url);
      player.current = element;
      element.onended = () => {
        URL.revokeObjectURL(url);
        setPlaying(false);
      };
      await element.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPlaying(false);
    }
  };

  if (model?.downloaded) {
    return (
      <>
        <Headline size="md">{t('onboarding.readAloud.title')}</Headline>
        <Lead>{t('onboarding.readAloud.readyBody')}</Lead>
        <Panel>
          <p className="m-0 text-[15px] leading-relaxed">{t('onboarding.readAloud.sample')}</p>
        </Panel>
        {speakKeys.length > 0 && (
          <div className="flex items-center gap-3">
            <Keycaps keys={speakKeys} />
            <span className="text-[14px] opacity-85">{t('onboarding.readAloud.chord')}</span>
          </div>
        )}
        <StatusLine>{error}</StatusLine>
        <Actions>
          <PosterButton onClick={listen} disabled={playing} autoFocus>
            {playing ? t('onboarding.readAloud.playing') : t('onboarding.readAloud.listen')}
          </PosterButton>
          <PosterButton kind="outline" onClick={onNext}>
            {t('onboarding.next')}
          </PosterButton>
        </Actions>
      </>
    );
  }

  const percent = downloadPercent(state?.progress);
  let status: string | null = null;
  if (state?.hasError) status = state.error?.error ?? t('onboarding.readAloud.failed');
  else if (state?.isDownloading)
    status =
      percent === null
        ? t('onboarding.readAloud.starting')
        : t('onboarding.readAloud.downloading', { percent: Math.round(percent) });

  return (
    <>
      <Headline size="md">{t('onboarding.readAloud.title')}</Headline>
      <Lead>{t('onboarding.readAloud.body', { size: Math.round(model?.size_mb ?? 345) })}</Lead>
      {state?.isDownloading && <ProgressBar percent={percent ?? 0} />}
      <StatusLine>{status}</StatusLine>
      <Actions>
        {state?.isDownloading ? (
          <PosterButton onClick={onNext} autoFocus>
            {t('onboarding.readAloud.continue')}
          </PosterButton>
        ) : (
          <>
            <PosterButton
              onClick={() => downloads.download(READ_ALOUD_MODEL)}
              disabled={!model}
              autoFocus
            >
              {state?.hasError
                ? t('onboarding.readAloud.retry')
                : t('onboarding.readAloud.download')}
            </PosterButton>
            <PosterButton kind="ghost" onClick={onNext}>
              {t('onboarding.skipForNow')}
            </PosterButton>
          </>
        )}
      </Actions>
    </>
  );
}
