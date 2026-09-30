import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { inputDevicePickerValue, useNativeInputDevices } from '@/lib/hooks/useNativeInputDevices';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { useHeldChord, useLaunchAtLogin, useMicPreview } from '../onboardingHooks';
import {
  Actions,
  DISPLAY_FONT,
  Headline,
  Keycaps,
  Lead,
  Panel,
  PosterButton,
  ProgressBar,
  SuccessCard,
} from '../Poster';
import { Confetti } from '../PosterMotion';
import type { ModelProgress, OnboardingDownloads } from '../useOnboardingDownloads';

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  // The filler is struck out after the line lands, the way Herga cleans it.
  return (
    <>
      <Headline size="md">{t('onboarding.welcome.title')}</Headline>
      <p className={`${DISPLAY_FONT} m-0 text-[50px] font-bold leading-[1.08] tracking-[-0.03em]`}>
        <span className="poster-strike" style={{ animationDelay: '900ms' }}>
          {t('onboarding.welcome.fillerA')}
        </span>{' '}
        {t('onboarding.welcome.keptA')}{' '}
        <span className="poster-strike" style={{ animationDelay: '1250ms' }}>
          {t('onboarding.welcome.fillerB')}
        </span>{' '}
        {t('onboarding.welcome.keptB')}
      </p>
      <Lead>{t('onboarding.welcome.body')}</Lead>
      <Actions>
        <PosterButton onClick={onNext} autoFocus>
          {t('onboarding.welcome.start')}
        </PosterButton>
      </Actions>
    </>
  );
}

function sizeLabel(mb: number | null | undefined): string {
  if (!mb) return '';
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

function ModelRow({
  label,
  role,
  progress,
}: {
  label: string;
  role: string;
  progress: ModelProgress;
}) {
  const { t } = useTranslation();
  const status =
    progress.state === 'ready'
      ? t('onboarding.download.ready')
      : progress.state === 'failed'
        ? t('onboarding.download.stopped')
        : progress.state === 'downloading'
          ? `${Math.round(progress.percent)}%`
          : progress.state === 'next'
            ? t('onboarding.download.next')
            : t('onboarding.download.waiting');
  const size = sizeLabel(progress.model?.size_mb);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {label}{' '}
          <span className="font-normal opacity-75">
            · {role}
            {size ? ` · ${size}` : ''}
          </span>
        </span>
        <span className="font-mono text-xs">{status}</span>
      </div>
      <ProgressBar
        percent={progress.percent}
        tone={progress.state === 'failed' ? 'fail' : undefined}
      />
    </div>
  );
}

