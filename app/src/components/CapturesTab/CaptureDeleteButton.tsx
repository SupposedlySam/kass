import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { CaptureResponse } from '@/lib/api/types';
import { DICTIONARY_KEY } from '@/lib/hooks/useDictionary';
import { WRITING_STYLE_KEY } from '@/lib/hooks/useWritingStyle';
import { cn } from '@/lib/utils/cn';
import { isInOverlay, isTypingTarget } from './captureFormat';

/** Whether the capture is a voice edit (backend voice_edits.TRANSFORM_NAME). */
export function isVoiceEdit(capture: CaptureResponse) {
  return capture.command_transform === 'Voice edit';
}

/**
 * Delete ⌫, a trash button in the capture's header. The key works whenever
 * focus isn't in a text field or an open overlay. Deleting a voice edit
 * also takes back what it taught. A second button for the same capture,
 * like the one on a voice edit's card, leaves the key to the header's.
 */
export function CaptureDeleteButton({
  capture,
  shortcut = true,
  className,
}: {
  capture: CaptureResponse;
  shortcut?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (captureId: string) => apiClient.deleteCapture(captureId),
    onSuccess: () => {
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ['captures'] });
      // What the capture taught is gone too: its corrections (a voice edit's
      // is on the take it fixed), and any word it spelled.
      queryClient.invalidateQueries({ queryKey: ['capture-feedback'] });
      queryClient.invalidateQueries({ queryKey: WRITING_STYLE_KEY });
      queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY });
    },
    onError: (err: Error) => {
      toast({
        title: t('captures.toast.deleteFailed'),
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey) return;
      if (isTypingTarget(event.target) || isInOverlay(event.target)) return;
      if (event.metaKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 'backspace' || key === 'delete') {
        event.preventDefault();
        setDeleteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcut]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
          className,
        )}
        aria-label={t('captures.actions.delete')}
        title={shortcut ? `${t('captures.actions.delete')} ⌫` : t('captures.actions.delete')}
        onClick={() => setDeleteOpen(true)}
        disabled={deleteMutation.isPending}
      >
        {deleteMutation.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
      </Button>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('captures.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                isVoiceEdit(capture)
                  ? 'captures.deleteDialog.voiceEditDescription'
                  : 'captures.deleteDialog.description',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(capture.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending
                  ? t('captures.deleteDialog.deleting')
                  : t('common.delete')}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
