import { Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type {
  CaptureResponse,
  TeachChip,
  TeachConversation,
  TeachKind,
  TeachSession,
} from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { heardParts, standardCleanup } from '../onboardingFlow';
import { useTakes } from '../onboardingHooks';
import {
  Actions,
  DISPLAY_FONT,
  Headline,
  Lead,
  PosterButton,
  SpeakRow,
  StatusLine,
} from '../Poster';

type Phase = 'reply' | 'check' | 'edit' | 'reveal';

/** A reply as it moves through the step. */
interface Take {
  /** What was heard, from each take's raw transcript. */
  heard: string;
  /** Herga's cleanup of it, in the style being taught. */
  shown: string;
  /** What the user sends: `shown`, or their edit of it. */
  written: string;
}

const EMPTY: Take = { heard: '', shown: '', written: '' };
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.04em]';

/** The conversation of `kind` that hasn't been answered yet, adding one if needed. */
async function openConversation(
  session: TeachSession,
  kind: TeachKind,
): Promise<{ session: TeachSession; conversation: TeachConversation }> {
  const fresh = (s: TeachSession) =>
    s.conversations.find((c) => c.kind === kind && c.reply_count === 0 && !c.wrapped);
  let next = session;
  let conversation = fresh(next);
  if (!conversation) {
    next = await apiClient.addTeachConversation(session.session_id, kind);
    conversation = fresh(next);
  }
  if (!conversation) throw new Error(`No ${kind} conversation to answer.`);
  // Only dictation from here on belongs to this reply.
  await apiClient.restartTeachTurn(next.session_id, conversation.id);
  return { session: next, conversation };
}

/**
 * Teach Herga how the user writes (docs/plans/ONBOARDING.md, "Your style"):
 * they answer a text in their own words, check Herga's version and edit it
 * until it's how they'd send it, then see their way beside standard cleanup.
 * It runs on a teach-by-replying session, so the reply and every edit are
 * saved as examples when they go on.
 */
