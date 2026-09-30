import { ArrowUp, ChevronDown, Loader2, Mic, RefreshCw, Square } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordKeys } from '@/components/CapturesTab/EmptyDetail';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import type { TeachConversation as Conversation, TeachKind, TeachNote } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { cn } from '@/lib/utils/cn';
import { KindMenuItems } from './KindMenu';
import { KIND_ICONS } from './kinds';
import { type TeachDictation, useTeachDictation } from './useTeachDictation';

const T = 'writingStyle.teach';
const MAX_REPLY_CHARS = 4000;

/** The open conversation: its header, the thread, the note for the answer and the reply box. */
export function TeachConversation({
  conversation,
  suggestedKinds,
  sending,
  switching,
  onSend,
  onPickKind,
  onNewTheme,
  onWrapUp,
  onFetchDictated,
  onRestartTurn,
}: {
  conversation: Conversation;
  suggestedKinds: TeachKind[];
  /** The reply is being saved and the other side is writing back. */
  sending: boolean;
  switching: boolean;
  /** Resolves to whether the reply was saved. */
  onSend: (written: string) => Promise<boolean>;
  onPickKind: (kind: TeachKind) => void;
  onNewTheme: () => void;
  onWrapUp: () => void;
  onFetchDictated: () => Promise<string | null>;
  onRestartTurn: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  // The reply just sent, shown in the thread until the other side's answer
  // arrives with it; ``turn`` tells it apart from once it's part of the thread.
  const [sent, setSent] = useState<{ text: string; turn: number } | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const Icon = KIND_ICONS[conversation.kind];
  const kindLabel = t(`${T}.kinds.${conversation.kind}.label`);

  const dictation = useTeachDictation(() => {
    void onFetchDictated().then((text) => {
      if (text) setDraft((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      box.current?.focus();
    });
  });

  // A new conversation or turn starts with an empty box, ready for the shortcut.
  const turn = conversation.messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset per conversation and turn
  useEffect(() => {
    setDraft('');
    box.current?.focus();
  }, [conversation.id, turn]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the thread grows
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [turn, sending, sent, conversation.id]);

  const pending = sending && sent?.turn === turn ? sent.text : null;
  const canSend = !!draft.trim() && !sending && dictation.state.phase === 'idle';
  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    setSent({ text, turn });
    setDraft('');
    void onSend(text).then((saved) => {
      // Not saved: put it back to try again.
      if (!saved) setDraft(text);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      send();
    }
  };
  const edit = (value: string) => {
    // Cleared out: what was dictated before no longer belongs to this reply.
    if (draft.trim() && !value.trim()) onRestartTurn();
    setDraft(value);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {conversation.title ?? conversation.persona}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {t(`${T}.subtitle`, { kind: kindLabel, relation: conversation.relation })}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={switching}>
              <Icon className="h-3.5 w-3.5" />
              {t(`${T}.kinds.${conversation.kind}.short`)}
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[300px]">
            <KindMenuItems
              suggested={suggestedKinds}
              current={conversation.kind}
              onPick={onPickKind}
            />
            <p className="border-t border-border px-2 pt-2 pb-1 text-[11.5px] text-muted-foreground">
              {t(`${T}.kindMenuNote`)}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={switching || sending}
          onClick={onNewTheme}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t(`${T}.newTheme`)}
        </Button>
        {!conversation.wrapped && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={switching || sending}
            onClick={onWrapUp}
          >
            {t(`${T}.wrapUp`)}
          </Button>
        )}
      </header>

      <div ref={thread} className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 py-5">
        <div className="flex-1" />
        {[
          ...conversation.messages,
          ...(pending === null ? [] : [{ from_you: true, text: pending }]),
        ].map((message, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the thread only grows
            key={index}
            className="flex gap-2.5"
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                message.from_you ? 'bg-accent/15 text-accent' : 'bg-secondary',
              )}
            >
              {message.from_you ? t(`${T}.youInitial`) : conversation.persona.slice(0, 1)}
            </span>
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-semibold">
                {message.from_you ? t(`${T}.you`) : conversation.persona}
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed">{message.text}</p>
            </div>
          </div>
        ))}
        {sending && (
          <p className="flex items-center gap-2 pl-9 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t(`${T}.typing`, { persona: conversation.persona })}
          </p>
        )}
      </div>

      {conversation.wrapped ? (
        <p className="border-t border-border px-6 py-4 text-xs text-muted-foreground">
          {t(`${T}.wrapped`)}
        </p>
      ) : (
        <div className="flex flex-col gap-3 border-t border-border px-6 pt-5 pb-4">
          {conversation.note && !sending && (
            <ForYou note={conversation.note} persona={conversation.persona} />
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={box}
              value={draft}
              onChange={(event) => edit(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending}
              maxLength={MAX_REPLY_CHARS}
              rows={3}
              aria-label={t(`${T}.replyLabel`)}
              placeholder={
                dictation.state.phase === 'idle' ? t(`${T}.replyPlaceholder`) : undefined
              }
              className="max-h-48 min-h-[76px] flex-1 resize-y rounded-lg border border-accent bg-background px-3.5 py-2.5 text-sm leading-relaxed outline-none disabled:opacity-60"
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              aria-label={t(`${T}.send`)}
              disabled={!canSend}
              onClick={send}
            >
              {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
          <DictationRow
            state={dictation.state}
            available={dictation.available}
            onStart={dictation.start}
            onStop={dictation.stop}
            persona={conversation.persona}
          />
        </div>
      )}
    </div>
  );
}

/** The facts for the answer, and sometimes a trick to try with an example. */
function ForYou({ note, persona }: { note: TeachNote; persona: string }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-col gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-3 pt-4 pb-2.5 text-[13px] leading-snug">
      <span className="absolute -top-2 left-2.5 rounded bg-accent px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-accent-foreground">
        {t(`${T}.forYou`)}
      </span>
      {note.answers.length > 0 ? (
        <>
          <span className="font-semibold">{t(`${T}.whatToAnswer`)}</span>
          <div className="grid grid-cols-[max-content_14px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
            {note.answers.map((pair) => (
              <div key={pair.ask} className="contents">
                <span className="text-foreground/70">{pair.ask}</span>
                <span className="text-foreground/50">→</span>
                <span>{pair.answer}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        note.facts && (
          <p>
            <span className="font-semibold">{t(`${T}.tell`, { persona })}</span> {note.facts}
          </p>
        )
      )}
      {note.trick && (
        <div className="mt-1 space-y-0.5 border-t border-accent/25 pt-2">
          <p>
            <span className="font-semibold">{t(`${T}.tryThis`)}</span>{' '}
            {t(`${T}.tricks.${note.trick}.text`)}
          </p>
          <p className="text-foreground/70">
            {note.example
              ? t(`${T}.tricks.${note.trick}.exampleWith`, { example: note.example })
              : t(`${T}.tricks.${note.trick}.example`)}
          </p>
        </div>
      )}
    </div>
  );
}

/** How to dictate the reply, following how the current take started. */
function DictationRow({
  state,
  available,
  onStart,
  onStop,
  persona,
}: {
  state: TeachDictation;
  available: boolean;
  onStart: () => void;
  onStop: () => void;
  persona: string;
}) {
  const { t } = useTranslation();
  const { settings } = useCaptureSettings();
  const hold = settings?.chord_push_to_talk_keys ?? [];
  const handsFree = settings?.chord_toggle_to_talk_keys ?? [];

  return (
    <div className="flex min-h-8 items-center gap-2.5 text-xs text-muted-foreground">
      {state.phase === 'listening' && state.how === 'button' ? (
        <Button size="sm" className="gap-1.5" onClick={onStop}>
          <Square className="h-3 w-3 fill-current" />
          {t(`${T}.stop`)}
        </Button>
      ) : (
        available && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={state.phase !== 'idle'}
            onClick={onStart}
          >
            <Mic className="h-3.5 w-3.5 text-accent" />
            {t(`${T}.dictate`)}
            {hold.length > 0 && <ChordKeys keys={hold} />}
          </Button>
        )
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {state.phase === 'listening' ? (
          <>
            <span className="font-medium text-accent">{t(`${T}.listening`)}</span>
            {state.how === 'button' ? (
              t(`${T}.finishButton`)
            ) : (
              <>
                {t(`${T}.finishHold`)}
                <ChordKeys keys={hold} />
                {handsFree.length > 0 && (
                  <>
                    {t(`${T}.finishHandsFree`)}
                    <ChordKeys keys={handsFree} />
                  </>
                )}
              </>
            )}
            <span className="text-muted-foreground/80">{t(`${T}.escCancels`)}</span>
          </>
        ) : state.phase === 'cleaning' ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t(`${T}.cleaning`)}
          </span>
        ) : (
          t(`${T}.answersAfter`, { persona })
        )}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>⌘⏎</Kbd>
        {t(`${T}.sendShort`)}
      </span>
    </div>
  );
}