export function DownloadStep({
  downloads,
  started,
  onNext,
}: {
  downloads: OnboardingDownloads;
  started: boolean;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { failed } = downloads;
  if (failed) {
    return (
      <>
        <Headline>{t('onboarding.failed.title')}</Headline>
        <Lead>
          {t('onboarding.failed.body', {
            model: failed.model?.display_name ?? '',
            percent: Math.round(failed.percent),
          })}
        </Lead>
        <div className="max-w-[560px]">
          <ProgressBar percent={failed.percent} tone="fail" />
        </div>
        {failed.error ? (
          <details className="max-w-[560px] text-[13px]">
            <summary className="cursor-pointer underline">{t('onboarding.failed.details')}</summary>
            <p className="mt-2 line-clamp-3 font-mono text-xs opacity-80" title={failed.error}>
              {failed.error}
            </p>
          </details>
        ) : null}
        <Actions>
          <PosterButton
            onClick={downloads.retry}
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
          >
            {t('onboarding.failed.retry')}
          </PosterButton>
          {failed === downloads.speech ? (
            <PosterButton kind="outline" onClick={downloads.useSmallerSpeechModel}>
              {t('onboarding.failed.smaller')}
            </PosterButton>
          ) : null}
        </Actions>
      </>
    );
  }
  return (
    <>
      <Headline>{t('onboarding.download.title')}</Headline>
      <Lead>{t('onboarding.download.body')}</Lead>
      <div className="flex max-w-[640px] flex-col gap-4">
        <ModelRow
          label={t('onboarding.download.speech')}
          role={t('onboarding.download.speechRole')}
          progress={downloads.speech}
        />
        {downloads.cleanup ? (
          <ModelRow
            label={t('onboarding.download.cleanup')}
            role={t('onboarding.download.cleanupRole')}
            progress={downloads.cleanup}
          />
        ) : null}
      </div>
      {downloads.diskShortMb > 0 ? (
        <Panel>
          <span className="font-medium">{t('onboarding.download.diskTitle')}</span>
          <span className="text-[13px] opacity-85">
            {t('onboarding.download.diskBody', { size: sizeLabel(downloads.diskShortMb) })}
          </span>
        </Panel>
      ) : null}
      <Actions>
        {downloads.diskShortMb > 0 ? (
          <PosterButton onClick={downloads.checkDiskAgain}>
            {t('onboarding.download.checkAgain')}
          </PosterButton>
        ) : started || downloads.ready ? (
          <PosterButton onClick={onNext} autoFocus>
            {downloads.ready ? t('onboarding.next') : t('onboarding.download.continue')}
          </PosterButton>
        ) : (
          <PosterButton onClick={downloads.start} autoFocus>
            {t('onboarding.download.start')}
          </PosterButton>
        )}
      </Actions>
    </>
  );
}

/**
 * Input Monitoring. macOS makes the user quit Herga before it applies,
 * so the step says so first; onboarding reopens here afterward, where a
 * green card and "Try it now" pick up.
 */
export function InputMonitoringStep({
  readiness,
  pushKeys,
  onNext,
}: {
  readiness: DictationReadiness;
  pushKeys: string[];
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [trying, setTrying] = useState(false);
  const { held, pressedOnce } = useHeldChord(trying);
  const granted = readiness.inputMonitoring;
  return (
    <>
      <Headline>{t('onboarding.inputMonitoring.title')}</Headline>
      <Lead>{t('onboarding.inputMonitoring.body')}</Lead>
      {granted ? (
        <>
          <SuccessCard
            title={t('onboarding.inputMonitoring.onTitle')}
            detail={t('onboarding.inputMonitoring.onDetail')}
          />
          {!trying ? (
            <Actions>
              <PosterButton kind="success" onClick={() => setTrying(true)} autoFocus>
                {t('onboarding.tryItNow')}
              </PosterButton>
              <PosterButton kind="ghost" onClick={onNext}>
                {t('onboarding.next')}
              </PosterButton>
            </Actions>
          ) : pressedOnce ? (
            <>
              <p className={`${DISPLAY_FONT} poster-pop m-0 text-[26px] font-bold text-[#7BE39A]`}>
                {t('onboarding.inputMonitoring.itWorks')}
              </p>
              <Confetti at={{ x: 0.2, y: 0.62 }} />
              <Actions>
                <PosterButton onClick={onNext} autoFocus>
                  {t('onboarding.next')}
                </PosterButton>
              </Actions>
            </>
          ) : (
            <div className="mt-1 flex items-center gap-3.5">
              <span className="text-[15px]">{t('onboarding.hold')}</span>
              <Keycaps keys={pushKeys} down={held !== null} size="md" tone="success" />
              <span className="text-[13px] opacity-80">
                {t('onboarding.inputMonitoring.holdHint')}
              </span>
            </div>
          )}
        </>
      ) : (
        <>
          <Panel className="flex-row items-start gap-3">
            <RotateCcw className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              <span className="font-medium">{t('onboarding.inputMonitoring.quitTitle')}</span>
              <span className="text-[13px] leading-snug opacity-80">
                {t('onboarding.inputMonitoring.quitBody')}
              </span>
            </div>
          </Panel>
          <Actions>
            <PosterButton onClick={() => void readiness.openInputMonitoringSettings()} autoFocus>
              {t('onboarding.openSettings')}
            </PosterButton>
            <PosterButton kind="ghost" onClick={onNext}>
              {t('onboarding.skipForNow')}
            </PosterButton>
          </Actions>
        </>
      )}
    </>
  );
}

export function AccessibilityStep({
  readiness,
  onNext,
}: {
  readiness: DictationReadiness;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Headline>{t('onboarding.accessibility.title')}</Headline>
      <Lead>{t('onboarding.accessibility.body')}</Lead>
      {readiness.accessibility ? (
        <>
          <SuccessCard
            title={t('onboarding.accessibility.onTitle')}
            detail={t('onboarding.accessibility.onDetail')}
          />
          <Actions>
            <PosterButton onClick={onNext} autoFocus>
              {t('onboarding.next')}
            </PosterButton>
          </Actions>
        </>
      ) : (
        <Actions>
          <PosterButton onClick={() => void readiness.openAccessibilitySettings()} autoFocus>
            {t('onboarding.openSettings')}
          </PosterButton>
          <PosterButton kind="ghost" onClick={onNext}>
            {t('onboarding.skipForNow')}
          </PosterButton>
        </Actions>
      )}
    </>
  );
}

/** Each level bar's id and height at full loudness, fixed so the meter has a shape. */
const LEVEL_BARS = Array.from({ length: 30 }, (_, i) => ({
  id: `bar-${i}`,
  shape: 0.35 + 0.65 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.31)),
  at: i / 30,
}));

