import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
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
import { RETENTION_CHOICES } from './HistoryRetentionRow';

const P = 'settings.captures.storage.retention';
const WINDOWS = RETENTION_CHOICES.filter((choice) => choice.days !== 0);

// Module scope so it asks once per launch, not once per mount.
let asked = false;

/**
 * Asks at launch before history retention first deletes anything
 * (docs/plans/HISTORY_RETENTION.md). The server deletes nothing until a
 * window is saved; any choice here saves one. "Not now" saves nothing, so
 * it asks again next launch. With nothing old to delete the server confirms
 * by itself and this never opens.
 */
export function RetentionAskDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { update } = useCaptureSettings();
  const { data: status } = useQuery({
    queryKey: ['settings', 'retention-status'],
    queryFn: () => apiClient.getRetentionStatus(),
    staleTime: Infinity,
    enabled: !asked,
  });
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<HistoryRetentionDays>(30);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (asked || !status) return;
    asked = true;
    if (status.confirmed || status.expiring === 0) return;
    setDays(status.days === 0 ? 30 : status.days);
    setCount(status.expiring);
    setOpen(true);
  }, [status]);

  const label = (value: HistoryRetentionDays) =>
    t(`${P}.${RETENTION_CHOICES.find((c) => c.days === value)?.key ?? 'd30'}`);

  const pick = (value: HistoryRetentionDays) => {
    setDays(value);
    setCount(null);
    apiClient
      .getRetentionPreview(value)
      .then((preview) => setCount(preview.expiring))
      .catch(() => setCount(null));
  };

  const save = (value: HistoryRetentionDays) => {
    update(
      { history_retention_days: value },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['captures'] }) },
    );
    setOpen(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${P}.ask.title`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {count === null
              ? t(`${P}.ask.counting`)
              : t(`${P}.ask.description`, { count, window: label(days) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">{t(`${P}.ask.choose`)}</span>
          <Select
            value={String(days)}
            onValueChange={(v) => pick(Number(v) as HistoryRetentionDays)}
          >
            <SelectTrigger className="h-8 w-[160px]" aria-label={t(`${P}.ask.choose`)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((choice) => (
                <SelectItem key={choice.days} value={String(choice.days)}>
                  {t(`${P}.${choice.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t(`${P}.ask.later`)}
          </Button>
          <Button variant="outline" onClick={() => save(0)}>
            {t(`${P}.ask.forever`)}
          </Button>
          <Button
            variant="destructive"
            className="font-semibold"
            disabled={count === null}
            onClick={() => save(days)}
          >
            {t(`${P}.ask.keep`, { count: count ?? 0, window: label(days) })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
