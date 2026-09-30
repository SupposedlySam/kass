import { RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUpdateCheck } from '@/lib/hooks/useUpdateCheck';
import { version } from '../../../package.json';
import { SettingRow } from './SettingRow';

/** The installed version, and a restart into a newer one once it has downloaded. */
export function VersionRow() {
  const { t } = useTranslation();
  const { status, restart } = useUpdateCheck();

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
          <Button variant="outline" size="sm" onClick={() => void restart()}>
            <RotateCw className="h-3.5 w-3.5" />
            {t('settings.general.version.restart')}
          </Button>
        )
      }
    />
  );
}
