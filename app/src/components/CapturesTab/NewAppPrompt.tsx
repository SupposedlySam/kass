import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useMoveApp } from '@/components/WritingStyle/MoveAppDialog';
import { apiClient } from '@/lib/api/client';
import type { WritingStyle } from '@/lib/api/types';
import { useWritingStyles, WRITING_STYLES_KEY } from '@/lib/hooks/useWritingStyle';

/**
 * Under an app's newest capture until the user confirms its style: "New app.
 * Use Code for Zed?", suggesting the style most apps of its App Store
 * category use, any other, or a new one named in place.
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
  const { data } = useWritingStyles();
  const [naming, setNaming] = useState(false);
  // Keeps the menu from pulling focus back to its trigger over the name field.
  const startedNaming = useRef(false);
  const choose = (styleId: string) => mover.move({ bundle_id: bundleId, name }, styleId);
  const others = styles.filter((style) => style.id !== suggested.id);
  const full = !!data && data.styles.length >= data.max_styles;

  if (naming) {
    return (
      <NewStyleField
        onCancel={() => setNaming(false)}
        onCreated={(styleId) => {
          setNaming(false);
          choose(styleId);
        }}
      />
    );
  }

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
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (startedNaming.current) event.preventDefault();
            startedNaming.current = false;
          }}
        >
          {others.map((style) => (
            <DropdownMenuItem key={style.id} onSelect={() => choose(style.id)}>
              {style.name}
            </DropdownMenuItem>
          ))}
          {others.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            disabled={full}
            onSelect={() => {
              startedNaming.current = true;
              setNaming(true);
            }}
          >
            <Plus className="size-3.5" />
            {t('writingStyle.styles.new')}
          </DropdownMenuItem>
          {full && (
            <p className="max-w-56 px-2 py-1.5 text-[11.5px] text-muted-foreground">
              {t('writingStyle.styles.limit', { count: data.max_styles })}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mover.dialog}
    </div>
  );
}

/** Names a new style in place of the prompt. Enter adds it; Escape or leaving it empty cancels. */
function NewStyleField({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (styleId: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const create = useMutation({
    mutationFn: (styleName: string) => apiClient.createWritingStyle(styleName),
    onSuccess: async (style) => {
      await queryClient.invalidateQueries({ queryKey: WRITING_STYLES_KEY });
      onCreated(style.id);
    },
    onError: (error: Error) =>
      toast({
        title: t('writingStyle.styles.createFailed'),
        description: error.message,
        variant: 'destructive',
      }),
  });
  const submit = () => {
    if (value.trim()) create.mutate(value.trim());
  };

  return (
    <form
      className="flex items-center gap-2 px-3 pb-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        autoFocus
        value={value}
        maxLength={40}
        disabled={create.isPending}
        placeholder={t('writingStyle.styles.namePlaceholder')}
        aria-label={t('writingStyle.styles.nameLabel')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={() => {
          if (!value.trim() && !create.isPending) onCancel();
        }}
        className="h-[26px] min-w-0 flex-1 text-xs"
      />
      <Button
        type="submit"
        size="sm"
        className="h-[26px] shrink-0 px-2.5 text-xs font-semibold"
        disabled={!value.trim() || create.isPending}
      >
        {t('writingStyle.styles.add')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-[26px] shrink-0 px-2.5 text-xs"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCancel}
      >
        {t('common.cancel')}
      </Button>
    </form>
  );
}
