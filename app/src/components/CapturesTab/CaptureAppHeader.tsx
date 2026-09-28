import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMoveApp } from '@/components/WritingStyle/MoveAppDialog';
import { AppTile } from './CaptureAppList';
import type { AppStyles } from './useAppStyles';

/**
 * The card above one app's captures: its icon, name, how many dictations it
 * has, and the style its dictation uses. Picking a style there assigns the
 * app to it, which also confirms a new app's style.
 */
export function CaptureAppHeader({
  bundleId,
  name,
  count,
  appStyles,
}: {
  bundleId: string;
  name: string;
  count: number;
  appStyles: AppStyles;
}) {
  const { t } = useTranslation();
  const mover = useMoveApp();
  const current = appStyles.forApp(bundleId);
  const formatted = count.toLocaleString();

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      <AppTile bundleId={bundleId} name={name} className="size-8 rounded-lg text-sm" />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          {current
            ? t('captures.apps.dictationsTeach', { count, formatted, style: current.style.name })
            : t('captures.apps.dictations', { count, formatted })}
        </p>
      </div>
      {current && (
        <Select
          value={current.confirmed ? current.style.id : ''}
          onValueChange={(styleId) => mover.move({ bundle_id: bundleId, name }, styleId)}
        >
          <SelectTrigger
            className="h-[30px] w-auto max-w-[140px] shrink-0 gap-2 bg-background text-[12.5px]"
            aria-label={t('captures.apps.styleFor', { app: name })}
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
            <SelectValue
              placeholder={t('captures.apps.suggested', { style: current.style.name })}
            />
          </SelectTrigger>
          <SelectContent align="end">
            {appStyles.styles.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {mover.dialog}
    </div>
  );
}