/** Level bars for a dBFS reading: quiet rooms sit near -60, speech near -20. */
function LevelMeter({ db }: { db: number }) {
  const level = Math.max(0, Math.min(1, (db + 60) / 50));
  return (
    <div className="flex h-16 items-center gap-[5px]" aria-hidden>
      {LEVEL_BARS.map((bar) => (
        <span
          key={bar.id}
          className="w-[7px] rounded bg-[var(--poster-fg)] transition-[height,opacity] duration-100"
          style={{
            height: `${Math.max(6, bar.shape * level * 60)}px`,
            opacity: bar.at < level ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}

export function MicrophoneStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  const { settings, update } = useCaptureSettings();
  const deviceId = settings?.input_device_id ?? null;
  const mic = useMicPreview(deviceId);
  const { devices } = useNativeInputDevices(mic.permission === 'granted');

  // Macs that already allowed the microphone go straight to the meter.
  useEffect(() => {
    if (mic.permission === 'granted' && !mic.previewing) mic.start();
  }, [mic.permission, mic.previewing, mic.start]);

  const denied = mic.permission === 'denied' || mic.permission === 'restricted';
  return (
    <>
      <Headline>{t('onboarding.microphone.title')}</Headline>
      {denied ? (
        <>
          <Lead>{t('onboarding.microphone.deniedBody')}</Lead>
          <Panel>
            <span className="font-mono text-xs opacity-85">{t('onboarding.microphone.path')}</span>
          </Panel>
          <Actions>
            <PosterButton onClick={mic.recheck}>
              {t('onboarding.microphone.checkAgain')}
            </PosterButton>
            <PosterButton kind="ghost" onClick={onNext}>
              {t('onboarding.skipForNow')}
            </PosterButton>
          </Actions>
        </>
      ) : mic.previewing && mic.permission === 'granted' ? (
        <>
          <Lead>{t('onboarding.microphone.body')}</Lead>
          <LevelMeter db={mic.db} />
          {mic.error ? (
            <p className="m-0 line-clamp-2 text-[13px]" title={mic.error}>
              {mic.error}
            </p>
          ) : null}
          <label
            htmlFor="onboarding-mic"
            className="flex max-w-[520px] items-center gap-3 text-[13px]"
          >
            <span className="opacity-80">{t('onboarding.microphone.pick')}</span>
            <select
              id="onboarding-mic"
              value={inputDevicePickerValue(deviceId, devices)}
              onChange={(e) =>
                update({ input_device_id: e.target.value === 'default' ? null : e.target.value })
              }
              className="h-10 flex-1 rounded-[10px] border border-white/40 bg-white/12 px-3 text-sm text-[var(--poster-fg)]"
            >
              <option value="default">{t('onboarding.microphone.systemDefault')}</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <Actions>
            <PosterButton onClick={onNext} autoFocus>
              {t('onboarding.microphone.soundsGood')}
            </PosterButton>
          </Actions>
        </>
      ) : (
        <>
          <Lead>{t('onboarding.microphone.askBody')}</Lead>
          <Actions>
            <PosterButton onClick={mic.start} autoFocus>
              {t('onboarding.microphone.allow')}
            </PosterButton>
          </Actions>
        </>
      )}
    </>
  );
}

// How long the keys show as held before the name step opens (the take keeps recording).
const KEYS_TO_NAME_MS = 600;

export function KeysStep({
  readiness,
  pushKeys,
  modelsReady,
  onNext,
}: {
  readiness: DictationReadiness;
  pushKeys: string[];
  /** Whether a take can be transcribed yet. */
  modelsReady: boolean;
  /** `holding` when the keys went down and the take is recording. */
  onNext: (holding?: boolean) => void;
}) {
  const { t } = useTranslation();
  // Once the models are ready the first press is a real take: the name step
  // opens while the keys are still held, and what's said there is the name.
  // Until then the keys only practice.
  const { held, pressedOnce } = useHeldChord(!modelsReady);
  const advance = useRef(onNext);
  advance.current = onNext;
  useEffect(() => {
    if (!pressedOnce || !modelsReady) return;
    // A beat to see the keys go down first.
    const timer = setTimeout(() => advance.current(true), KEYS_TO_NAME_MS);
    return () => clearTimeout(timer);
  }, [pressedOnce, modelsReady]);
  const login = useLaunchAtLogin();
  const down = held === 'push_to_talk' || held === 'toggle_to_talk';
  return (
    <>
      <Headline>{t('onboarding.keys.title')}</Headline>
      <div className="flex items-center gap-7">
        <Keycaps keys={pushKeys} down={down} size="xl" />
        <div className="flex flex-col gap-1.5">
          <span
            key={down ? 'down' : pressedOnce ? 'nice' : 'try'}
            className={`${DISPLAY_FONT} poster-pop origin-left text-[26px] font-bold`}
          >
            {down
              ? t('onboarding.keys.listening')
              : pressedOnce
                ? t('onboarding.keys.nice')
                : t('onboarding.keys.tryIt')}
          </span>
          <span className="max-w-[340px] text-[13px] leading-normal opacity-80">
            {t('onboarding.keys.hint')}
          </span>
        </div>
      </div>
      {!readiness.inputMonitoring ? (
        <Panel>
          <span className="text-[13px]">{t('onboarding.keys.needsInputMonitoring')}</span>
        </Panel>
      ) : null}
      {login.status && login.status !== 'unavailable' ? (
        <div className="flex max-w-[520px] items-center gap-3.5 rounded-2xl border border-black/20 bg-white/35 px-3.5 py-3">
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">{t('onboarding.keys.loginTitle')}</span>
            <span className="text-xs opacity-75">{t('onboarding.keys.loginDetail')}</span>
          </span>
          {login.status === 'enabled' ? (
            <button
              type="button"
              onClick={() => login.set(false)}
              aria-label={t('onboarding.keys.loginEnabledLabel')}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#1E7A3C] px-3.5 text-[13px] font-semibold text-white"
            >
              ✓ {t('onboarding.keys.loginEnabled')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => login.set(true)}
              className="h-9 rounded-full bg-[#1D1B19] px-4 text-[13px] font-semibold text-white"
            >
              {login.status === 'requires_approval'
                ? t('onboarding.keys.loginApprove')
                : t('onboarding.keys.loginEnable')}
            </button>
          )}
        </div>
      ) : null}
      {pressedOnce ? <Confetti at={{ x: 0.2, y: 0.4 }} /> : null}
      <Actions>
        {pressedOnce ? (
          <PosterButton onClick={onNext} autoFocus>
            {t('onboarding.next')}
          </PosterButton>
        ) : (
          <PosterButton kind="ghost" onClick={onNext}>
            {t('onboarding.skip')}
          </PosterButton>
        )}
      </Actions>
    </>
  );
}
