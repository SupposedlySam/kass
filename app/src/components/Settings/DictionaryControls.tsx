import { ArrowRight, ChevronDown, Globe } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcon } from '@/components/CapturesTab/AppIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils/cn';
import { allOptions, type ScopeOption, type ScopeOptions } from './dictionaryScopes';

/** Controls the Dictionary page shares with "Add to dictionary" in Captures. */

const P = 'dictionary';
/** Matches the server's limits. */
export const MAX_LENGTH = 200;

/** Small monospace label, like the section headings in the rest of Settings. */
export const MONO_LABEL =
  'font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
export function useScopeLabel() {
  const { t } = useTranslation();
  return (option: ScopeOption) => option.name || t(`${P}.scope.everywhere`);
}

export function ScopeIcon({ option, className }: { option: ScopeOption; className?: string }) {
  const initial = (option.name.trim()[0] ?? '?').toUpperCase();
  if (option.scope.kind === 'global') {
    return <Globe className={cn('size-3.5 shrink-0 text-muted-foreground', className)} />;
  }
  if (option.scope.kind === 'style') {
    return (
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-muted-foreground/60 font-mono text-[8px] leading-none text-muted-foreground',
          className,
        )}
      >
        {initial}
      </span>
    );
  }
  return (
    <AppIcon
      bundleId={option.scope.bundleId}
      className={className}
      fallback={
        <span
          aria-hidden
          className={cn(
            'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] bg-muted-foreground/70 font-mono text-[8px] leading-none text-background',
            className,
          )}
        >
          {initial}
        </span>
      }
    />
  );
}

export function submitKeys(onSubmit: () => void, onCancel?: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
}

export function Arrow({ amber }: { amber?: boolean }) {
  return (
    <ArrowRight
      aria-hidden
      className={cn('size-3.5 shrink-0', amber ? 'text-accent' : 'text-muted-foreground/60')}
    />
  );
}

/** "Applies in": pick one or more places. Everywhere clears the rest. */
export function PlacesMenu({
  selected,
  onToggle,
  options,
  viewedFrom,
}: {
  selected: string[];
  onToggle: (key: string) => void;
  options: ScopeOptions;
  /** The scope the entry is seen from; for an app, its style row says the app uses it. */
  viewedFrom?: ScopeOption;
}) {
  const { t } = useTranslation();
  const label = useScopeLabel();
  const chosen = allOptions(options).filter((o) => selected.includes(o.key));
  const appStyleKey =
    viewedFrom?.scope.kind === 'app' && viewedFrom.styleId ? `style:${viewedFrom.styleId}` : null;

  let trigger: ReactNode;
  if (chosen.length === 1) {
    trigger = (
      <>
        <ScopeIcon option={chosen[0]} />
        <span className="truncate">{label(chosen[0])}</span>
      </>
    );
  } else if (selected.length === 0) {
    trigger = <span className="text-muted-foreground">{t(`${P}.list.noPlaces`)}</span>;
  } else {
    trigger = <span>{t(`${P}.list.places`, { count: selected.length })}</span>;
  }

  const item = (option: ScopeOption) => (
    <DropdownMenuCheckboxItem
      key={option.key}
      checked={selected.includes(option.key)}
      onSelect={(event) => {
        // Keep the menu open while toggling.
        event.preventDefault();
        onToggle(option.key);
      }}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ScopeIcon option={option} />
        <span className="truncate">{label(option)}</span>
        {option.key === appStyleKey && (
          <span className="ml-auto shrink-0 pl-3 text-[11px] text-muted-foreground">
            {t(`${P}.list.appUsesStyle`, { app: viewedFrom?.name })}
          </span>
        )}
      </span>
    </DropdownMenuCheckboxItem>
  );
  const heading = (text: string) => (
    <DropdownMenuLabel className={cn(MONO_LABEL, 'pt-2 pb-1 font-medium')}>
      {text}
    </DropdownMenuLabel>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 max-w-[220px] gap-1.5 px-2 text-[13px] font-normal"
        >
          {trigger}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[260px] max-h-[360px] overflow-y-auto">
        {item(options.everywhere)}
        {options.styles.length > 0 && heading(t(`${P}.scope.styles`))}
        {options.styles.map(item)}
        {options.apps.length > 0 && heading(t(`${P}.scope.apps`))}
        {options.apps.map(item)}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          {t(`${P}.list.everywhereClears`)}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
