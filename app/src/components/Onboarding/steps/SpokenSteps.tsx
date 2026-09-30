import { Check, Lock } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { CaptureResponse, CaptureSettings } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { heardParts } from '../onboardingFlow';
import { useHeldChord, useTakes } from '../onboardingHooks';
import {
  Actions,
  DISPLAY_FONT,
  Headline,
  Keycaps,
  Lead,
  Panel,
  PosterButton,
  ProgressBar,
  SpeakRow,
  StatusLine,
} from '../Poster';
import { Confetti } from '../PosterMotion';
import type { OnboardingDownloads } from '../useOnboardingDownloads';

/** The text a dictation capture delivered. */
function sentText(capture: CaptureResponse): string {
  return (capture.transcript_refined ?? capture.transcript_raw ?? '').trim();
}

function useSpeakLabels() {
  const { t } = useTranslation();
  return {
    dictateLabel: t('onboarding.dictate'),
    stopLabel: t('onboarding.stop'),
    orHoldLabel: t('onboarding.orHold'),
  };
}

/** Shown on a spoken step until the models are ready. */
export function LockedStep({
  downloads,
  pushKeys,
  onShowFailure,
}: {
  downloads: OnboardingDownloads;
  pushKeys: string[];
  onShowFailure: () => void;
}) {
  const { t } = useTranslation();
  const labels = useSpeakLabels();
  const waitingOn =
    downloads.speech.state === 'ready' && downloads.cleanup ? downloads.cleanup : downloads.speech;
  const name =
    waitingOn === downloads.speech
      ? t('onboarding.download.speech')
      : t('onboarding.download.cleanup');
  return (
    <>
      <Headline>{t('onboarding.locked.title')}</Headline>
      <Lead>
        {downloads.failed
          ? t('onboarding.locked.failedBody')
          : t('onboarding.locked.body', { model: name })}
      </Lead>
      <Panel className="max-w-[560px]">
        <span className="flex items-center gap-2 font-medium">
          <Lock className="h-4 w-4" aria-hidden />
          {t('onboarding.locked.cantHear')}
        </span>
        <ProgressBar percent={waitingOn.percent} tone={downloads.failed ? 'fail' : undefined} />
        <span className="font-mono text-xs opacity-80">
          {name} · {Math.round(waitingOn.percent)}%
        </span>
      </Panel>
      {downloads.failed ? (
        <Actions>
          <PosterButton kind="outline" onClick={onShowFailure}>
            {t('onboarding.locked.seeWhy')}
          </PosterButton>
        </Actions>
      ) : null}
      <SpeakRow keys={pushKeys} listening={false} disabled onDictate={() => {}} {...labels} />
    </>
  );
}

type NamePhase = 'ask' | 'confirm' | 'edit' | 'saved';

/**
 * The first real dictation. What was heard fills a field; the user confirms
 * the spelling or fixes it before it goes into the dictionary.
 */
