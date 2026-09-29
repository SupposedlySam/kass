import { invoke } from '@tauri-apps/api/core';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/use-toast';
import { SettingRow } from './SettingRow';

type LaunchAtLoginStatus = 'enabled' | 'disabled' | 'requires_approval' | 'unavailable';

/**
 * Launch at login, as macOS reports it. The system's login item is the only
 * record, so the status is re-read on window focus to pick up changes made
 * in System Settings › Login Items.
 */
export function LaunchAtLoginRow() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [status, setStatus] = useState<LaunchAtLoginStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const recheck = useCallback(() => {
    invoke<LaunchAtLoginStatus>('launch_at_login_status')
      .then(setStatus)
      .catch((err) => console.warn('[launch-at-login] status failed:', err));
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  const onCheckedChange = async (enabled: boolean) => {
    setSaving(true);
    try {
      setStatus(await invoke<LaunchAtLoginStatus>('set_launch_at_login', { enabled }));
    } catch (error) {
      toast({
        title: t('settings.general.launchAtLogin.failed'),
        description: String(error),
        variant: 'destructive',
      });
      recheck();
    } finally {
      setSaving(false);
    }
  };

  const openLoginItems = () => {
    invoke('open_login_items_settings').catch((err) =>
      console.warn('[launch-at-login] open settings failed:', err),
    );
  };

  let description: string = t('settings.general.launchAtLogin.description');
  if (status === 'unavailable') description = t('settings.general.launchAtLogin.unavailable');
  if (status === 'requires_approval') {
    description = t('settings.general.launchAtLogin.requiresApproval');
  }

  return (
    <SettingRow
      title={t('settings.general.launchAtLogin.title')}
      description={description}
      htmlFor="launchAtLogin"
      action={
        status === 'requires_approval' ? (
          <Button variant="outline" size="sm" onClick={openLoginItems}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t('settings.general.launchAtLogin.openLoginItems')}
          </Button>
        ) : (
          <Toggle
            id="launchAtLogin"
            checked={status === 'enabled'}
            disabled={saving || status === null || status === 'unavailable'}
            onCheckedChange={onCheckedChange}
          />
        )
      }
    />
  );
}
