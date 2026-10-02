import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChordPicker } from '@/components/ChordPicker/ChordPicker';
import { useModelDownloads } from '@/components/ServerSettings/useModelDownloads';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { SpeechVoice } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { chordTakenBy } from '@/lib/utils/chordConflicts';
import { ChordKeys } from './ChordKeys';

const P = 'settings.readAloud';
/** The model Read Aloud speaks with (backend/backends/kokoro_backend.py). */
export const READ_ALOUD_MODEL = 'kokoro-82m';

const ACCENTS: SpeechVoice['accent'][] = ['american', 'british'];

/**
 * Read Aloud (docs/plans/READ_ALOUD.md): the chord that speaks the selected
 * text, the Kokoro voice it speaks in, and how fast.
 */
export function ReadAloudPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings, update } = useCaptureSettings();
  const hotkeyEnabled = settings?.hotkey_enabled ?? false;
  const speakKeys = settings?.chord_speak_keys ?? [];
  const [editingChord, setEditingChord] = useState(false);

  const saveChord = (keys: string[]) => {
    const taken = chordTakenBy(keys, 'speak', settings);
    if (taken) {
      toast({
        title: t('settings.chordTaken', { name: t(`settings.chordNames.${taken}`) }),
        variant: 'destructive',
      });
      return;
    }
    update({ chord_speak_keys: keys });
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
              {speakKeys.length > 0 ? (
                <ChordKeys keys={speakKeys} />
              ) : (
                <span className="text-xs text-muted-foreground">{t(`${P}.chord.off`)}</span>
              )}
              {speakKeys.length > 0 && (
                <Button
                  variant="ghost"
                  className="h-[30px] px-2.5 text-xs"
                  onClick={() => update({ chord_speak_keys: [] })}
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
                {speakKeys.length > 0 ? t(`${P}.chord.change`) : t(`${P}.chord.set`)}
              </Button>
            </div>
          }
        />
        <VoiceModelRow />
      </SettingSection>

      <ChordPicker
        open={editingChord}
        title={t(`${P}.chord.pickerTitle`)}
        description={t(`${P}.chord.pickerDescription`)}
        initialKeys={speakKeys}
        onCancel={() => setEditingChord(false)}
        onSave={saveChord}
      />

      <VoiceSection />
    </>
  );
}

/** Whether Kokoro is downloaded, and a button to download it when it isn't. */
function VoiceModelRow() {
  const { t } = useTranslation();
  const { data: modelStatus } = useQuery({
    queryKey: ['modelStatus'],
    queryFn: () => apiClient.getModelStatus(),
    refetchInterval: 5000,
  });
  const downloads = useModelDownloads(modelStatus?.models);
  const model = modelStatus?.models.find((m) => m.model_name === READ_ALOUD_MODEL);
  const isDownloading = model ? downloads.stateOf(model).isDownloading : false;

  return (
    <SettingRow
      title={t(`${P}.model.title`)}
      description={t(`${P}.model.description`)}
      action={
        model?.downloaded ? (
          <span className="text-xs text-muted-foreground">{t(`${P}.model.ready`)}</span>
        ) : (
          <Button
            variant="outline"
            className="h-[30px] px-2.5 text-xs"
            disabled={!model || isDownloading}
            onClick={() => downloads.download(READ_ALOUD_MODEL)}
          >
            {isDownloading ? t(`${P}.model.downloading`) : t(`${P}.model.download`)}
          </Button>
        )
      }
    />
  );
}

/** The voice and speed, with a preview of both. */
function VoiceSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { settings, update } = useCaptureSettings();
  const { data } = useQuery({
    queryKey: ['speechVoices'],
    queryFn: () => apiClient.getSpeechVoices(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const voice = settings?.speak_voice ?? data?.default ?? 'af_heart';
  const savedSpeed = settings?.speak_speed ?? 1;
  const [speed, setSpeed] = useState(savedSpeed);
  useEffect(() => setSpeed(savedSpeed), [savedSpeed]);
  const [previewing, setPreviewing] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => player.current?.pause(), []);

  const commitSpeed = () => {
    if (speed !== savedSpeed) update({ speak_speed: speed });
  };

  const preview = async () => {
    setPreviewing(true);
    try {
      const audio = await apiClient.speak(t(`${P}.voice.previewText`), voice, speed);
      player.current?.pause();
      const url = URL.createObjectURL(audio);
      const element = new Audio(url);
      player.current = element;
      element.onended = () => URL.revokeObjectURL(url);
      await element.play();
    } catch (error) {
      toast({
        title: t(`${P}.voice.previewFailed`),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <SettingSection title={t(`${P}.sectionVoice`)}>
      <SettingRow
        title={t(`${P}.voice.title`)}
        description={t(`${P}.voice.description`)}
        action={
          <div className="flex items-center gap-1.5">
            <Select value={voice} onValueChange={(v) => update({ speak_voice: v })}>
              <SelectTrigger className="h-8 w-[200px]" aria-label={t(`${P}.voice.title`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENTS.map((accent) => (
                  <SelectGroup key={accent}>
                    <SelectLabel>{t(`${P}.voice.accents.${accent}`)}</SelectLabel>
                    {data?.voices
                      .filter((v) => v.accent === accent)
                      .map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {t(`${P}.voice.option`, {
                            name: v.name,
                            gender: t(`${P}.voice.genders.${v.gender}`),
                          })}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-[30px] px-2.5 text-xs"
              disabled={previewing}
              onClick={preview}
            >
              {previewing ? t(`${P}.voice.previewing`) : t(`${P}.voice.preview`)}
            </Button>
          </div>
        }
      />
      <SettingRow
        htmlFor="speakSpeed"
        title={t(`${P}.speed.title`)}
        description={t(`${P}.speed.value`, { speed: speed.toFixed(1) })}
        action={
          <input
            id="speakSpeed"
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            onPointerUp={commitSpeed}
            onKeyUp={commitSpeed}
            className="w-[240px] cursor-pointer accent-accent"
          />
        }
      />
    </SettingSection>
  );
}
