import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import type { HistoryRetentionDays } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { SettingRow } from './SettingRow';

const P = 'settings.captures.storage.retention';

export const RETENTION_CHOICES: Array<{ days: HistoryRetentionDays; key: string }> = [
  { days: 7, key: 'd7' },
  { days: 30, key: 'd30' },
  { days: 90, key: 'd90' },
  { days: 365, key: 'd365' },
  { days: 0, key: 'forever' },
];

/** Whether keeping `next` days deletes captures `current` keeps. 0 is forever. */
function isShorter(next: HistoryRetentionDays, current: HistoryRetentionDays): boolean {
  return next !== 0 && (current === 0 || next < current);
}

/**
 * How long captures are kept (docs/plans/HISTORY_RETENTION.md). Shortening
 * the window asks first when it would delete captures, saying how many.
 */
export function HistoryRetentionRow() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings, update } = useCaptureSettings();
  const [pending, setPending] = useState<{ days: HistoryRetentionDays; count: number } | null>(
    null,
  );
  const current = settings?.history_retention_days ?? 30;
  const label = (days: HistoryRetentionDays) =>
    t(`${P}.${RETENTION_CHOICES.find((c) => c.days === days)?.key ?? 'd30'}`);

  const save = (days: HistoryRetentionDays) =>
    update(
      { history_retention_days: days },
      // The server deletes what the new window drops before it answers.
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['captures'] }) },
    );

  const choose = async (days: HistoryRetentionDays) => {
    if (!isShorter(days, current)) return save(days);
    const { expiring } = await apiClient.getRetentionPreview(days).catch(() => ({ expiring: -1 }));
    if (expiring === 0) save(days);
    else setPending({ days, count: expiring });
  };

  return (
    <>
      <SettingRow
        title={t(`${P}.title`)}
        description={t(`${P}.description`)}
        action={
          <Select
            value={String(current)}
            onValueChange={(v) => choose(Number(v) as HistoryRetentionDays)}
          >
            <SelectTrigger className="h-8 w-[160px]" aria-label={t(`${P}.title`)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_CHOICES.map((choice) => (
                <SelectItem key={choice.days} value={String(choice.days)}>
                  {t(`${P}.${choice.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`${P}.confirm.title`, { window: pending ? label(pending.days) : '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending && pending.count > 0
                ? t(`${P}.confirm.description`, {
                    count: pending.count,
                    window: label(pending.days),
                  })
                : t(`${P}.confirm.unknown`, { window: pending ? label(pending.days) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              className="font-semibold"
              onClick={() => {
                if (pending) save(pending.days);
                setPending(null);
              }}
            >
              {pending && pending.count > 0
                ? t(`${P}.confirm.delete`, { count: pending.count })
                : t(`${P}.confirm.deleteUnknown`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
