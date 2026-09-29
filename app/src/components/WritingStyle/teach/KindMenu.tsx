import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { TeachKind } from '@/lib/api/types';
import { groupKinds, KIND_ICONS } from './kinds';

const T = 'writingStyle.teach';

/**
 * The kinds of conversation, the style's own first. Shared by "Add a
 * conversation" and the header's kind picker, which checks `current`.
 */
export function KindMenuItems({
  suggested,
  current,
  onPick,
}: {
  suggested: TeachKind[];
  current?: TeachKind;
  onPick: (kind: TeachKind) => void;
}) {
  const { t } = useTranslation();
  const { own, other } = groupKinds(suggested);
  const item = (kind: TeachKind) => {
    const Icon = KIND_ICONS[kind];
    return (
      <DropdownMenuItem key={kind} className="gap-2.5" onSelect={() => onPick(kind)}>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1">{t(`${T}.kinds.${kind}.label`)}</span>
        {kind === current && <Check className="h-3.5 w-3.5 text-accent" />}
      </DropdownMenuItem>
    );
  };
  return (
    <>
      {own.length > 0 && (
        <>
          <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {t(`${T}.kindsOwn`)}
          </DropdownMenuLabel>
          {own.map(item)}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {own.length > 0 ? t(`${T}.kindsOther`) : t(`${T}.kindsAll`)}
      </DropdownMenuLabel>
      {other.map(item)}
    </>
  );
}
