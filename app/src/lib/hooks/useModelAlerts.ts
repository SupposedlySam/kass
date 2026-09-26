import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useDictationReadiness } from '@/lib/hooks/useDictationReadiness';

export type ModelAlertLevel = 'error' | 'warning';

export interface ModelAlerts {
  /** The worst problem, or ``null`` when every model is fine. */
  level: ModelAlertLevel | null;
  /** One line per problem, errors first, for the Models tab's tip. */
  messages: string[];
}

/**
 * What's wrong with the models, for the Models tab. A model dictation needs
 * that isn't downloaded is an error, since the chord can't record without it;
 * a failed download is a warning.
 */
export function useModelAlerts(): ModelAlerts {
  const { t } = useTranslation();
  const readiness = useDictationReadiness();
  // Shares the Models screen's query, so this rides its polling.
  const { data: activeTasks } = useQuery({
    queryKey: ['activeTasks'],
    queryFn: () => apiClient.getActiveTasks(),
    refetchInterval: 5_000,
  });

  const errors: string[] = [];
  if (readiness.stt && !readiness.stt.ready) {
    errors.push(
      t('nav.alerts.missing', {
        role: t('models.roles.transcription'),
        name: readiness.stt.display_name,
      }),
    );
  }
  if (readiness.autoRefine && readiness.llm && !readiness.llm.ready) {
    errors.push(
      t('nav.alerts.missing', {
        role: t('models.roles.refinement'),
        name: readiness.llm.display_name,
      }),
    );
  }
  const warnings = (activeTasks?.downloads ?? [])
    .filter((dl) => dl.status === 'error')
    .map((dl) => t('nav.alerts.downloadFailed', { name: dl.model_name }));

  return {
    level: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : null,
    messages: [...errors, ...warnings],
  };
}
