import { useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppIcon } from '@/components/CapturesTab/AppIcon';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import type { DictionaryEntry, ResolvedDictionaryEntry } from '@/lib/api/types';
import {
  useAddDictionaryEntry,
  useDeleteDictionaryEntry,
  useDictionary,
  useResolvedDictionary,
  useUpdateDictionaryEntry,
} from '@/lib/hooks/useDictionary';
import { stylesById, useWritingStyles } from '@/lib/hooks/useWritingStyle';
import { cn } from '@/lib/utils/cn';
import {
  buildScopeOptions,
  entriesIn,
  inheritedEntries,
  newEntry,
  type ScopeOption,
} from './dictionaryScopes';

const P = 'dictionary';
/** Matches the server's limits. */
const MAX_LENGTH = 200;
const MAX_ENTRIES = 1000;

/**
 * Dictionary: words dictation should get right, everywhere, in one writing
 * style or in one app (`?scope=`). The most specific entry wins.
 */
export function DictionaryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/settings/dictionary' });
  const { scope: scopeParam } = useSearch({ from: '/settings/dictionary' });
  const styles = useWritingStyles();
  const dictionary = useDictionary();

  if (!styles.data || !dictionary.data) {
    return (
      <div className="py-12 flex justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  const all = dictionary.data.entries;
  const options = buildScopeOptions(styles.data, all);
  const choices = [options.everywhere, ...options.styles, ...options.apps];
  // A deleted style or unknown key falls back to everywhere.
  const current = choices.find((o) => o.key === scopeParam) ?? options.everywhere;
  const label = (option: ScopeOption) => option.name || t(`${P}.scope.everywhere`);
  const select = (key: string) =>
    navigate({ search: key === options.everywhere.key ? {} : { scope: key }, replace: true });
  const entries = entriesIn(all, current.scope);
  const bundleId = current.scope.kind === 'app' ? current.scope.bundleId : null;
  const app = bundleId ? styles.data.apps.find((a) => a.bundle_id === bundleId) : undefined;

  return (
    <>
      <SettingSection title={t(`${P}.title`)} description={t(`${P}.description`)}>
        <SettingRow
          title={t(`${P}.scope.title`)}
          description={t(`${P}.scope.description`)}
          action={
            <Select value={current.key} onValueChange={select}>
              <SelectTrigger className="h-8 w-[240px]" aria-label={t(`${P}.scope.title`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <ScopeItem option={options.everywhere} label={label(options.everywhere)} />
                <SelectGroup>
                  <SelectLabel>{t(`${P}.scope.styles`)}</SelectLabel>
                  {options.styles.map((o) => (
                    <ScopeItem key={o.key} option={o} label={label(o)} />
                  ))}
                </SelectGroup>
                {options.apps.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t(`${P}.scope.apps`)}</SelectLabel>
                    {options.apps.map((o) => (
                      <ScopeItem key={o.key} option={o} label={label(o)} />
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          }
        />
      </SettingSection>

      <SettingSection title={t(`${P}.entries.title`, { scope: label(current) })}>
        {entries.length ? (
          entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
        ) : (
          <div className="py-3.5 space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p>{t(`${P}.empty.term`)}</p>
            <p>{t(`${P}.empty.replacement`)}</p>
          </div>
        )}
        <AddEntryRow
          key={current.key}
          option={current}
          appName={app?.name ?? (current.name || null)}
          full={all.length >= MAX_ENTRIES}
        />
      </SettingSection>

      {bundleId && (
        <InheritedEntries
          bundleId={bundleId}
          styleName={app ? stylesById(styles.data).get(app.style_id)?.name : undefined}
        />
      )}
    </>
  );
}

function ScopeItem({ option, label }: { option: ScopeOption; label: string }) {
  return (
    <SelectItem value={option.key}>
      <span className="flex items-center gap-2">
        {option.scope.kind === 'app' && <AppIcon bundleId={option.scope.bundleId} />}
        <span className="truncate">{label}</span>
        {option.count > 0 && (
          <span className="text-muted-foreground tabular-nums">{option.count}</span>
        )}
      </span>
    </SelectItem>
  );
}

/** What a failed add or edit says: the duplicate message, or the server's reason. */
function useErrorText() {
  const { t } = useTranslation();
  return (error: Error | null) => {
    if (!error) return null;
    if (error instanceof ApiError && error.status === 409) return t(`${P}.add.duplicate`);
    return error.message;
  };
}

/** The written form with, for a replacement, what the user says to get it. */
function EntryText({ entry, struck }: { entry: DictionaryEntry; struck?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 flex-1">
      <p className={cn('text-sm truncate', struck && 'line-through text-muted-foreground')}>
        {entry.written}
      </p>
      {entry.spoken && (
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {t(`${P}.entries.whenISay`, { spoken: entry.spoken })}
        </p>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: DictionaryEntry }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const remove = useDeleteDictionaryEntry();

  if (editing) return <EditEntryRow entry={entry} onDone={() => setEditing(false)} />;
  return (
    <div className="flex items-center gap-2 py-3">
      <EntryText entry={entry} />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
        aria-label={t(`${P}.entries.edit`, { written: entry.written })}
        onClick={() => setEditing(true)}
      >
        <Pencil />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground [&_svg]:size-3.5"
        aria-label={t(`${P}.entries.delete`, { written: entry.written })}
        disabled={remove.isPending}
        onClick={() => remove.mutate(entry.id)}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/** "Write" and "When I say" inputs, shared by adding and editing. Enter submits. */
function EntryInputs({
  written,
  spoken,
  onWritten,
  onSpoken,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  written: string;
  spoken: string;
  onWritten: (value: string) => void;
  onSpoken: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <>
      <Input
        value={written}
        onChange={(e) => onWritten(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t(`${P}.add.write`)}
        aria-label={t(`${P}.add.write`)}
        maxLength={MAX_LENGTH}
        autoFocus={autoFocus}
        className="h-8 flex-1"
      />
      <Input
        value={spoken}
        onChange={(e) => onSpoken(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t(`${P}.add.say`)}
        aria-label={t(`${P}.add.say`)}
        maxLength={MAX_LENGTH}
        className="h-8 flex-1"
      />
    </>
  );
}

function EditEntryRow({ entry, onDone }: { entry: DictionaryEntry; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const update = useUpdateDictionaryEntry();
  const [written, setWritten] = useState(entry.written);
  const [spoken, setSpoken] = useState(entry.spoken ?? '');

  const save = () => {
    const nextWritten = written.trim();
    const nextSpoken = spoken.trim() || null;
    if (!nextWritten || update.isPending) return;
    if (nextWritten === entry.written && nextSpoken === entry.spoken) return onDone();
    update.mutate(
      { id: entry.id, patch: { written: nextWritten, spoken: nextSpoken } },
      { onSuccess: onDone },
    );
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-2">
        <EntryInputs
          written={written}
          spoken={spoken}
          onWritten={setWritten}
          onSpoken={setSpoken}
          onSubmit={save}
          onCancel={onDone}
          autoFocus
        />
        <Button size="sm" disabled={!written.trim() || update.isPending} onClick={save}>
          {t(`${P}.entries.save`)}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t(`${P}.entries.cancel`)}
        </Button>
      </div>
      {update.error && <p className="mt-2 text-xs text-destructive">{errorText(update.error)}</p>}
    </div>
  );
}

function AddEntryRow({
  option,
  appName,
  full,
}: {
  option: ScopeOption;
  appName: string | null;
  full: boolean;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const add = useAddDictionaryEntry();
  const [written, setWritten] = useState('');
  const [spoken, setSpoken] = useState('');

  const submit = () => {
    if (!written.trim() || full || add.isPending) return;
    add.mutate(newEntry(option.scope, written, spoken, appName), {
      onSuccess: () => {
        setWritten('');
        setSpoken('');
      },
    });
  };
  // A stale error goes once the user changes what they typed.
  const edit = (set: (value: string) => void) => (value: string) => {
    if (add.error) add.reset();
    set(value);
  };

  return (
    <div className="py-3.5">
      <div className="flex items-center gap-2">
        <EntryInputs
          written={written}
          spoken={spoken}
          onWritten={edit(setWritten)}
          onSpoken={edit(setSpoken)}
          onSubmit={submit}
        />
        <Button size="sm" disabled={!written.trim() || full || add.isPending} onClick={submit}>
          {t(`${P}.add.action`)}
        </Button>
      </div>
      {full ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(`${P}.add.limit`, { count: MAX_ENTRIES })}
        </p>
      ) : add.error ? (
        <p className="mt-2 text-xs text-destructive">{errorText(add.error)}</p>
      ) : null}
    </div>
  );
}

/** Read-only: the style's and everywhere's entries that also apply in an app. */
function InheritedEntries({ bundleId, styleName }: { bundleId: string; styleName?: string }) {
  const { t } = useTranslation();
  const resolved = useResolvedDictionary(bundleId);
  const inherited = inheritedEntries(resolved.data?.entries);
  const dropped = resolved.data?.dropped_terms.length ?? 0;
  const source = (entry: ResolvedDictionaryEntry) =>
    entry.scope === 'style' ? (styleName ?? t(`${P}.inherited.style`)) : t(`${P}.scope.everywhere`);

  return (
    <SettingSection title={t(`${P}.inherited.title`)} description={t(`${P}.inherited.description`)}>
      {resolved.isLoading ? (
        <div className="py-3.5 flex justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : inherited.length ? (
        inherited.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 py-3">
            <EntryText entry={entry} struck={entry.overridden} />
            <span className="shrink-0 text-xs text-muted-foreground">
              {entry.overridden ? t(`${P}.inherited.overridden`) : source(entry)}
            </span>
          </div>
        ))
      ) : (
        <p className="py-3.5 text-xs text-muted-foreground">{t(`${P}.inherited.empty`)}</p>
      )}
      {dropped > 0 && (
        <p className="py-3.5 text-xs leading-relaxed text-muted-foreground">
          {t(`${P}.inherited.dropped`, { count: dropped })}
        </p>
      )}
    </SettingSection>
  );
}
