import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import type { DictionaryEntry, DictionaryEntryUpdate } from '@/lib/api/types';
import { useBetaFeature } from '@/lib/betaFeatures';
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
  Arrow,
  MAX_LENGTH,
  MONO_LABEL,
  PlacesMenu,
  ScopeIcon,
  submitKeys,
  useScopeLabel,
} from './DictionaryControls';
import {
  allOptions,
  buildScopeOptions,
  type EntryAge,
  EVERYWHERE_KEY,
  entriesIn,
  entryAge,
  entryNote,
  entryPlaceKeys,
  type InheritedGroup,
  inheritedForApp,
  inheritedForStyle,
  looksLikeCode,
  newEntry,
  placesFromKeys,
  type ScopeOption,
  type ScopeOptions,
  samePlaces,
  togglePlace,
} from './dictionaryScopes';

const P = 'dictionary';
/** Matches the server's limit. */
const MAX_ENTRIES = 1000;

/** Said, arrow, written, date, actions: shared by list rows so the columns line up. */
const ROW_GRID =
  'grid grid-cols-[minmax(0,200px)_auto_minmax(0,1fr)_auto_auto] items-center gap-x-3';

/**
 * Dictionary: words dictation should get right. The scope list on the left
 * picks where (`?scope=`): everywhere, one writing style or one app. An
 * entry can apply in several places at once.
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
  // A deleted style or unknown key falls back to everywhere.
  const current = allOptions(options).find((o) => o.key === scopeParam) ?? options.everywhere;
  const select = (key: string) =>
    navigate({ search: key === EVERYWHERE_KEY ? {} : { scope: key }, replace: true });
  const styleNames = new Map([...stylesById(styles.data)].map(([id, s]) => [id, s.name]));

  return (
    <div>
      <header className="mb-5">
        <h2 className="text-lg font-semibold">{t(`${P}.title`)}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t(`${P}.description`)}</p>
      </header>
      <div className="flex min-h-[420px] overflow-hidden rounded-lg border border-border">
        <ScopeList options={options} current={current} onSelect={select} />
        <div className="min-w-0 flex-1 px-6 py-5">
          <ScopePane
            key={current.key}
            option={current}
            options={options}
            entries={all}
            styleNames={styleNames}
          />
        </div>
      </div>
    </div>
  );
}

function ScopeList({
  options,
  current,
  onSelect,
}: {
  options: ScopeOptions;
  current: ScopeOption;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const label = useScopeLabel();
  const row = (option: ScopeOption) => {
    const selected = option.key === current.key;
    return (
      <li key={option.key}>
        <button
          type="button"
          onClick={() => onSelect(option.key)}
          aria-current={selected ? 'page' : undefined}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors',
            selected
              ? 'bg-accent/10 font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--accent))]'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <ScopeIcon option={option} />
          <span className="min-w-0 flex-1 truncate">{label(option)}</span>
          {option.count > 0 && (
            <span
              className="font-mono text-[11px] tabular-nums text-muted-foreground"
              title={t(`${P}.scope.count`, { count: option.count })}
            >
              {option.count}
            </span>
          )}
        </button>
      </li>
    );
  };
  return (
    <nav
      aria-label={t(`${P}.scope.label`)}
      className="w-[220px] shrink-0 border-r border-border bg-muted/40 px-2 py-3"
    >
      <ul className="space-y-0.5">{row(options.everywhere)}</ul>
      {options.styles.length > 0 && (
        <>
          <h3 className={cn(MONO_LABEL, 'px-2.5 pt-4 pb-1.5')}>{t(`${P}.scope.styles`)}</h3>
          <ul className="space-y-0.5">{options.styles.map(row)}</ul>
        </>
      )}
      {options.apps.length > 0 && (
        <>
          <h3 className={cn(MONO_LABEL, 'px-2.5 pt-4 pb-1.5')}>{t(`${P}.scope.apps`)}</h3>
          <ul className="space-y-0.5">{options.apps.map(row)}</ul>
        </>
      )}
    </nav>
  );
}

function ScopePane({
  option,
  options,
  entries,
  styleNames,
}: {
  option: ScopeOption;
  options: ScopeOptions;
  entries: DictionaryEntry[];
  styleNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  const label = useScopeLabel();
  const inScope = entriesIn(entries, option.scope);
  const name = label(option);

  let subtitle: string | null;
  if (option.scope.kind === 'global') subtitle = t(`${P}.header.everywhere`);
  else if (option.scope.kind === 'style')
    subtitle = t(`${P}.header.styleApps`, { count: option.appCount ?? 0 });
  else {
    const style = option.styleId ? styleNames.get(option.styleId) : undefined;
    subtitle = style ? t(`${P}.header.appStyle`, { style }) : null;
  }

  return (
    <>
      <div className="mb-5 flex items-center gap-2.5">
        {option.scope.kind === 'app' && <ScopeIcon option={option} className="size-7" />}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{name}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      <AddForm option={option} full={entries.length >= MAX_ENTRIES} />

      <div className="mt-5 overflow-hidden rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <span className={MONO_LABEL}>
            {t(`${P}.list.title`, { scope: name, count: inScope.length })}
          </span>
          <span className={MONO_LABEL}>{t(`${P}.list.order`)}</span>
        </div>
        {inScope.length ? (
          <ul className="divide-y divide-border/70">
            {inScope.map((entry) => (
              <EntryRow key={entry.id} entry={entry} option={option} options={options} />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">
            {t(`${P}.list.empty`)}
          </p>
        )}
      </div>

      {option.scope.kind === 'app' && (
        <AppInherited bundleId={option.scope.bundleId} scopeName={name} styleNames={styleNames} />
      )}
      {option.scope.kind === 'style' && (
        <Inherited
          scopeName={name}
          groups={inheritedForStyle(entries, option.scope)}
          styleNames={styleNames}
        />
      )}
    </>
  );
}

/** Enter submits, Escape cancels. */
function AddForm({ option, full }: { option: ScopeOption; full: boolean }) {
  const { t } = useTranslation();
  const add = useAddDictionaryEntry();
  const [written, setWritten] = useState('');
  const [spoken, setSpoken] = useState('');

  const submit = () => {
    if (!written.trim() || full || add.isPending) return;
    const appName = option.scope.kind === 'app' ? option.name : null;
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
  const onKeyDown = submitKeys(submit);

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1.5">
        <label htmlFor="dictionary-say" className="text-xs text-muted-foreground">
          {t(`${P}.add.say`)}
        </label>
        <span />
        <label htmlFor="dictionary-write" className="text-xs text-muted-foreground">
          {t(`${P}.add.write`)}
        </label>
        <span />
        <Input
          id="dictionary-say"
          value={spoken}
          onChange={(e) => edit(setSpoken)(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(`${P}.add.sayPlaceholder`)}
          maxLength={MAX_LENGTH}
          className="h-8"
        />
        <div className="flex h-8 items-center">
          <Arrow amber />
        </div>
        <Input
          id="dictionary-write"
          value={written}
          onChange={(e) => edit(setWritten)(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(`${P}.add.writePlaceholder`)}
          maxLength={MAX_LENGTH}
          className="h-8"
        />
        <Button size="sm" disabled={!written.trim() || full || add.isPending} onClick={submit}>
          {t(`${P}.add.action`)}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(`${P}.add.hint`)}</p>
      {full ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t(`${P}.add.limit`, { count: MAX_ENTRIES })}
        </p>
      ) : add.error ? (
        <p className="mt-1.5 text-xs text-destructive">{add.error.message}</p>
      ) : null}
    </div>
  );
}