export function NameStep({ pushKeys, onNext }: { pushKeys: string[]; onNext: () => void }) {
  const { t } = useTranslation();
  const labels = useSpeakLabels();
  const [phase, setPhase] = useState<NamePhase>('ask');
  const [name, setName] = useState('');
  const [heard, setHeard] = useState('');
  const [fixed, setFixed] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const takes = useTakes(
    useCallback(
      (capture: CaptureResponse) => {
        if (phase !== 'ask' || capture.source !== 'dictation') return;
        const said = sentText(capture).replace(/[.!?,]+$/, '');
        if (!said) return;
        setHeard(said);
        setName(said);
        setPhase('confirm');
      },
      [phase],
    ),
  );

  useEffect(() => {
    if (phase === 'ask' || phase === 'edit') field.current?.focus();
  }, [phase]);

  const save = (spelling: string, wasFixed: boolean) => {
    const written = spelling.trim();
    if (!written) return;
    setName(written);
    setFixed(wasFixed);
    setPhase('saved');
    apiClient
      .createDictionaryEntry({
        written,
        spoken: wasFixed && heard && heard !== written ? heard : null,
        places: [{ scope: 'global' }],
      })
      .catch((err) => console.warn('[onboarding] saving the name failed:', err));
  };

  if (phase === 'ask' || phase === 'edit') {
    return (
      <>
        {phase === 'ask' ? (
          <>
            <Headline>{t('onboarding.name.title')}</Headline>
            <Lead>{t('onboarding.name.body')}</Lead>
          </>
        ) : (
          <Lead>{t('onboarding.name.editBody')}</Lead>
        )}
        <div className="flex items-baseline gap-4">
          {phase === 'edit' ? (
            <span
              className={`${DISPLAY_FONT} text-[84px] font-bold leading-none tracking-[-0.04em]`}
            >
              {t('onboarding.name.hi')}
            </span>
          ) : null}
          <label htmlFor="onboarding-name" className="sr-only">
            {t('onboarding.name.fieldLabel')}
          </label>
          <input
            id="onboarding-name"
            ref={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && phase === 'edit') save(name, true);
            }}
            placeholder={phase === 'ask' ? t('onboarding.name.placeholder') : undefined}
            className={cn(
              DISPLAY_FONT,
              'h-20 w-[440px] rounded-2xl border-[3px] border-white/70 bg-white/12 px-4 text-[52px] font-bold tracking-[-0.03em] text-white placeholder:text-white/40 focus:border-white focus:outline-none',
            )}
          />
        </div>
        {phase === 'ask' ? (
          <>
            <SpeakRow
              keys={pushKeys}
              listening={takes.phase === 'listening'}
              onDictate={takes.toggle}
              {...labels}
            />
            <StatusLine>
              {takes.phase === 'working' ? t('onboarding.working') : takes.error}
            </StatusLine>
          </>
        ) : (
          <Actions>
            <PosterButton onClick={() => save(name, true)}>
              {t('onboarding.name.saveSpelling')}
            </PosterButton>
            <PosterButton
              kind="ghost"
              onClick={() => {
                setName('');
                setPhase('ask');
              }}
            >
              {t('onboarding.name.sayAgain')}
            </PosterButton>
          </Actions>
        )}
      </>
    );
  }

  // What follows the greeting waits for its letters to land.
  const greeting = t('onboarding.name.greeting', { name });
  const after = { animationDelay: `${200 + greeting.length * 30}ms` };
  return (
    <>
      <Headline size="xl" letters>
        {greeting}
      </Headline>
      {phase === 'confirm' ? <Confetti at={{ x: 0.25, y: 0.28 }} delay={0.35} /> : null}
      {phase === 'confirm' ? (
        <div className="poster-rise-late flex flex-col gap-4" style={after}>
          <span className="text-[17px]">{t('onboarding.name.spelledRight')}</span>
          <Actions>
            <PosterButton onClick={() => save(name, false)} autoFocus>
              {t('onboarding.name.yes')}
            </PosterButton>
            <PosterButton kind="outline" onClick={() => setPhase('edit')}>
              {t('onboarding.name.fix')}
            </PosterButton>
          </Actions>
        </div>
      ) : (
        <>
          <span className="poster-pop inline-flex origin-left items-center gap-2 self-start rounded-full border-[1.5px] border-[#34C759] bg-[#34C759]/20 px-3.5 py-2 text-[13px]">
            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            {fixed ? t('onboarding.name.savedFixed', { name }) : t('onboarding.name.saved')}
          </span>
          <Actions>
            <PosterButton onClick={onNext} autoFocus>
              {t('onboarding.next')}
            </PosterButton>
          </Actions>
        </>
      )}
    </>
  );
}

const SCRIPT_KEYS = ['lunch', 'work', 'friend'] as const;
const STRIKE_START = 450;
const STRIKE_EACH = 320;

