import { useTranslation } from 'react-i18next';
import { Toggle } from '@/components/ui/toggle';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { SettingRow } from './SettingRow';

const P = 'settings.captures.storage.recordings';

/**
 * Whether captures keep their voice recordings (backend/services/audio_retention.py).
 * Deleting them keeps the text.
 */
export function RecordingRetentionRow() {
  const { t } = useTranslation();
  const { settings, update } = useCaptureSettings();

  return (
    <SettingRow
      title={t(`${P}.title`)}
      description={t(`${P}.description`)}
      htmlFor="discardAudio"
      action={
        <Toggle
          id="discardAudio"
          checked={settings?.discard_audio ?? false}
          disabled={!settings}
          onCheckedChange={(v) => update({ discard_audio: v })}
        />
      }
    />
  );
}
