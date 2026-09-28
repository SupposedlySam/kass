import { useTranslation } from 'react-i18next';
import { AppTile } from './CaptureAppList';

/** The card above one app's captures: its icon, name and how many dictations it has. */
export function CaptureAppHeader({
  bundleId,
  name,
  count,
}: {
  bundleId: string;
  name: string;
  count: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      <AppTile bundleId={bundleId} name={name} className="size-8 rounded-lg text-sm" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {t('captures.apps.dictations', { count, formatted: count.toLocaleString() })}
        </p>
      </div>
    </div>
  );
}