/** Read a scripted line with filler and a change of mind; see what was kept. */
export function MessyStep({ pushKeys, onNext }: { pushKeys: string[]; onNext: () => void }) {
  const { t } = useTranslation();
  const labels = useSpeakLabels();
  const [script, setScript] = useState<(typeof SCRIPT_KEYS)[number]>('lunch');
  const [result, setResult] = useState<{ heard: string; sent: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const takes = useTakes(
    useCallback((capture: CaptureResponse) => {
      if (capture.source !== 'dictation') return;
      setResult({ heard: capture.transcript_raw ?? '', sent: sentText(capture) });
    }, []),
  );
  useEffect(() => {
    field.current?.focus();
  }, []);

  // Each dropped piece is struck in turn, then the clean line lands.
  let strikes = 0;
  const parts = result
    ? heardParts(result.heard, result.sent).map((part) => ({
        ...part,
        strike: part.dropped ? strikes++ : null,
      }))
    : [];

  return (
    <>
      <Headline size="md">{t('onboarding.messy.title')}</Headline>
      <Lead>{t('onboarding.messy.body')}</Lead>
      <div className="flex flex-wrap gap-1.5">
        {SCRIPT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setScript(key);
              setResult(null);
              field.current?.focus();
            }}
            className={cn(
              'h-8 rounded-full border px-3.5 text-[13px] text-[var(--poster-fg)]',
              key === script ? 'border-white bg-white/20' : 'border-white/40 bg-transparent',
            )}
          >
            {t(`onboarding.messy.scripts.${key}.title`)}
          </button>
        ))}
      </div>
      <div className="flex h-[132px] flex-col gap-3 overflow-hidden">
        {result ? (
          <div key={`${result.heard}\n${result.sent}`} className="contents">
            <p className="poster-rise-late m-0 line-clamp-2 max-w-[700px] text-[17px] leading-snug">
              {parts.map((part, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt together and never reorder
                <Fragment key={i}>
                  {i ? ' ' : null}
                  <span
                    className={part.dropped ? 'poster-strike' : 'opacity-85'}
                    style={
                      part.strike === null
                        ? undefined
                        : { animationDelay: `${STRIKE_START + part.strike * STRIKE_EACH}ms` }
                    }
                  >
                    {part.text}
                  </span>
                </Fragment>
              ))}
            </p>
            <p
              className={`${DISPLAY_FONT} poster-rise-late m-0 line-clamp-2 max-w-[720px] text-[32px] font-bold leading-tight tracking-[-0.02em]`}
              style={{ animationDelay: `${STRIKE_START + strikes * STRIKE_EACH + 150}ms` }}
            >
              {result.sent}
            </p>
          </div>
        ) : (
          <p className={`${DISPLAY_FONT} m-0 max-w-[700px] text-[26px] font-medium leading-tight`}>
            {t(`onboarding.messy.scripts.${script}.line`)}
          </p>
        )}
      </div>
      <label htmlFor="onboarding-messy" className="sr-only">
        {t('onboarding.messy.fieldLabel')}
      </label>
      <textarea
        id="onboarding-messy"
        ref={field}
        rows={1}
        placeholder={t('onboarding.messy.fieldPlaceholder')}
        className="max-w-[560px] resize-none rounded-xl border border-white/40 bg-white/10 px-3.5 py-2 text-sm text-white placeholder:text-white/50 focus:border-white focus:outline-none"
      />
      <SpeakRow
        keys={pushKeys}
        listening={takes.phase === 'listening'}
        onDictate={takes.toggle}
        {...labels}
      />
      <StatusLine>{takes.phase === 'working' ? t('onboarding.working') : takes.error}</StatusLine>
      <div className={cn(!result && 'invisible')}>
        <Actions>
          <PosterButton onClick={onNext} disabled={!result}>
            {t('onboarding.next')}
          </PosterButton>
        </Actions>
      </div>
    </>
  );
}

const INSTRUCTION_KEYS = ['shorter', 'friendlier', 'bullets'] as const;

/**
 * Rewrite text already written: a paragraph is selected in a box, and the
 * command chord (or a click on an instruction) rewrites it in place.
 */
