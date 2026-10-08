import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import type { Qwen3ModelSize, WhisperModelSize } from '@/lib/api/types';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { VoiceTrainingSection } from './VoiceTrainingSection';

const P = 'settings.captures.transcription';
const R = 'settings.captures.refinement';
const S = 'settings.captures.sharedAdapters';

/** Whisper sizes, each with the speed/accuracy note shown after its name. */
const WHISPER_MODELS: Array<{ value: WhisperModelSize; tail: string }> = [
  { value: 'base', tail: 'fast' },
  { value: 'small', tail: 'balanced' },
  { value: 'medium', tail: 'higher' },
  { value: 'large', tail: 'best' },
  { value: 'turbo', tail: 'nearBest' },
];

const LANGUAGES = ['auto', 'en', 'es', 'fr', 'de', 'ja', 'zh', 'hi'] as const;

const QWEN_MODELS: Array<{ value: Qwen3ModelSize; key: string; tail: string }> = [
  { value: '0.6B', key: 'size06', tail: 'veryFast' },
  { value: '1.7B', key: 'size17', tail: 'fast' },
  { value: '4B', key: 'size40', tail: 'fullQuality' },
];

/** The model dictation uses, and a link to change it in the Models tab. */
function ModelInUse({ label, model }: { label: string; model: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <Button asChild size="sm" variant="outline">
        <Link to="/models" search={{ model }}>
          {t('settings.captures.changeModel')}
        </Link>
      </Button>
    </div>
  );
}

/**
 * Transcription (Whisper) and refinement (Qwen3) settings. Models are chosen
 * in the Models tab; punctuation, filler and technical terms belong to each
 * writing style, on the Writing style page.
 */
export function TranscriptionSettingsPage() {
  const { t } = useTranslation();
  const { settings, update } = useCaptureSettings();
  const sttModel = settings?.stt_model ?? 'turbo';
  const language = settings?.language ?? 'auto';
  const autoRefine = settings?.auto_refine ?? true;
  const llmModel = settings?.llm_model ?? '0.6B';
  const qwen = QWEN_MODELS.find((m) => m.value === llmModel) ?? QWEN_MODELS[0];
  const selfCorrection = settings?.self_correction ?? true;
  const expressive = settings?.expressive ?? true;
  const sharedAdapters = settings?.shared_adapters ?? true;

  return (
    <>
      <SettingSection title={t(`${S}.title`)}>
        <SettingRow
          title={t(`${S}.toggle.title`)}
          description={t(`${S}.toggle.description`)}
          htmlFor="sharedAdapters"
          action={
            <Toggle
              id="sharedAdapters"
              checked={sharedAdapters}
              disabled={!settings}
              onCheckedChange={(v) => update({ shared_adapters: v })}
            />
          }
        />
      </SettingSection>

      <SettingSection title={t(`${P}.title`)}>
        <SettingRow
          title={t(`${P}.model.title`)}
          description={t(`${P}.model.description`)}
          action={
            <ModelInUse
              label={t(`${P}.model.${sttModel}`, {
                tail: t(
                  `${P}.model.tail.${WHISPER_MODELS.find((m) => m.value === sttModel)?.tail ?? 'fast'}`,
                ),
              })}
              model={`whisper-${sttModel}`}
            />
          }
        />

        <SettingRow
          title={t(`${P}.language.title`)}
          description={t(`${P}.language.description`)}
          action={
            <Select value={language} onValueChange={(v) => update({ language: v })}>
              <SelectTrigger className="h-8 w-[200px]" aria-label={t(`${P}.language.title`)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`${P}.language.${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingSection>

      <VoiceTrainingSection sttModel={sttModel} />

      <SettingSection title={t(`${R}.title`)}>
        <SettingRow
          title={t(`${R}.auto.title`)}
          description={t(`${R}.auto.description`)}
          htmlFor="autoRefine"
          action={
            <Toggle
              id="autoRefine"
              checked={autoRefine}
              onCheckedChange={(v) => update({ auto_refine: v })}
            />
          }
        />

        <SettingRow
          title={t(`${R}.model.title`)}
          description={t(`${R}.model.description`)}
          action={
            <ModelInUse
              label={t(`${R}.model.${qwen.key}`, { tail: t(`${R}.model.tail.${qwen.tail}`) })}
              model={`qwen3-${llmModel.toLowerCase()}`}
            />
          }
        />

        <SettingRow
          title={t(`${R}.selfCorrection.title`)}
          description={t(`${R}.selfCorrection.description`)}
          htmlFor="selfCorrection"
          action={
            <Toggle
              id="selfCorrection"
              checked={selfCorrection}
              onCheckedChange={(v) => update({ self_correction: v })}
              disabled={!autoRefine}
            />
          }
        />

        <SettingRow
          title={t(`${R}.expressive.title`)}
          description={t(`${R}.expressive.description`)}
          htmlFor="expressive"
          action={
            <Toggle
              id="expressive"
              checked={expressive}
              onCheckedChange={(v) => update({ expressive: v })}
              disabled={!autoRefine}
            />
          }
        />

        <SettingRow
          title={t(`${R}.styles.title`)}
          description={t(`${R}.styles.description`)}
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/settings/writing-style">{t(`${R}.styles.open`)}</Link>
            </Button>
          }
        />
      </SettingSection>
    </>
  );
}
