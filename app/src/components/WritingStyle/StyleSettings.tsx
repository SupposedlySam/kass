import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useWritingStyle, WRITING_STYLES_KEY } from '@/lib/hooks/useWritingStyle';

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
 * The selected style's settings: its name, how it punctuates and capitalizes,
 * filler and technical terms, whether new apps use it, and deleting it.
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
        title={t(`${S}.capitalize`)}
        description={t(`${S}.capitalizeDescription`)}
        htmlFor="capitalizeFirst"
        action={
          <Toggle
            id="capitalizeFirst"
            checked={style.capitalize_first}
            onCheckedChange={(v) => update.mutate({ capitalize_first: v })}
          />
        }
      />
      <SettingRow
        title={t(`${S}.filler`)}
        description={t(`${R}.smartCleanup.description`)}
        htmlFor="smartCleanup"
        action={
          <Toggle
            id="smartCleanup"
            checked={style.smart_cleanup}
            onCheckedChange={(v) => update.mutate({ smart_cleanup: v })}
          />
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
