import { BookPlus } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_LENGTH, PlacesMenu, submitKeys } from '@/components/Settings/DictionaryControls';
import {
  buildScopeOptions,
  EVERYWHERE_KEY,
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
import { useAddDictionaryEntry, useDictionary } from '@/lib/hooks/useDictionary';
import { useWritingStyles } from '@/lib/hooks/useWritingStyle';
import { respellSelection, selectionPhrase, spellingEntry } from './captureDictionary';
import type { TeachState } from './TeachCorrection';

const P = 'captures.dictionary';

interface Picked {
  text: string;
  rect: DOMRect;
  /** Where it was picked in the correction's edit box, when it was. */
  field?: { text: string; start: number; end: number };
}

/**
 * Where `start`..`end` of a textarea's text is on screen. A textarea has no
 * ranges to measure, so a hidden copy of it with the same styles lays the
 * text out the same way, and the selected part is measured there.
 */
function textareaRect(field: HTMLTextAreaElement, start: number, end: number): DOMRect {
  const style = window.getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const name of [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'textTransform',
    'wordSpacing',
    'tabSize',
  ] as const) {
    mirror.style[name] = style[name];
  }
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    top: '0',
    left: '0',
  });
  mirror.textContent = field.value.slice(0, start);
  const marked = document.createElement('span');
  marked.textContent = field.value.slice(start, end) || '​';
  mirror.appendChild(marked);
  document.body.appendChild(mirror);
  const inner = marked.getBoundingClientRect();
  document.body.removeChild(mirror);
  const outer = field.getBoundingClientRect();
  return new DOMRect(
    outer.left + inner.left - field.scrollLeft,
    outer.top + inner.top - field.scrollTop,
    inner.width,
    inner.height,
  );
}

/** A word or phrase selected inside `container`, in its text or its edit box, and where it is. */
function useSelectedPhrase(container: RefObject<HTMLElement>): Picked | null {
  const [picked, setPicked] = useState<Picked | null>(null);
  useEffect(() => {
    const update = () => {
      const root = container.current;
      const active = document.activeElement;
      if (root && active instanceof HTMLTextAreaElement && root.contains(active)) {
        const { selectionStart: start, selectionEnd: end } = active;
        const text = start === end ? '' : selectionPhrase(active.value.slice(start, end));
        setPicked(
          text
            ? {
                text,
                rect: textareaRect(active, start, end),
                field: { text: active.value, start, end },
              }
            : null,
        );
        return;
      }
      const selection = window.getSelection();
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
    // A textarea's selection doesn't always report through the document.
    document.addEventListener('select', update, true);
    document.addEventListener('focusout', update, true);
    // The button sits over the selection, so it follows the text when it scrolls.
    window.addEventListener('scroll', update, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('select', update, true);
      document.removeEventListener('focusout', update, true);
      window.removeEventListener('scroll', update, true);
    };
  }, [container]);
  return picked;
}

/**
 * Selecting a word or phrase in a capture's text, or while correcting it,
 * offers to add it to the dictionary: the user types how it should be
 * spelled, and may narrow where it applies. Picked while correcting, the
 * correction is saved too, with the word spelled the way it was added.
 */
export function SelectionToDictionary({
  children,
  className,
  teach,
}: {
  children: ReactNode;
  className?: string;
  teach?: TeachState;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const picked = useSelectedPhrase(container);
  const [word, setWord] = useState<DictionaryWord | null>(null);
  const [field, setField] = useState<Picked['field']>();

  const open = () => {
    if (!picked) return;
    setWord({ said: picked.text, written: picked.text });
    setField(picked.field);
    if (!(document.activeElement instanceof HTMLTextAreaElement)) {
      window.getSelection()?.removeAllRanges();
    }
  };

  const respell = (written: string) => {
    if (!teach || !field) return;
    // The edit box closes when the dialog takes focus if nothing was changed
    // yet, so the text picked from may be the capture's own.
    const current = teach.draft ?? teach.original;
    if (current !== field.text) return;
    teach.saveText(
      written === word?.written
        ? current
        : respellSelection(current, field.start, field.end, written),
    );
  };

  return (
    <div ref={container} className={className}>
      {children}
      {picked && (
        <Button
          size="sm"
          // Keep the selection, and the correction being typed: the click reads it.
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
      <AddToDictionaryDialog word={word} onAdded={respell} onClose={() => setWord(null)} />
    </div>
  );
}

/** A word to add: what the capture wrote, and how the user spells it. */
export interface DictionaryWord {
  said: string;
  written: string;
}

/**
 * Asks how `word` is spelled, and where, and adds it to the dictionary;
 * closed while `word` is null. `onAdded` gets the spelling that was added.
 */
export function AddToDictionaryDialog({
  word,
  onAdded,
  onClose,
}: {
  word: DictionaryWord | null;
  onAdded?: (written: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={word !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      {word !== null && <SpellingDialog word={word} onAdded={onAdded} onDone={onClose} />}
    </Dialog>
  );
}

function SpellingDialog({
  word,
  onAdded,
  onDone,
}: {
  word: DictionaryWord;
  onAdded?: (written: string) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const add = useAddDictionaryEntry();
  const styles = useWritingStyles();
  const dictionary = useDictionary();
  const [written, setWritten] = useState(word.written);
  const [places, setPlaces] = useState([EVERYWHERE_KEY]);
  const options = buildScopeOptions(styles.data, dictionary.data?.entries);
  const ready = !!written.trim() && places.length > 0 && !add.isPending;

  const submit = () => {
    if (!ready) return;
    const body = spellingEntry(word.said, written, placesFromKeys(places, options));
    add.mutate(body, {
      onSuccess: () => {
        toast({ title: t(`${P}.added`, { written: body.written }) });
        onAdded?.(body.written);
        onDone();
      },
    });
  };

  return (
    <DialogContent className="sm:max-w-[400px]">
      <DialogHeader>
        <DialogTitle>{t(`${P}.title`)}</DialogTitle>
        <DialogDescription>{t(`${P}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="capture-dictionary-spelling" className="text-xs text-muted-foreground">
          {t(`${P}.spelling`)}
        </label>
        <Input
          id="capture-dictionary-spelling"
          value={written}
          onChange={(e) => {
            // A stale error goes once the user changes what they typed.
            if (add.error) add.reset();
            setWritten(e.target.value);
          }}
          onKeyDown={submitKeys(submit)}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          maxLength={MAX_LENGTH}
          className="h-9"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('dictionary.list.appliesIn')}</span>
        <PlacesMenu
          selected={places}
          onToggle={(key) => setPlaces((current) => togglePlace(current, key))}
          options={options}
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
