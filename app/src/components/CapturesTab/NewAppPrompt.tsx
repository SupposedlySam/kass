import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMoveApp } from '@/components/WritingStyle/MoveAppDialog';
import type { WritingStyle } from '@/lib/api/types';

/**
 * Under an app's newest capture until the user confirms its style: "New app.
 * Use Code for Zed?", suggesting the style most apps of its App Store
 * category use, or any other.
 */
export function NewAppPrompt({
  bundleId,
  name,
  suggested,
  styles,
}: {
  bundleId: string;
  name: string;
  suggested: WritingStyle;
  styles: WritingStyle[];
}) {
  const { t } = useTranslation();
  const mover = useMoveApp();
  const choose = (styleId: string) => mover.move({ bundle_id: bundleId, name }, styleId);

  return (
    <div className="flex items-center gap-2 px-3 pb-3 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">
        {t('captures.apps.prompt', { style: suggested.name, app: name })}
      </span>
      <Button
        size="sm"
        className="h-[26px] shrink-0 px-2.5 text-xs font-semibold"
        disabled={mover.isPending}
        onClick={() => choose(suggested.id)}
      >
        {t('captures.apps.use', { style: suggested.name })}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-[26px] shrink-0 gap-1 px-2.5 text-xs"
            disabled={mover.isPending}
          >
            {t('captures.apps.pickAnother')}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {styles
            .filter((style) => style.id !== suggested.id)
            .map((style) => (
              <DropdownMenuItem key={style.id} onSelect={() => choose(style.id)}>
                {style.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {mover.dialog}
    </div>
  );
}
