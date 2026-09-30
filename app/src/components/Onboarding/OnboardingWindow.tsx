import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useChordSync } from '@/lib/hooks/useChordSync';
import { useDictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { useInAppDictationInsert } from '@/lib/hooks/useInAppDictationInsert';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { defaultChordKeys } from '@/lib/utils/keyCodes';
import {
  clearProgress,
  isLightStep,
  isLocked,
  loadProgress,
  nextStep,
  previousStep,
  type SavedProgress,
  STEP_COLORS,
  type Step,
  saveProgress,
} from './onboardingFlow';
import {
  AccessibilityStep,
  DownloadStep,
  InputMonitoringStep,
  KeysStep,
  MicrophoneStep,
  WelcomeStep,
} from './steps/SetupSteps';
import { DoneStep, LockedStep, MessyStep, NameStep, RewriteStep } from './steps/SpokenSteps';
import { useOnboardingDownloads } from './useOnboardingDownloads';

/**
 * First-run onboarding, in its own window (docs/plans/ONBOARDING.md). Each
 * step fills the window with its own color; the line along the top is the
 * model download, which keeps going through every step.
 */
export function OnboardingWindow() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<SavedProgress>(loadProgress);
  const { settings, update } = useCaptureSettings();
  const readiness = useDictationReadiness();

  const setAndSave = useCallback((next: SavedProgress) => {
    setProgress(next);
    saveProgress(next);
  }, []);
  const go = useCallback((step: Step) => setAndSave({ ...progress, step }), [progress, setAndSave]);
  const next = () => go(nextStep(progress.step));

  const downloads = useOnboardingDownloads(readiness, progress.downloadsStarted, () =>
    setAndSave({ ...progress, downloadsStarted: true }),
  );

  // This window types dictation into its own fields and owns the chord
  // until onboarding is finished.
  useInAppDictationInsert();
  useChordSync();

  // With Input Monitoring granted, the shortcut is turned on for the user
  // instead of being a separate step.
  useEffect(() => {
    if (readiness.inputMonitoring && settings && !settings.hotkey_enabled) {
      update({ hotkey_enabled: true });
    }
  }, [readiness.inputMonitoring, settings, update]);

  // Saved before the window goes: closing it would drop the request.
  const finish = (show: string | null) => {
    clearProgress();
    apiClient
      .updateCaptureSettings({ onboarding_completed: true })
      .catch((err) => console.warn('[onboarding] saving completion failed:', err))
      .finally(() =>
        invoke('finish_onboarding', { show }).catch((err) =>
          console.warn('[onboarding] finish_onboarding failed:', err),
        ),
      );
  };

  const step = progress.step;
  const light = isLightStep(step);
  const fg = light ? '#1D1B19' : '#FFFFFF';
  const pushKeys = settings?.chord_push_to_talk_keys ?? defaultChordKeys('push');
  const locked = isLocked(step, downloads.ready);

  let corner: string | null = null;
  if (progress.downloadsStarted) {
    if (downloads.failed) corner = t('onboarding.corner.stopped');
    else if (downloads.ready) corner = t('onboarding.corner.ready');
    else if (downloads.speech.state !== 'ready')
      corner = t('onboarding.corner.speech', { percent: Math.round(downloads.speech.percent) });
    else if (downloads.cleanup)
      corner = t('onboarding.corner.cleanup', { percent: Math.round(downloads.cleanup.percent) });
  }

  let body: React.ReactNode;
  if (locked) {
    body = (
      <LockedStep downloads={downloads} pushKeys={pushKeys} onShowFailure={() => go('download')} />
    );
  } else {
    switch (step) {
      case 'welcome':
        body = <WelcomeStep onNext={next} />;
        break;
      case 'download':
        body = (
          <DownloadStep downloads={downloads} started={progress.downloadsStarted} onNext={next} />
        );
        break;
      case 'inputMonitoring':
        body = <InputMonitoringStep readiness={readiness} pushKeys={pushKeys} onNext={next} />;
        break;
      case 'accessibility':
        body = <AccessibilityStep readiness={readiness} onNext={next} />;
        break;
      case 'microphone':
        body = <MicrophoneStep onNext={next} />;
        break;
      case 'keys':
        body = <KeysStep readiness={readiness} pushKeys={pushKeys} onNext={next} />;
        break;
      case 'name':
        body = <NameStep pushKeys={pushKeys} onNext={next} />;
        break;
      case 'messy':
        body = <MessyStep pushKeys={pushKeys} onNext={next} />;
        break;
      case 'rewrite':
        body = <RewriteStep settings={settings} onNext={next} />;
        break;
      case 'done':
        body = <DoneStep settings={settings} onFinish={finish} />;
        break;
    }
  }

  const style = {
    '--poster-bg': STEP_COLORS[step],
    '--poster-fg': fg,
    background: STEP_COLORS[step],
    color: fg,
  } as CSSProperties;

  return (
    <div
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden transition-colors duration-300"
      style={style}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 h-[5px] bg-[color-mix(in_srgb,var(--poster-fg)_22%,transparent)]"
        aria-hidden
      >
        <div
          className="h-[5px] transition-[width] duration-300"
          style={{
            width: `${progress.downloadsStarted ? downloads.overall : 0}%`,
            background: downloads.failed ? '#FF9A85' : fg,
          }}
        />
      </div>
      <div data-tauri-drag-region className="flex h-9 shrink-0 items-center justify-end px-4">
        {corner ? (
          downloads.failed && step !== 'download' ? (
            <button
              type="button"
              onClick={() => go('download')}
              className="font-mono text-[11px] font-medium underline"
            >
              {corner}
            </button>
          ) : (
            <span className="font-mono text-[11px] font-medium" aria-live="polite">
              {corner}
            </span>
          )
        ) : null}
      </div>
      <main
        key={step}
        className="flex min-h-0 flex-1 select-text flex-col justify-start gap-4 px-16 pt-10 pb-14"
      >
        {body}
      </main>
      {step !== 'welcome' && step !== 'done' ? (
        <button
          type="button"
          onClick={() => go(previousStep(step))}
          className="absolute bottom-4 left-[60px] inline-flex items-center gap-1 text-[13px] font-medium opacity-60 hover:opacity-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {t('onboarding.back')}
        </button>
      ) : null}
    </div>
  );
}
