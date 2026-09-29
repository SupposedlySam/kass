import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordKeys } from '@/components/CapturesTab/EmptyDetail';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { PunctuationStyle, WritingStyle, WritingStyleUpdate } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { useWritingStyle, WRITING_STYLES_KEY } from '@/lib/hooks/useWritingStyle';
import { useTeachDictation } from './teach/useTeachDictation';

const R = 'settings.captures.refinement';
const S = 'writingStyle.styles.settings';

/** Change a style; the listing is refetched so every screen shows the new settings. */
function useUpdateStyle(styleId: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: WritingStyleUpdate) => apiClient.updateWritingStyle(styleId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
      queryClient.invalidateQueries({ queryKey: ['captures', 'apps'] });
    },
    onError: (error: Error) =>
      toast({ title: t(`${S}.saveFailed`), description: error.message, variant: 'destructive' }),
  });
}

/**
 * The selected style's settings: its name, how the user says they write in
 * its apps, punctuation, technical terms, whether new apps use it, and
 * deleting it.
 */
export function StyleSettings({
  style,
  onDeleted,
}: {
  style: WritingStyle;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateStyle(style.id);
  const { data: learned } = useWritingStyle(style.id);
  const [name, setName] = useState(style.name);
  useEffect(() => setName(style.name), [style.name]);

  const rename = () => {
    const next = name.trim();
    if (next && next !== style.name) update.mutate({ name: next });
    else setName(style.name);
  };

  return (
    <SettingSection title={t(`${S}.title`, { style: style.name })}>
      <SettingRow
        title={t(`${S}.name`)}
        htmlFor="styleName"
        action={
          <Input
            id="styleName"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setName(style.name);
            }}
            className="h-8 w-[240px] text-[13px]"
          />
        }
      />
      <StyleDescription style={style} onSave={(description) => update.mutate({ description })} />
      <SettingRow
        title={t(`${R}.punctuationStyle.title`)}
        description={t(`${S}.punctuationDescription`)}
        action={
          <Select
            value={style.punctuation_style}
            onValueChange={(v) => update.mutate({ punctuation_style: v as PunctuationStyle })}
          >
            <SelectTrigger className="h-8 w-[300px]" aria-label={t(`${R}.punctuationStyle.title`)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="casual">{t(`${R}.punctuationStyle.casual`)}</SelectItem>
              <SelectItem value="standard">{t(`${R}.punctuationStyle.standard`)}</SelectItem>
              <SelectItem value="learned" disabled={!learned?.ready}>
                {learned?.ready
                  ? t(`${R}.punctuationStyle.learned`)
                  : t(`${R}.punctuationStyle.learnedLocked`)}
              </SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <SettingRow
        title={t(`${S}.technical`)}
        description={t(`${R}.preserveTechnical.description`)}
        htmlFor="preserveTechnical"
        action={
          <Toggle
            id="preserveTechnical"
            checked={style.preserve_technical}
            onCheckedChange={(v) => update.mutate({ preserve_technical: v })}
          />
        }
      />
      <SettingRow
        title={t(`${S}.default`)}
        description={
          style.is_default
            ? t(`${S}.defaultOn`)
            : t(`${S}.defaultDescription`, { style: style.name })
        }
        action={
          !style.is_default && (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ is_default: true })}
            >
              {t(`${S}.makeDefault`)}
            </Button>
          )
        }
      />
      {!style.is_default && <DeleteStyle style={style} onDeleted={onDeleted} />}
    </SettingSection>
  );
}

/** Matches the server's limit. */
const MAX_DESCRIPTION = 600;

/**
 * "How you write here": the user's own words about the style, which cleanup
 * follows. Typed or dictated (Say it); saved when the box loses focus.
 */
function StyleDescription({
  style,
  onSave,
}: {
  style: WritingStyle;
  onSave: (description: string) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useCaptureSettings();
  const [text, setText] = useState(style.description);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(style.description), [style.description]);

  const save = (next: string) => {
    if (next.trim() !== style.description) onSave(next.trim());
  };
  // A take from the Say it button lands in Captures; its cleanup joins the box.
  const dictation = useTeachDictation(() => {
    void apiClient
      .listCaptures(1)
      .then(({ items }) => {
        const said = (items[0]?.transcript_refined || items[0]?.transcript_raw || '').trim();
        if (!said) return;
        const current = box.current?.value ?? text;
        const next = `${current.trim() ? `${current.trimEnd()} ` : ''}${said}`.slice(
          0,
          MAX_DESCRIPTION,
        );
        setText(next);
        save(next);
      })
      .catch(() => undefined);
  });
  const listening = dictation.state.phase === 'listening' && dictation.state.how === 'button';
  const hold = settings?.chord_push_to_talk_keys ?? [];

  return (
    <SettingRow
      title={t(`${S}.description`)}
      description={t(`${S}.descriptionHelp`)}
      htmlFor="styleDescription"
      action={
        dictation.available && (
          <Button
            size="sm"
            variant={listening ? 'default' : 'outline'}
            className="gap-2"
            disabled={dictation.state.phase === 'cleaning'}
            onClick={() => {
              if (listening) return dictation.stop();
              box.current?.focus();
              dictation.start();
            }}
          >
            {listening ? (
              <Square className="h-3 w-3 fill-current" />
            ) : (
              <Mic className="h-3.5 w-3.5 text-accent" />
            )}
            {listening ? t(`${S}.descriptionStop`) : t(`${S}.descriptionSay`)}
            {!listening && hold.length > 0 && <ChordKeys keys={hold} />}
          </Button>
        )
      }
    >
      <textarea
        id="styleDescription"
        ref={box}
        value={text}
        maxLength={MAX_DESCRIPTION}
        rows={4}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => save(text)}
        placeholder={t(`${S}.descriptionPlaceholder`)}
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-accent"
      />
      <p className="mt-1 text-right font-mono text-[11px] text-muted-foreground">
        {text.length} / {MAX_DESCRIPTION}
      </p>
    </SettingRow>
  );
}

function DeleteStyle({ style, onDeleted }: { style: WritingStyle; onDeleted: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => apiClient.deleteWritingStyle(style.id),
    onSuccess: () => {
      onDeleted();
      queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
      queryClient.invalidateQueries({ queryKey: ['captures', 'apps'] });
      queryClient.invalidateQueries({ queryKey: ['personal-examples'] });
    },
    onError: (error: Error) =>
      toast({ title: t(`${S}.deleteFailed`), description: error.message, variant: 'destructive' }),
  });
  return (
    <SettingRow
      title={t(`${S}.delete`, { style: style.name })}
      description={t(`${S}.deleteDescription`)}
      action={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={remove.isPending}
            >
              {t(`${S}.deleteAction`)}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t(`${S}.deleteConfirmTitle`, { style: style.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t(`${S}.deleteDescription`)}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove.mutate()}
              >
                {t(`${S}.deleteAction`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