export function RewriteStep({
  settings,
  onNext,
}: {
  settings: CaptureSettings | undefined;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const original = t('onboarding.rewrite.paragraph');
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on each rewrite, to sweep a light across the new text.
  const [rewrites, setRewrites] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const { held } = useHeldChord(false);
  const commandKeys = settings?.chord_command_keys ?? [];

  const selectAll = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, []);
  useEffect(() => selectAll(), [selectAll]);

  const run = (key: (typeof INSTRUCTION_KEYS)[number]) => {
    const el = field.current;
    const selection =
      el && el.selectionEnd > el.selectionStart
        ? el.value.slice(el.selectionStart, el.selectionEnd)
        : text;
    setBusy(key);
    setError(null);
    apiClient
      .runCommand(selection, t(`onboarding.rewrite.instructions.${key}`))
      .then((capture) => {
        const rewritten = (capture.transcript_refined ?? '').trim();
        if (!rewritten) return;
        setText(text.replace(selection, rewritten));
        setRewrites((n) => n + 1);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <Headline size="md">{t('onboarding.rewrite.title')}</Headline>
      <Lead>
        {commandKeys.length > 0 ? t('onboarding.rewrite.body') : t('onboarding.rewrite.bodyNoKeys')}
      </Lead>
      <label htmlFor="onboarding-rewrite" className="sr-only">
        {t('onboarding.rewrite.fieldLabel')}
      </label>
      <div className="relative max-w-[700px]">
        <textarea
          id="onboarding-rewrite"
          ref={field}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="block w-full resize-none rounded-2xl bg-white px-4 py-3.5 text-[15px] leading-relaxed text-[#1D1B19] selection:bg-[#C9D3FF] focus:outline-none"
        />
        {rewrites ? (
          <span
            key={rewrites}
            className="poster-sweep pointer-events-none absolute inset-0 rounded-2xl"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {commandKeys.length > 0 ? (
          <>
            <span className="text-[13px] opacity-80">{t('onboarding.hold')}</span>
            <Keycaps keys={commandKeys} down={held === 'command'} />
            <span className="text-[13px] opacity-80">{t('onboarding.rewrite.andSay')}</span>
          </>
        ) : null}
        {INSTRUCTION_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={busy !== null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(key)}
            aria-busy={busy === key}
            className={cn(
              'h-8 rounded-full border border-white/40 px-3.5 text-[13px] text-[var(--poster-fg)] hover:border-white disabled:opacity-60',
              busy === key && 'animate-pulse border-white',
            )}
          >
            {`“${t(`onboarding.rewrite.instructions.${key}`)}”`}
          </button>
        ))}
        <button
          type="button"
          disabled={text === original}
          onClick={() => {
            setText(original);
            requestAnimationFrame(selectAll);
          }}
          className={cn(
            'h-8 px-2.5 text-[13px] font-medium text-[var(--poster-fg)] underline',
            text === original && 'invisible',
          )}
        >
          {t('onboarding.rewrite.undo')}
        </button>
      </div>
      <StatusLine>{busy ? t('onboarding.working') : error}</StatusLine>
      <Actions>
        <PosterButton onClick={onNext}>{t('onboarding.next')}</PosterButton>
        <div className={cn(text !== original && 'invisible')}>
          <PosterButton kind="ghost" onClick={onNext} disabled={text !== original}>
            {t('onboarding.skip')}
          </PosterButton>
        </div>
      </Actions>
    </>
  );
}

export function DoneStep({
  settings,
  onFinish,
}: {
  settings: CaptureSettings | undefined;
  onFinish: (show: string | null) => void;
}) {
  const { t } = useTranslation();
  const rows: Array<{ keys: string[]; text: string }> = [
    { keys: settings?.chord_push_to_talk_keys ?? [], text: t('onboarding.done.push') },
    { keys: settings?.chord_toggle_to_talk_keys ?? [], text: t('onboarding.done.toggle') },
    { keys: settings?.chord_command_keys ?? [], text: t('onboarding.done.command') },
  ].filter((row) => row.keys.length > 0);
  return (
    <>
      <Headline size="xl" letters>
        {t('onboarding.done.title')}
      </Headline>
      <Confetti burst="celebrate" delay={0.25} />
      <Lead>{t('onboarding.done.body')}</Lead>
      <div className="flex max-w-[560px] flex-col">
        {rows.map((row) => (
          <div key={row.text} className="flex items-center gap-4 border-t border-white/25 py-2.5">
            <span className="w-[170px] shrink-0">
              <Keycaps keys={row.keys} />
            </span>
            <span>{row.text}</span>
          </div>
        ))}
        <span className="pt-1.5 text-xs opacity-75">{t('onboarding.done.change')}</span>
      </div>
      <Actions>
        <PosterButton onClick={() => onFinish(null)} autoFocus>
          {t('onboarding.done.start')}
        </PosterButton>
        <PosterButton kind="outline" onClick={() => onFinish('/settings/features')}>
          {t('onboarding.done.showMe')}
        </PosterButton>
      </Actions>
    </>
  );
}
