import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateCheck } from '@/lib/hooks/useUpdateCheck';
import { SettingRow } from './SettingRow';

type UpdateChannel = 'stable' | 'beta';

/**
 * Opt in to beta releases (tauri src-tauri/src/updater.rs). Turning it off
 * keeps an installed beta until a public release is newer.
 */
export function BetaUpdatesRow() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { version } = useUpdateCheck();
  const [channel, setChannel] = useState<UpdateChannel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<UpdateChannel>('update_channel')
      .then(setChannel)
      .catch((err) => console.warn('[update] channel failed:', err));
  }, []);

  const onCheckedChange = async (beta: boolean) => {
    setSaving(true);
    try {
      setChannel(
        await invoke<UpdateChannel>('set_update_channel', { channel: beta ? 'beta' : 'stable' }),
      );
    } catch (error) {
      toast({
        title: t('settings.general.betaUpdates.failed'),
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const onBetaVersion = version.includes('-beta.');
  return (
    <SettingRow
      title={t('settings.general.betaUpdates.title')}
      description={
        channel === 'stable' && onBetaVersion
          ? t('settings.general.betaUpdates.leaving', { version })
          : t('settings.general.betaUpdates.description')
      }
      htmlFor="betaUpdates"
      action={
        <Toggle
          id="betaUpdates"
          checked={channel === 'beta'}
          disabled={saving || channel === null}
          onCheckedChange={onCheckedChange}
        />
      }
    />
  );
}
