import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlacesMenu, submitKeys } from '@/components/Settings/DictionaryControls';
import {
  buildScopeOptions,
  EVERYWHERE_KEY,
  newPhrase,
  placesFromKeys,
  togglePlace,
} from '@/components/Settings/dictionaryScopes';
import {
  PhraseHint,
  PhraseSayField,
  PhraseTextField,
  useFilled,
  usePhraseDictation,
} from '@/components/Settings/PhraseDictation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAddDictionaryEntry, useDictionary } from '@/lib/hooks/useDictionary';
import { useWritingStyles } from '@/lib/hooks/useWritingStyle';
import type { PhraseDraft } from './captureDictionary';

const P = 'captures.phrase';

/**
 * Makes a phrase from a correction: saying `phrase.said` writes
 * `phrase.written` from now on. Both are filled in from the change and can
 * be edited; the phrase can be said again, from the mic or the shortcut, to
 * say it another way. Closed while `phrase` is null. `onAdded` runs once
 * the phrase is in the dictionary, to save the correction with it.
 */
export function MakePhraseDialog({
  phrase,
  onAdded,
  onClose,
}: {
  phrase: PhraseDraft | null;
  onAdded?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={phrase !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      {phrase !== null && <PhraseDialog phrase={phrase} onAdded={onAdded} onDone={onClose} />}
    </Dialog>
  );
}

function PhraseDialog({
  phrase,
  onAdded,
  onDone,
}: {
  phrase: PhraseDraft;
  onAdded?: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const add = useAddDictionaryEntry();
  const styles = useWritingStyles();
  const dictionary = useDictionary();
  const [spoken, setSpoken] = useState(phrase.said);
  const [written, setWritten] = useState(phrase.written);
  const [places, setPlaces] = useState([EVERYWHERE_KEY]);
  const say = useRef<HTMLInputElement>(null);
  const [filled, markFilled] = useFilled();
  const dictation = usePhraseDictation(say, (heard) => {
    if (add.error) add.reset();
    setSpoken(heard);
    markFilled();
  });
  const options = buildScopeOptions(styles.data, dictionary.data?.entries);
  // Another way to say a phrase the user already has.
  const sameText = dictionary.data?.entries.find(
    (entry) => entry.phrase && entry.written === written.trim(),
  );
  const ready =
    !!spoken.trim() &&
    !!written.trim() &&
    places.length > 0 &&
    !add.isPending &&
    dictation.state.phase === 'idle';

  const submit = () => {
    if (!ready) return;
    add.mutate(newPhrase(spoken, written, placesFromKeys(places, options)), {
      onSuccess: (entry) => {
        toast({ title: t(`${P}.added`, { spoken: entry.spoken }) });
        onAdded?.();
        onDone();
      },
    });
  };
  const edit = (set: (value: string) => void) => (value: string) => {
    // A stale error goes once the user changes what they typed.
    if (add.error) add.reset();
    set(value);
  };

  return (
    <DialogContent className="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{t(`${P}.title`)}</DialogTitle>
        <DialogDescription>{t(`${P}.description`)}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="capture-phrase-say" className="text-xs text-muted-foreground">
          {t('dictionary.add.say')}
        </label>
        <PhraseSayField
          id="capture-phrase-say"
          value={spoken}
          onChange={edit(setSpoken)}
          onKeyDown={submitKeys(submit)}
          inputRef={say}
          dictation={dictation}
          filled={filled}
          autoFocus
        />
        <PhraseHint dictation={dictation} variant="another" className="whitespace-nowrap" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="capture-phrase-write" className="text-xs text-muted-foreground">
          {t('dictionary.phrases.write')}
        </label>
        <PhraseTextField
          id="capture-phrase-write"
          value={written}
          onChange={edit(setWritten)}
          onSubmit={submit}
        />
        {sameText?.spoken && (
          <span className="text-xs text-muted-foreground">
            {t(`${P}.sameText`, { spoken: sameText.spoken })}
          </span>
        )}
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
      <DialogFooter className="items-center">
        {onAdded && (
          <span className="mr-auto text-xs text-muted-foreground">{t(`${P}.savesCorrection`)}</span>
        )}
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