function AgeText({ createdAt }: { createdAt: string }) {
  const { t, i18n } = useTranslation();
  const age: EntryAge = entryAge(createdAt);
  let text: string;
  if (age.unit === 'date') {
    text = age.date.toLocaleDateString(i18n.language, {
      month: 'short',
      day: 'numeric',
      ...(age.sameYear ? {} : { year: 'numeric' }),
    });
  } else if (age.unit === 'now') {
    text = t(`${P}.list.justNow`);
  } else {
    text = t(`${P}.list.${age.unit === 'minutes' ? 'minutesAgo' : 'hoursAgo'}`, {
      count: age.count,
    });
  }
  return (
    <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
      {text}
    </span>
  );
}

function SaidText({ spoken }: { spoken: string | null }) {
  const { t } = useTranslation();
  if (!spoken) {
    return (
      <span className="truncate text-xs italic text-muted-foreground">
        {t(`${P}.list.spellingOnly`)}
      </span>
    );
  }
  return <span className="truncate text-sm">{spoken}</span>;
}

function WrittenText({
  entry,
}: {
  entry: Pick<DictionaryEntry, 'written'> &
    Partial<Pick<DictionaryEntry, 'match_sound' | 'source'>>;
}) {
  const { t } = useTranslation();
  const note = useBetaFeature('voice_edits') ? entryNote(entry) : null;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span
        className={cn('truncate text-sm', looksLikeCode(entry.written) && 'font-mono text-[13px]')}
      >
        {entry.written}
      </span>
      {note && (
        <span
          className="shrink-0 whitespace-nowrap text-xs italic text-muted-foreground"
          title={t(`${P}.list.note.${note}Hint`)}
        >
          {t(`${P}.list.note.${note}`)}
        </span>
      )}
    </span>
  );
}

