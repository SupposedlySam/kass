import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { TeachFinishResult, TeachKind, TeachSession, WritingStyle } from '@/lib/api/types';
import {
  defaultStyle,
  useWritingStyles,
  WRITING_STYLE_KEY,
  WRITING_STYLES_KEY,
} from '@/lib/hooks/useWritingStyle';
import { PERSONAL_EXAMPLES_KEY } from '../PersonalExamples';
import { TeachConversation } from './TeachConversation';
import { TeachSidebar } from './TeachSidebar';
import { TeachSummary } from './TeachSummary';

const T = 'writingStyle.teach';

/**
 * Teach Voicebox how you write by replying to conversations
 * (docs/plans/TEACH_BY_REPLYING.md). It teaches `style`, or the default.
 * Closing with replies saves them, the same as Finish.
 */
export function TeachDialog({
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
  const [session, setSession] = useState<TeachSession | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<TeachFinishResult | null>(null);
  const sessionRef = useRef<TeachSession | null>(null);
  sessionRef.current = session;

  const fail = (error: Error) =>
    toast({ title: t(`${T}.failed`), description: error.message, variant: 'destructive' });

  const show = (next: TeachSession, select?: string) => {
    setSession(next);
    if (select) setSelected(select);
  };

  const start = useMutation({
    mutationFn: () => apiClient.startTeach(style?.id),
    onSuccess: (next) => {
      setResult(null);
      show(next, next.conversations[0]?.id);
    },
    onError: fail,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: start once per opening
  useEffect(() => {
    if (open && !sessionRef.current && !start.isPending) start.mutate();
    if (!open) {
      setSession(null);
      setSelected(null);
      setResult(null);
    }
  }, [open]);

  const learned = () => {
    queryClient.invalidateQueries({ queryKey: WRITING_STYLE_KEY });
    queryClient.invalidateQueries({ queryKey: PERSONAL_EXAMPLES_KEY });
  };

  const finish = useMutation({
    mutationFn: (sessionId: string) => apiClient.finishTeach(sessionId),
    onSuccess: (finished) => {
      setSession(null);
      setResult(finished);
      learned();
    },
    onError: fail,
  });

  /** Show ``next`` with the conversation it just opened selected. */
  const showNew = (next: TeachSession) => {
    const before = new Set(sessionRef.current?.conversations.map((c) => c.id));
    show(next, next.conversations.find((c) => !before.has(c.id))?.id);
  };

  const add = useMutation({
    mutationFn: ({ sessionId, kind }: { sessionId: string; kind: TeachKind }) =>
      apiClient.addTeachConversation(sessionId, kind),
    onSuccess: showNew,
    onError: fail,
  });

  // A fresh conversation of the same kind; one with replies is wrapped up and kept.
  const newTheme = useMutation({
    mutationFn: ({ sessionId, id }: { sessionId: string; id: string }) =>
      apiClient.newTeachTheme(sessionId, id),
    onSuccess: showNew,
    onError: fail,
  });

  const wrap = useMutation({
    mutationFn: ({ sessionId, id }: { sessionId: string; id: string }) =>
      apiClient.wrapTeachConversation(sessionId, id),
    onSuccess: (next) => show(next),
    onError: fail,
  });

  const reply = useMutation({
    mutationFn: ({ sessionId, id, written }: { sessionId: string; id: string; written: string }) =>
      apiClient.sendTeachReply(sessionId, id, written),
    onSuccess: (next) => show(next),
    onError: fail,
  });

  const matchWriting = useMutation({
    mutationFn: (styleId: string) =>
      apiClient.updateWritingStyle(styleId, { punctuation_style: 'learned' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY }),
    onError: fail,
  });

  const close = () => {
    const current = sessionRef.current;
    if (current?.replies) {
      finish.mutate(current.session_id, {
        onSuccess: (finished) => {
          toast({ title: t(`${T}.savedOnClose`, { count: finished.replies }) });
          onOpenChange(false);
        },
      });
      return;
    }
    if (current) void apiClient.discardTeach(current.session_id).catch(() => undefined);
    onOpenChange(false);
  };

  const conversation =
    session?.conversations.find((c) => c.id === selected) ?? session?.conversations[0];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        // Esc cancels a dictation take; it must not also close the dialog.
        onEscapeKeyDown={(event) => event.preventDefault()}
        className={
          result
            ? 'gap-0 p-0 sm:max-w-[660px]'
            : 'flex h-[min(760px,90vh)] gap-0 overflow-hidden p-0 sm:max-w-[1040px]'
        }
      >
        {result ? (
          <TeachSummary
            result={result}
            learnedStyleOn={style?.punctuation_style === 'learned'}
            restarting={start.isPending}
            onKeepTeaching={() => start.mutate()}
            onUseLearned={() => {
              if (style) matchWriting.mutate(style.id);
              onOpenChange(false);
            }}
            onClose={() => onOpenChange(false)}
          />
        ) : session && conversation ? (
          <>
            <DialogDescription className="sr-only">{t(`${T}.description`)}</DialogDescription>
            <TeachSidebar
              session={session}
              styleName={style?.name ?? ''}
              selected={conversation.id}
              adding={add.isPending}
              finishing={finish.isPending}
              onSelect={setSelected}
              onAdd={(kind) => add.mutate({ sessionId: session.session_id, kind })}
              onFinish={() => finish.mutate(session.session_id)}
            />
            <TeachConversation
              conversation={conversation}
              suggestedKinds={session.suggested_kinds}
              sending={reply.isPending}
              switching={add.isPending || newTheme.isPending || wrap.isPending}
              onSend={async (written) => {
                await reply
                  .mutateAsync({ sessionId: session.session_id, id: conversation.id, written })
                  .catch(() => undefined);
              }}
              onPickKind={(kind) => add.mutate({ sessionId: session.session_id, kind })}
              onNewTheme={() =>
                newTheme.mutate({ sessionId: session.session_id, id: conversation.id })
              }
              onWrapUp={() => wrap.mutate({ sessionId: session.session_id, id: conversation.id })}
              onFetchDictated={() =>
                apiClient
                  .teachDictated(session.session_id, conversation.id)
                  .then((dictated) => dictated.text)
                  .catch(() => null)
              }
              onRestartTurn={() =>
                void apiClient
                  .restartTeachTurn(session.session_id, conversation.id)
                  .catch(() => undefined)
              }
            />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <DialogTitle className="sr-only">{t(`${T}.title`)}</DialogTitle>
            <DialogDescription className="sr-only">{t(`${T}.starting`)}</DialogDescription>
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-xs">{t(`${T}.starting`)}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
