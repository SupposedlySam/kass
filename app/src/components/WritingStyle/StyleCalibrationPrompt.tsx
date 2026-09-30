import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useWritingStyle } from '@/lib/hooks/useWritingStyle';
import { TeachDialog } from './teach/TeachDialog';

const DISMISSED_KEY = 'kass.writingStyle.promptDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * First-run invitation to teach Kass how the user writes, shown once they
 * have dictated and until they teach it or dismiss it. Never blocks dictating.
 */
export function StyleCalibrationPrompt({ hasCaptures }: { hasCaptures: boolean }) {
  const { t } = useTranslation();
  const { data: status } = useWritingStyle();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private windows can refuse storage; it just shows again next time.
    }
  };

  const show = hasCaptures && status !== undefined && status.runs === 0 && !dismissed;
  return (
    <>
      {show && (
        <div className="mx-1 mb-3 space-y-2 rounded-lg border border-accent/20 bg-accent/[0.04] p-3.5">
          <p className="text-sm font-medium">{t('writingStyle.prompt.title')}</p>
          <p className="text-xs text-muted-foreground">{t('writingStyle.prompt.description')}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setOpen(true)}>
              {t('writingStyle.prompt.start')}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              {t('writingStyle.prompt.dismiss')}
            </Button>
          </div>
        </div>
      )}
      <TeachDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