const ICON_BUTTON = 'h-7 w-7 text-muted-foreground [&_svg]:size-3.5';

function EntryRow({
  entry,
  option,
  options,
}: {
  entry: DictionaryEntry;
  option: ScopeOption;
  options: ScopeOptions;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const remove = useDeleteDictionaryEntry();

  if (mode === 'edit') {
    return (
      <EditEntryRow
        entry={entry}
        option={option}
        options={options}
        onDone={() => setMode('view')}
      />
    );
  }
  const onDelete = () => {
    if (entryPlaceKeys(entry).length > 1) setMode('confirm');
    else remove.mutate(entry.id);
  };

  return (
    <li>
      <div className={cn(ROW_GRID, 'px-3 py-2')}>
        <SaidText spoken={entry.spoken} />
        <Arrow />
        <WrittenText entry={entry} />
        <AgeText createdAt={entry.created_at} />
        <div className="flex">
          <Button
            size="icon"
            variant="ghost"
            className={ICON_BUTTON}
            aria-label={t(`${P}.list.edit`, { written: entry.written })}
            onClick={() => setMode('edit')}
          >
            <Pencil />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className={ICON_BUTTON}
            aria-label={t(`${P}.list.delete`, { written: entry.written })}
            disabled={remove.isPending}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {mode === 'confirm' && (
        <div className="flex items-center gap-2 border-t border-border/70 bg-destructive/5 px-3 py-2">
          <span className="flex-1 text-xs">{t(`${P}.list.confirmDelete`)}</span>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setMode('view')}>
            {t(`${P}.list.cancel`)}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7"
            disabled={remove.isPending}
            onClick={() => remove.mutate(entry.id, { onSuccess: () => setMode('view') })}
          >
            {t(`${P}.list.remove`)}
          </Button>
        </div>
      )}
    </li>
  );
}

