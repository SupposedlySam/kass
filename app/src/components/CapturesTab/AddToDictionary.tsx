import { BookPlus } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Arrow,
  MAX_LENGTH,
  PlacesMenu,
  submitKeys,
} from '@/components/Settings/DictionaryControls';
import {
  allOptions,
  buildScopeOptions,
  placesFromKeys,
  togglePlace,
} from '@/components/Settings/dictionaryScopes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import type { CaptureResponse } from '@/lib/api/types';
import { useAddDictionaryEntry, useDictionary } from '@/lib/hooks/useDictionary';
import { useWritingStyles } from '@/lib/hooks/useWritingStyle';
import { defaultPlaceKeys, entryFromCapture, selectionPhrase } from './captureDictionary';

const P = 'captures.dictionary';

interface Picked {
  text: string;
  rect: DOMRect;
}

/** A word or phrase selected inside `container`, and where it is on screen. */
function useSelectedPhrase(container: RefObject<HTMLElement>, enabled: boolean): Picked | null {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPicked(null);
      return;
    }
    const update = () => {
      const selection = window.getSelection();
      const root = container.current;
      if (!selection || selection.isCollapsed || !selection.rangeCount || !root) {
        setPicked(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const text = root.contains(range.commonAncestorContainer)
        ? selectionPhrase(selection.toString())
        : '';
      setPicked(text ? { text, rect: range.getBoundingClientRect() } : null);
    };
    document.addEventListener('selectionchange', update);
    // The button sits over the selection, so it follows the text when it scrolls.
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [container, enabled]);
  return picked;
}

/**
 * Selecting a word or phrase in a capture's text offers to add it to the
 * dictionary: what was selected is what was said, and the user writes how
 * it should be spelled. Off while the transcript is being edited.
 */
export function SelectionToDictionary({
  capture,
  enabled,
  children,
  className,
}: {
  capture: CaptureResponse;
  enabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const picked = useSelectedPhrase(container, enabled);
  const [said, setSaid] = useState<string | null>(null);

  const open = () => {
    if (!picked) return;
    setSaid(picked.text);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div ref={container} className={className}>
      {children}
      {picked && (
        <Button
          size="sm"
          // Keep the selection: the click reads it.
          onMouseDown={(event) => event.preventDefault()}
          onClick={open}
          className="fixed z-50 h-7 -translate-x-1/2 gap-1.5 px-2.5 text-xs shadow-md"
          style={{
            left: picked.rect.left + picked.rect.width / 2,
            // Above the selection, or below it when it's at the top of the window.
            top: picked.rect.top > 44 ? picked.rect.top - 36 : picked.rect.bottom + 8,
          }}
        >
          <BookPlus className="size-3.5!" />
          {t(`${P}.add`)}
        </Button>
      )}
      <Dialog open={said !== null} onOpenChange={(isOpen) => !isOpen && setSaid(null)}>
        {said !== null && <AddDialog capture={capture} said={said} onDone={() => setSaid(null)} />}
      </Dialog>
    </div>
  );
}

function AddDialog({
  capture,
  said: selected,
  onDone,
}: {
  capture: CaptureResponse;
  said: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const add = useAddDictionaryEntry();
  const styles = useWritingStyles();
  const dictionary = useDictionary();
  const [said, setSaid] = useState(selected);
  const [written, setWritten] = useState(selected);
  const [places, setPlaces] = useState(() => defaultPlaceKeys(capture.app_bundle_id));

  const options = buildScopeOptions(styles.data, dictionary.data?.entries);
  const appOption = allOptions(options).find(
    (o) => places.includes(o.key) && o.scope.kind === 'app',
  );
  const spellingOnly = said.trim().split(/\s+/).join(' ') === written.trim().split(/\s+/).join(' ');
  const ready = !!written.trim() && places.length > 0 && !add.isPending;

  const submit = () => {
    if (!ready) return;
    const body = entryFromCapture(said, written, placesFromKeys(places, options), {
      bundleId: capture.app_bundle_id,
      name: capture.app_name,
    });
    add.mutate(body, {
      onSuccess: () => {
        toast({ title: t(`${P}.added`, { written: body.written }) });
        onDone();
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
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{t(`${P}.title`)}</DialogTitle>
        <DialogDescription>{t(`${P}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-x-3 gap-y-1.5">
        <label htmlFor="capture-dictionary-say" className="text-xs text-muted-foreground">
          {t('dictionary.add.say')}
        </label>
        <span />
        <label htmlFor="capture-dictionary-write" className="text-xs text-muted-foreground">
          {t('dictionary.add.write')}
        </label>
        <Input
          id="capture-dictionary-say"
          value={said}
          onChange={(e) => edit(setSaid)(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_LENGTH}
          className="h-8"
        />
        <div className="flex h-8 items-center">
          <Arrow amber />
        </div>
        <Input
          id="capture-dictionary-write"
          value={written}
          onChange={(e) => edit(setWritten)(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          maxLength={MAX_LENGTH}
          className="h-8"
        />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">
        {t(spellingOnly ? `${P}.spellingOnly` : `${P}.replaces`, {
          said: said.trim(),
          written: written.trim(),
        })}
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('dictionary.list.appliesIn')}</span>
        <PlacesMenu
          selected={places}
          onToggle={(key) => setPlaces((current) => togglePlace(current, key))}
          options={options}
          viewedFrom={appOption}
        />
      </div>
      {add.error && <p className="m-0 text-xs text-destructive">{add.error.message}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t('dictionary.list.cancel')}
        </Button>
        <Button disabled={!ready} onClick={submit}>
          {t(`${P}.submit`)}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
