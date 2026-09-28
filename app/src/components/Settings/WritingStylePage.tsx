import { useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingSection } from '@/components/ServerTab/SettingRow';
import { CalibrationCard } from '@/components/WritingStyle/CalibrationCard';
import { CorrectionNotes } from '@/components/WritingStyle/CorrectionNotes';
import { ExportCorrections } from '@/components/WritingStyle/ExportCorrections';
import { PersonalExamples } from '@/components/WritingStyle/PersonalExamples';
import { RecentCorrections } from '@/components/WritingStyle/RecentCorrections';
import { ResetWritingStyle } from '@/components/WritingStyle/ResetWritingStyle';
import { appLabel, appsIn, StyleBoard } from '@/components/WritingStyle/StyleBoard';
import { StyleSettings } from '@/components/WritingStyle/StyleSettings';
import { defaultStyle, useWritingStyles } from '@/lib/hooks/useWritingStyle';

/**
 * Writing style: the styles and the apps in them, then everything about the
 * selected style (`?style=<id>`, the default when none): its settings,
 * calibration, examples, rules and recent corrections.
 */
export function WritingStylePage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/settings/writing-style' });
  const { style: selectedId } = useSearch({ from: '/settings/writing-style' });
  const { data } = useWritingStyles();

  if (!data) {
    return (
      <div className="py-12 flex justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  const style = data.styles.find((s) => s.id === selectedId) ?? defaultStyle(data);
  if (!style) return null;
  const select = (id: string | undefined) =>
    navigate({ search: id ? { style: id } : {}, replace: true });

  return (
    <>
      <SettingSection
        title={t('writingStyle.styles.title')}
        description={t('writingStyle.styles.description')}
      >
        <div className="py-3.5">
          <StyleBoard data={data} selectedId={style.id} onSelect={select} />
          {data.cache_mb_per_style ? (
            <p className="mt-2.5 text-xs text-muted-foreground">
              {t('writingStyle.styles.memory', { mb: data.cache_mb_per_style.toLocaleString() })}
            </p>
          ) : null}
        </div>
      </SettingSection>
      <StyleSettings key={style.id} style={style} onDeleted={() => select(undefined)} />
      <CalibrationCard style={style} apps={appsIn(data, style.id).map(appLabel)} />
      <SettingSection title={t('writingStyle.settings.learnsFrom', { style: style.name })}>
        <PersonalExamples styleId={style.id} />
        <CorrectionNotes styleId={style.id} />
        <ExportCorrections />
        <ResetWritingStyle style={style} />
      </SettingSection>
      <RecentCorrections style={style} />
    </>
  );
}
