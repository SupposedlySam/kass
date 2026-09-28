import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SettingRow } from '@/components/ServerTab/SettingRow';
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
import { apiClient } from '@/lib/api/client';
import type { WritingStyle } from '@/lib/api/types';
import {
  useWritingStyle,
  WRITING_STYLE_KEY,
  WRITING_STYLES_KEY,
} from '@/lib/hooks/useWritingStyle';
import { CORRECTION_NOTES_KEY } from './CorrectionNotes';
import { PERSONAL_EXAMPLES_KEY } from './PersonalExamples';

/** Forgets one style's calibration, learned habits and rules, after a confirmation. */
export function ResetWritingStyle({ style }: { style: WritingStyle }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status } = useWritingStyle(style.id);
  const reset = useMutation({
    mutationFn: async () => {
      const result = await apiClient.resetWritingStyle(style.id);
      // Nothing is left to match, so the style falls back to Standard.
      if (style.punctuation_style === 'learned') {
        await apiClient.updateWritingStyle(style.id, { punctuation_style: 'standard' });
      }
      return result;
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...WRITING_STYLE_KEY, style.id], data);
      queryClient.invalidateQueries({ queryKey: PERSONAL_EXAMPLES_KEY });
      queryClient.invalidateQueries({ queryKey: CORRECTION_NOTES_KEY });
      queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
    },
  });

  // Nothing to forget until something has been learned.
  if (!status?.ready && !status?.runs) return null;

  return (
    <SettingRow
      title={t('writingStyle.settings.reset.title', { style: style.name })}
      description={t('writingStyle.settings.reset.description', { style: style.name })}
      action={
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={reset.isPending}
            >
              {t('writingStyle.settings.reset.action')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('writingStyle.settings.reset.confirmTitle', { style: style.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('writingStyle.settings.reset.description', { style: style.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => reset.mutate()}
              >
                {t('writingStyle.settings.reset.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    />
  );
}
