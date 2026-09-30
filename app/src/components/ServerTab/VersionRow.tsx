import { Loader2, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUpdateCheck } from '@/lib/hooks/useUpdateCheck';
import { SettingRow } from './SettingRow';

/** The installed version, and a restart into a newer one once it has downloaded. */
export function VersionRow() {
  const { t } = useTranslation();
  const { version, status, restarting, restart } = useUpdateCheck();

  return (
    <SettingRow
      title={t('settings.general.version.title')}
      description={
        status.state === 'ready'
          ? t('settings.general.version.ready', { current: version, latest: status.version })
          : status.state === 'downloading'
            ? t('settings.general.version.downloading', {
                current: version,
                latest: status.version,
              })
            : t('settings.general.version.current', { version })
      }
      action={
        status.state === 'ready' && (
          <Button variant="outline" size="sm" disabled={restarting} onClick={restart}>
            {restarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            {restarting
              ? t('settings.general.version.restarting')
              : t('settings.general.version.restart')}
          </Button>
        )
      }
    />
  );
}
