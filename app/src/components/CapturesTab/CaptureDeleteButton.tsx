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
import { isInOverlay, isTypingTarget } from './captureFormat';

/**
 * Delete ⌫, a trash button in the capture's header. The key works whenever
 * focus isn't in a text field or an open overlay.
 */
export function CaptureDeleteButton({ capture }: { capture: CaptureResponse }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: (captureId: string) => apiClient.deleteCapture(captureId),
    onSuccess: () => {
      setDeleteOpen(false);
      queryClient.invalidateQueries({ queryKey: ['captures'] });
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
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={t('captures.actions.delete')}
        title={`${t('captures.actions.delete')} ⌫`}
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
              {t('captures.deleteDialog.description')}
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
