import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { MovedCorrections, StyledApp } from '@/lib/api/types';
import {
  defaultStyle,
  stylesById,
  useAssignAppStyle,
  useWritingStyles,
} from '@/lib/hooks/useWritingStyle';

interface PendingMove {
  app: StyledApp;
  styleId: string;
}

/**
 * Move an app to another style, by drag or by menu. When the app has
 * corrections teaching its current style, a dialog asks whether they come
 * along or stay; without any, the app just moves. Render `dialog` once.
 */
export function useMoveApp(): {
  move: (app: Pick<StyledApp, 'bundle_id' | 'name'>, styleId: string) => void;
  dialog: ReactNode;
  isPending: boolean;
} {
  const { t } = useTranslation();
  const assign = useAssignAppStyle();
  const { data } = useWritingStyles();
  const [pending, setPending] = useState<PendingMove | null>(null);
  const byId = stylesById(data);

  const move = (app: Pick<StyledApp, 'bundle_id' | 'name'>, styleId: string) => {
    const known = data?.apps.find((a) => a.bundle_id === app.bundle_id);
    const current = known?.style_id ?? defaultStyle(data)?.id;
    if (current === styleId) {
      // Already there: choosing it only confirms a new app's style.
      if (!known?.confirmed) assign.mutate({ app, styleId });
      return;
    }
    if (known && known.corrections > 0) setPending({ app: known, styleId });
    else assign.mutate({ app, styleId });
  };

  const choose = (corrections: MovedCorrections) => {
    if (pending) assign.mutate({ app: pending.app, styleId: pending.styleId, corrections });
    setPending(null);
  };

  const app = pending ? pending.app.name || pending.app.bundle_id : '';
  const from = pending ? (byId.get(pending.app.style_id)?.name ?? '') : '';
  const to = pending ? (byId.get(pending.styleId)?.name ?? '') : '';
  const count = pending?.app.corrections ?? 0;

  const dialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('writingStyle.styles.moveDialog.title', { app, to })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('writingStyle.styles.moveDialog.description', { app, from, to, count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="outline" onClick={() => choose('leave')}>
            {t('writingStyle.styles.moveDialog.leave', { from })}
          </Button>
          <Button className="font-semibold" onClick={() => choose('bring')}>
            {t('writingStyle.styles.moveDialog.bring', { count, to })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { move, dialog, isPending: assign.isPending };
}
