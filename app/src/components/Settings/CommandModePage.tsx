import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordPicker } from '@/components/ChordPicker/ChordPicker';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import type { Transform } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { sortChordKeys } from '@/lib/utils/keyCodes';
import { ChordKeys } from './ChordKeys';

const P = 'settings.commandMode';

const sameChord = (a: string[], b: string[]) =>
  sortChordKeys(a).join('+') === sortChordKeys(b).join('+');

/**
 * Command Mode (docs/plans/COMMAND_MODE.md): the chord that rewrites the
 * selection by a spoken instruction, and the saved transforms. Rewrites run
 * on the dictation cleanup model, so the two never switch models.
 */
export function CommandModePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings, update } = useCaptureSettings();
  const hotkeyEnabled = settings?.hotkey_enabled ?? false;
  const commandKeys = settings?.chord_command_keys ?? [];
  const [editingChord, setEditingChord] = useState(false);

  const saveChord = (keys: string[]) => {
    // The same keys as a dictation chord would start both takes at once.
    const taken = [settings?.chord_push_to_talk_keys, settings?.chord_toggle_to_talk_keys].some(
      (other) => other && sameChord(other, keys),
    );
    if (taken) {
      toast({ title: t(`${P}.chord.taken`), variant: 'destructive' });
      return;
    }
    update({ chord_command_keys: keys });
    setEditingChord(false);
  };

  return (
    <>
      <SettingSection title={t(`${P}.sectionShortcut`)} description={t(`${P}.description`)}>
        <SettingRow
          title={t(`${P}.chord.title`)}
          description={hotkeyEnabled ? t(`${P}.chord.description`) : t(`${P}.chord.needsShortcut`)}
          action={
            <div className="flex items-center gap-1.5">
              {commandKeys.length > 0 ? (
                <ChordKeys keys={commandKeys} />
              ) : (
                <span className="text-xs text-muted-foreground">{t(`${P}.chord.off`)}</span>
              )}
              {commandKeys.length > 0 && (
                <Button
                  variant="ghost"
                  className="h-[30px] px-2.5 text-xs"
                  onClick={() => update({ chord_command_keys: [] })}
                >
                  {t(`${P}.chord.turnOff`)}
                </Button>
              )}
              <Button
                variant="outline"
                className="ml-1.5 h-[30px] px-2.5 text-xs"
                disabled={!hotkeyEnabled}
                aria-label={t(`${P}.chord.changeLabel`)}
                onClick={() => setEditingChord(true)}
              >
                {commandKeys.length > 0 ? t(`${P}.chord.change`) : t(`${P}.chord.set`)}
              </Button>
            </div>
          }
        />
      </SettingSection>

      <ChordPicker
        open={editingChord}
        title={t(`${P}.chord.pickerTitle`)}
        description={t(`${P}.chord.pickerDescription`)}
        initialKeys={commandKeys}
        onCancel={() => setEditingChord(false)}
        onSave={saveChord}
      />

      <Transforms transforms={settings?.command_transforms ?? []} />
    </>
  );
}

/** The saved transforms, each run by saying its name or from the ⌘K palette. */
function Transforms({ transforms }: { transforms: Transform[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { update } = useCaptureSettings();
  const [editing, setEditing] = useState<Transform | null>(null);

  const save = (next: Transform[], after?: () => void) =>
    update(
      { command_transforms: next },
      {
        onSuccess: after,
        onError: (error) =>
          toast({
            title: t(`${P}.transforms.saveFailed`),
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          }),
      },
    );

  const upsert = (transform: Transform) => {
    const exists = transforms.some((x) => x.id === transform.id);
    const next = exists
      ? transforms.map((x) => (x.id === transform.id ? transform : x))
      : [...transforms, transform];
    save(next, () => setEditing(null));
  };

  return (
    <SettingSection
      title={t(`${P}.transforms.title`)}
      description={t(`${P}.transforms.description`)}
    >
      {transforms.map((transform) => (
        <div key={transform.id} className="flex items-start justify-between gap-8 py-3.5">
          <div className="min-w-0">
            <p className="text-sm leading-none">{transform.name}</p>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {transform.instruction}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              className="h-[30px] px-2.5 text-xs"
              onClick={() => setEditing(transform)}
            >
              {t(`${P}.transforms.edit`)}
            </Button>
            <Button
              variant="ghost"
              className="h-[30px] px-2.5 text-xs"
              aria-label={t(`${P}.transforms.deleteLabel`, { name: transform.name })}
              onClick={() => save(transforms.filter((x) => x.id !== transform.id))}
            >
              {t(`${P}.transforms.delete`)}
            </Button>
          </div>
        </div>
      ))}
      {transforms.length === 0 && (
        <p className="py-3.5 text-xs text-muted-foreground">{t(`${P}.transforms.empty`)}</p>
      )}
      <div className="py-3.5">
        <Button
          variant="outline"
          className="h-[30px] px-2.5 text-xs"
          onClick={() => setEditing({ id: crypto.randomUUID(), name: '', instruction: '' })}
        >
          {t(`${P}.transforms.add`)}
        </Button>
      </div>
      <TransformDialog
        key={editing?.id ?? 'closed'}
        transform={editing}
        onCancel={() => setEditing(null)}
        onSave={upsert}
      />
    </SettingSection>
  );
}

function TransformDialog({
  transform,
  onCancel,
  onSave,
}: {
  transform: Transform | null;
  onCancel: () => void;
  onSave: (transform: Transform) => void;
}) {
  const { t } = useTranslation();
  // Keyed by the transform, so each open starts from what is saved.
  const [name, setName] = useState(transform?.name ?? '');
  const [instruction, setInstruction] = useState(transform?.instruction ?? '');
  const nameId = useId();
  const instructionId = useId();

  const ready = name.trim() !== '' && instruction.trim() !== '';

  return (
    <Dialog open={transform !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {transform?.name ? t(`${P}.dialog.editTitle`) : t(`${P}.dialog.addTitle`)}
          </DialogTitle>
          <DialogDescription>{t(`${P}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (transform && ready) {
              onSave({ id: transform.id, name: name.trim(), instruction: instruction.trim() });
            }
          }}
        >
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor={nameId}>{t(`${P}.dialog.name`)}</label>
            <Input
              id={nameId}
              value={name}
              maxLength={60}
              placeholder={t(`${P}.dialog.namePlaceholder`)}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor={instructionId}>{t(`${P}.dialog.instruction`)}</label>
            <Textarea
              id={instructionId}
              value={instruction}
              rows={5}
              maxLength={2000}
              placeholder={t(`${P}.dialog.instructionPlaceholder`)}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!ready}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
