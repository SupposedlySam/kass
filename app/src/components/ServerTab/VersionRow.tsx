import { ArrowUpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useUpdateCheck } from '@/lib/hooks/useUpdateCheck';
import { usePlatform } from '@/platform/PlatformContext';
import { version } from '../../../package.json';
import { SettingRow } from './SettingRow';

/** The installed version, and a download button when a newer release is out. */
export function VersionRow() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const update = useUpdateCheck();

  return (
    <SettingRow
      title={t('settings.general.version.title')}
      description={
        update
          ? t('settings.general.version.available', { current: version, latest: update.version })
          : t('settings.general.version.current', { version })
      }
      action={
        update && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => platform.filesystem.openPath(update.url)}
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            {t('settings.general.version.download', { latest: update.version })}
          </Button>
        )
      }
    />
  );
}