function EditEntryRow({
  entry,
  option,
  options,
  onDone,
}: {
  entry: DictionaryEntry;
  option: ScopeOption;
  options: ScopeOptions;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateDictionaryEntry();
  const [written, setWritten] = useState(entry.written);
  const [spoken, setSpoken] = useState(entry.spoken ?? '');
  const initialPlaces = entryPlaceKeys(entry);
  const [places, setPlaces] = useState(initialPlaces);
  const initialMatchSound = entry.match_sound !== false;
  const [matchSound, setMatchSound] = useState(initialMatchSound);
  const exactSpelling = useBetaFeature('voice_edits');
  const canSave = !!written.trim() && places.length > 0 && !update.isPending;

  const save = () => {
    if (!canSave) return;
    const nextWritten = written.trim();
    const nextSpoken = spoken.trim() || null;
    const patch: DictionaryEntryUpdate = {};
    if (nextWritten !== entry.written) patch.written = nextWritten;
    if (nextSpoken !== entry.spoken) patch.spoken = nextSpoken;
    if (!samePlaces(places, initialPlaces)) patch.places = placesFromKeys(places, options);
    if (matchSound !== initialMatchSound) patch.match_sound = matchSound;
    if (!Object.keys(patch).length) return onDone();
    update.mutate({ id: entry.id, patch }, { onSuccess: onDone });
  };
  const onKeyDown = submitKeys(save, onDone);
  const edit = (set: (value: string) => void) => (value: string) => {
    if (update.error) update.reset();
    set(value);
  };

  return (
    <li>
      <div className={cn(ROW_GRID, 'px-3 py-2')}>
        <Input
          value={spoken}
          onChange={(e) => edit(setSpoken)(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(`${P}.add.say`)}
          aria-label={t(`${P}.add.say`)}
          maxLength={MAX_LENGTH}
          className="h-7"
        />
        <Arrow />
        <Input
          value={written}
          onChange={(e) => edit(setWritten)(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(`${P}.add.write`)}
          aria-label={t(`${P}.add.write`)}
          maxLength={MAX_LENGTH}
          autoFocus
          className="h-7"
        />
        <span />
        <span className="w-14" />
      </div>
      <div className="border-t border-border/70 bg-accent/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t(`${P}.list.appliesIn`)}</span>
          <PlacesMenu
            selected={places}
            onToggle={(key) => {
              if (update.error) update.reset();
              setPlaces((current) => togglePlace(current, key));
            }}
            options={options}
            viewedFrom={option}
          />
          <span className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7" onClick={onDone}>
            {t(`${P}.list.cancel`)}
          </Button>
          <Button size="sm" className="h-7" disabled={!canSave} onClick={save}>
            {t(`${P}.list.save`)}
          </Button>
        </div>
        {exactSpelling && (
          <div className="mt-2 flex items-center gap-2" title={t(`${P}.list.matchSoundHint`)}>
            <Toggle
              id={`dictionary-match-sound-${entry.id}`}
              checked={matchSound}
              onCheckedChange={(checked) => {
                if (update.error) update.reset();
                setMatchSound(checked);
              }}
            />
            <label
              htmlFor={`dictionary-match-sound-${entry.id}`}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              {t(`${P}.list.matchSound`)}
            </label>
          </div>
        )}
        {update.error && <p className="mt-1.5 text-xs text-destructive">{update.error.message}</p>}
      </div>
    </li>
  );
}

function AppInherited({
  bundleId,
  scopeName,
  styleNames,
}: {
  bundleId: string;
  scopeName: string;
  styleNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  const resolved = useResolvedDictionary(bundleId);
  const dropped = resolved.data?.dropped_terms.length ?? 0;
  return (
    <>
      <Inherited
        scopeName={scopeName}
        groups={inheritedForApp(resolved.data?.entries)}
        styleNames={styleNames}
      />
      {dropped > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t(`${P}.inherited.dropped`, { count: dropped })}
        </p>
      )}
    </>
  );
}

/** Read-only: what also applies in a style or app from elsewhere, one collapsible row per source. */
function Inherited({
  scopeName,
  groups,
  styleNames,
}: {
  scopeName: string;
  groups: InheritedGroup[];
  styleNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  if (!groups.length) return null;
  const source = (group: InheritedGroup) =>
    group.source === 'style'
      ? (styleNames.get(group.scopeId ?? '') ?? t(`${P}.scope.styles`))
      : t(`${P}.scope.everywhere`);
  return (
    <section className="mt-6">
      <h4 className={cn(MONO_LABEL, 'mb-2')}>{t(`${P}.inherited.title`, { scope: scopeName })}</h4>
      <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border">
        {groups.map((group) => (
          <InheritedGroupRow
            key={`${group.source}:${group.scopeId}`}
            group={group}
            source={source(group)}
          />
        ))}
      </div>
    </section>
  );
}

function InheritedGroupRow({ group, source }: { group: InheritedGroup; source: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[13px]">{t(`${P}.inherited.from`, { source })}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {group.preview}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {group.entries.length}
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-border/50 border-t border-border/70 bg-muted/20">
          {group.entries.map((entry) => (
            <li key={entry.id} className={cn(ROW_GRID, 'px-3 py-1.5 pl-8')}>
              <SaidText spoken={entry.spoken} />
              <Arrow />
              <WrittenText entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