export function StyleStep({ pushKeys, onNext }: { pushKeys: string[]; onNext: () => void }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<TeachSession | null>(null);
  const [conversation, setConversation] = useState<TeachConversation | null>(null);
  const [phase, setPhase] = useState<Phase>('reply');
  const [take, setTake] = useState<Take>(EMPTY);
  const [typed, setTyped] = useState('');
  const [chips, setChips] = useState<TeachChip[]>([]);
  const [replies, setReplies] = useState(0);
  const [triedWork, setTriedWork] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replyField = useRef<HTMLTextAreaElement>(null);
  const editField = useRef<HTMLTextAreaElement>(null);

  // Nothing is saved unless the user goes on with at least one reply.
  const open = useRef<{ id: string; replies: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .startTeach()
      .then((started) => openConversation(started, 'text_message'))
      .then((opened) => {
        open.current = { id: opened.session.session_id, replies: 0 };
        if (cancelled) return;
        setSession(opened.session);
        setConversation(opened.conversation);
      })
      .catch((err) => !cancelled && setError(String(err instanceof Error ? err.message : err)));
    return () => {
      cancelled = true;
      const left = open.current;
      open.current = null;
      if (left) apiClient.discardTeach(left.id).catch(() => {});
    };
  }, []);

  const toCheck = (next: Take) => {
    setTake(next);
    setPhase('check');
  };

  const takes = useTakes(
    useCallback(
      (capture: CaptureResponse) => {
        if (phase !== 'reply' || capture.source !== 'dictation' || !session || !conversation) {
          return;
        }
        const heard = [take.heard, capture.transcript_raw ?? ''].filter(Boolean).join(' ');
        // Every take this turn, cleaned up together, is what Herga shows.
        apiClient
          .teachDictated(session.session_id, conversation.id)
          .then(({ text }) => {
            const shown = (
              text ??
              capture.transcript_refined ??
              capture.transcript_raw ??
              ''
            ).trim();
            if (!shown) return;
            setTake({ heard, shown, written: shown });
            setPhase('check');
          })
          .catch((err) => setError(String(err instanceof Error ? err.message : err)));
      },
      [phase, session, conversation, take.heard],
    ),
  );

  useEffect(() => {
    if (phase === 'reply') replyField.current?.focus();
    if (phase === 'edit') {
      const el = editField.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [phase]);

  const send = (written: string) => {
    if (!session || !conversation || !written.trim()) return;
    setBusy(true);
    setError(null);
    apiClient
      .sendTeachReply(session.session_id, conversation.id, written.trim())
      .then((next) => {
        setSession(next);
        setTake((current) => ({ ...current, written: written.trim() }));
        setChips(next.conversations.find((c) => c.id === conversation.id)?.chips ?? []);
        setReplies((n) => n + 1);
        if (open.current) open.current.replies += 1;
        setPhase('reveal');
      })
      .catch((err) => setError(String(err instanceof Error ? err.message : err)))
      .finally(() => setBusy(false));
  };

  const sayAgain = () => {
    if (session && conversation) {
      apiClient.restartTeachTurn(session.session_id, conversation.id).catch(() => {});
    }
    setTake(EMPTY);
    setTyped('');
    setPhase('reply');
  };

  const tryWork = () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    openConversation(session, 'team_chat')
      .then((opened) => {
        setSession(opened.session);
        setConversation(opened.conversation);
        setTriedWork(true);
        setTake(EMPTY);
        setTyped('');
        setChips([]);
        setPhase('reply');
      })
      .catch((err) => setError(String(err instanceof Error ? err.message : err)))
      .finally(() => setBusy(false));
  };

  const finish = () => {
    const left = open.current;
    open.current = null;
    if (left && left.replies > 0) {
      apiClient
        .finishTeach(left.id)
        .catch((err) => console.warn('[onboarding] saving the style failed:', err));
    } else if (left) {
      apiClient.discardTeach(left.id).catch(() => {});
    }
    onNext();
  };

  const persona = conversation?.persona ?? '';
  const status = busy
    ? t('onboarding.working')
    : takes.phase === 'working'
      ? t('onboarding.working')
      : (error ?? takes.error);

  if (phase === 'reply') {
    const incoming = [...(conversation?.messages ?? [])].reverse().find((m) => !m.from_you);
    const note = conversation?.note;
    return (
      <>
        <span className={cn(LABEL, 'opacity-75')}>
          {conversation
            ? `${persona} · ${t(`writingStyle.teach.kinds.${conversation.kind}.short`)}`
            : ' '}
        </span>
        <p
          className={`${DISPLAY_FONT} m-0 line-clamp-3 min-h-[3.15em] max-w-[720px] text-[44px] font-bold leading-[1.05] tracking-[-0.03em]`}
        >
          {incoming ? `“${incoming.text}”` : null}
        </p>
        <Lead>
          {note?.facts
            ? t('onboarding.style.tell', { persona, facts: note.facts })
            : note?.answers.length
              ? note.answers.map((a) => `${a.ask} → ${a.answer}`).join(' · ')
              : t('onboarding.style.body', { persona: persona || t('onboarding.style.them') })}
        </Lead>
        <label htmlFor="onboarding-style-reply" className="sr-only">
          {t('onboarding.style.fieldLabel')}
        </label>
        <textarea
          id="onboarding-style-reply"
          ref={replyField}
          rows={1}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t('onboarding.style.fieldPlaceholder')}
          className="max-w-[640px] resize-none rounded-full border-[1.5px] border-white/60 bg-white/10 px-4 py-3 text-[15px] text-white placeholder:text-white/50 focus:border-white focus:outline-none"
        />
        <SpeakRow
          keys={pushKeys}
          listening={takes.phase === 'listening'}
          disabled={!conversation}
          onDictate={takes.toggle}
          dictateLabel={t('onboarding.dictate')}
          stopLabel={t('onboarding.stop')}
          orHoldLabel={t('onboarding.orHold')}
        />
        <StatusLine>{status}</StatusLine>
        <Actions>
          <div className={cn(!typed.trim() && 'invisible')}>
            <PosterButton
              disabled={!typed.trim()}
              onClick={() => toCheck({ heard: '', shown: typed.trim(), written: typed.trim() })}
            >
              {t('onboarding.style.useTyped')}
            </PosterButton>
          </div>
          <PosterButton kind="ghost" onClick={finish}>
            {replies > 0 ? t('onboarding.next') : t('onboarding.skip')}
          </PosterButton>
        </Actions>
      </>
    );
  }

  if (phase === 'check' || phase === 'edit') {
    const editing = phase === 'edit';
    return (
      <>
        <span className={cn(LABEL, 'opacity-75')}>
          {t('onboarding.style.yourReplyTo', { persona })}
        </span>
        <Headline>{t('onboarding.style.checkTitle')}</Headline>
        <Lead>{editing ? t('onboarding.style.editBody') : t('onboarding.style.checkBody')}</Lead>
        {editing ? (
          <>
            <label htmlFor="onboarding-style-edit" className="sr-only">
              {t('onboarding.style.fieldLabel')}
            </label>
            <textarea
              id="onboarding-style-edit"
              ref={editField}
              rows={2}
              value={take.written}
              onChange={(e) => setTake({ ...take, written: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(take.written);
                }
              }}
              className={`${DISPLAY_FONT} max-w-[700px] resize-none rounded-[18px] bg-white px-[18px] py-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-[#1D1B19] focus:outline-none`}
            />
          </>
        ) : (
          <p
            className={`${DISPLAY_FONT} poster-pop m-0 line-clamp-3 max-w-[700px] origin-left rounded-[18px] bg-white/12 px-[18px] py-4 text-[28px] font-bold leading-[1.2] tracking-[-0.02em]`}
          >
            {take.shown}
          </p>
        )}
        {editing ? (
          <div className="grid max-w-[700px] grid-cols-[130px_1fr] items-baseline gap-x-3.5 gap-y-2">
            <span className={cn(LABEL, 'opacity-75')}>{t('onboarding.style.hergaWrote')}</span>
            <span className="line-clamp-2 text-[15px] leading-snug opacity-75">{take.shown}</span>
            <span className={LABEL}>{t('onboarding.style.youChanged')}</span>
            <span className="line-clamp-2 text-[15px] leading-relaxed">
              {heardParts(take.written, take.shown).map((part, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt together and never reorder
                <span key={i}>
                  {i ? ' ' : null}
                  {part.dropped ? (
                    <ins className="rounded bg-white px-[3px] text-[var(--poster-bg)] no-underline">
                      {part.text}
                    </ins>
                  ) : (
                    part.text
                  )}
                </span>
              ))}
            </span>
          </div>
        ) : null}
        <StatusLine>{status}</StatusLine>
        <Actions>
          {editing ? (
            <>
              <PosterButton
                onClick={() => send(take.written)}
                disabled={busy || !take.written.trim()}
              >
                {t('onboarding.style.done')}
              </PosterButton>
              <PosterButton
                kind="ghost"
                onClick={() => {
                  setTake({ ...take, written: take.shown });
                  setPhase('check');
                }}
              >
                {t('onboarding.style.cancel')}
              </PosterButton>
            </>
          ) : (
            <>
              <PosterButton onClick={() => send(take.shown)} disabled={busy} autoFocus>
                {t('onboarding.style.looksRight')}
              </PosterButton>
              <PosterButton
                kind="outline"
                onClick={() => setPhase('edit')}
                disabled={busy}
                icon={<Pencil className="h-4 w-4" aria-hidden />}
              >
                {t('onboarding.style.edit')}
              </PosterButton>
              <PosterButton kind="ghost" onClick={sayAgain} disabled={busy}>
                {t('onboarding.style.sayAgain')}
              </PosterButton>
            </>
          )}
        </Actions>
      </>
    );
  }

  // The reveal: what was said, standard cleanup, and the user's own way.
  const edited = take.written !== take.shown;
  const standard = standardCleanup(take.shown);
  return (
    <>
      <Headline letters>{t('onboarding.style.revealTitle')}</Headline>
      <div className="grid max-w-[740px] grid-cols-[150px_1fr] items-baseline gap-x-3.5 gap-y-2.5">
        {take.heard ? (
          <>
            <span className={cn(LABEL, 'opacity-75')}>{t('onboarding.style.said')}</span>
            <span className="line-clamp-2 text-[15px] leading-snug opacity-75">
              {heardParts(take.heard, take.shown).map((part, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt together and never reorder
                <span key={i}>
                  {i ? ' ' : null}
                  <span
                    className={part.dropped ? 'poster-strike' : undefined}
                    style={part.dropped ? { animationDelay: '600ms' } : undefined}
                  >
                    {part.text}
                  </span>
                </span>
              ))}
            </span>
          </>
        ) : null}
        {standard !== take.written ? (
          <>
            <span className={cn(LABEL, 'opacity-75')}>{t('onboarding.style.standard')}</span>
            <span className="line-clamp-2 text-[15px] leading-snug opacity-75">{standard}</span>
          </>
        ) : null}
        <span className={cn(LABEL, 'border-t-[1.5px] border-white pt-3.5')}>
          {t('onboarding.style.yourWay')}
        </span>
        <span
          className={`${DISPLAY_FONT} poster-rise-late line-clamp-3 border-t-[1.5px] border-white pt-3.5 text-[30px] font-bold leading-[1.15] tracking-[-0.02em]`}
          style={{ animationDelay: '900ms' }}
        >
          {take.written}
        </span>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className={cn(LABEL, 'opacity-75')}>
            {edited ? t('onboarding.style.learnedFromEdits') : t('onboarding.style.learnedFrom')}
          </span>
          <div className="flex max-w-[740px] flex-wrap gap-1.5">
            {chips.map((chip, i) => (
              <span
                key={`${chip.code}:${chip.value ?? ''}`}
                className="poster-pop inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] text-[var(--poster-bg)]"
                style={{ animationDelay: `${1200 + i * 90}ms` }}
              >
                {t(`writingStyle.teach.chips.${chip.code}`, { value: chip.value ?? '' })}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <StatusLine>{status}</StatusLine>
      <Actions>
        <PosterButton onClick={finish} autoFocus>
          {t('onboarding.next')}
        </PosterButton>
        {!triedWork ? (
          <PosterButton kind="outline" onClick={tryWork} disabled={busy}>
            {t('onboarding.style.tryWork')}
          </PosterButton>
        ) : null}
      </Actions>
      <p className="m-0 -mt-1 max-w-[520px] text-[13px] leading-normal opacity-75">
        {triedWork ? t('onboarding.style.moreLater') : t('onboarding.style.more')}
      </p>
    </>
  );
}
