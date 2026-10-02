import { useTranslation } from 'react-i18next';
import { Toggle } from '@/components/ui/toggle';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { SettingRow } from './SettingRow';

/** Whether Kass sends anonymous daily usage counts (backend/services/usage_report.py). */
export function ShareUsageRow() {
  const { t } = useTranslation();
  const { settings, update } = useCaptureSettings();

  return (
    <SettingRow
      title={t('settings.general.shareUsage.title')}
      description={t('settings.general.shareUsage.description')}
      htmlFor="shareUsage"
      action={
        <Toggle
          id="shareUsage"
          checked={settings?.share_usage ?? true}
          disabled={!settings}
          onCheckedChange={(v) => update({ share_usage: v })}
        />
      }
    />
  );
}
