import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { openOnboarding } from '@/components/Onboarding/openOnboarding';
import { SettingRow, SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import { usePlatform } from '@/platform/PlatformContext';

/** A feature, and the screen where it's set up or used. */
const FEATURES = [
  { key: 'styles', to: '/settings/writing-style' },
  { key: 'teach', to: '/settings/writing-style' },
  { key: 'dictionary', to: '/settings/dictionary' },
  { key: 'fixCapture', to: '/captures' },
  { key: 'formatting', to: '/settings/transcription' },
  { key: 'handsFree', to: '/settings/dictation' },
  { key: 'commandMode', to: '/settings/command-mode' },
  { key: 'palette', to: null },
  { key: 'insights', to: '/insights' },
] as const;

/**
 * Everything Kass does beyond hold-and-talk, each with a way to try it.
 * Onboarding's "Show me now" opens this page.
 */
export function FeaturesPage() {
  const { t } = useTranslation();
  const isTauri = usePlatform().metadata.isTauri;
  return (
    <>
      <SettingSection
        title={t('settings.features.title')}
        description={t('settings.features.description')}
      >
        {FEATURES.map(({ key, to }) => (
          <SettingRow
            key={key}
            title={t(`settings.features.items.${key}.title`)}
            description={t(`settings.features.items.${key}.description`)}
            action={
              to ? (
                <Button asChild size="sm" variant="outline">
                  <Link to={to}>{t('settings.features.tryIt')}</Link>
                </Button>
              ) : (
                <kbd className="rounded border border-input bg-secondary px-2 py-1 font-mono text-xs">
                  ⌘K
                </kbd>
              )
            }
          />
        ))}
      </SettingSection>
      {isTauri ? (
        <SettingSection title={t('settings.features.onboardingTitle')}>
          <SettingRow
            title={t('settings.features.onboarding.title')}
            description={t('settings.features.onboarding.description')}
            action={
              <Button size="sm" variant="outline" onClick={() => openOnboarding()}>
                {t('settings.features.onboarding.action')}
              </Button>
            }
          />
        </SettingSection>
      ) : null}
    </>
  );
}
