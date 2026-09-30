import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { progressPercent } from '@/components/Setup/useModelDownloads';
import { apiClient } from '@/lib/api/client';
import type { ActiveDownloadTask, ModelReadiness } from '@/lib/api/types';
import type { DictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import {
  FALLBACK_STT_MODEL,
  missingDiskMb,
  RETRY_DELAY_MS,
  shouldRetryAutomatically,
} from './onboardingFlow';

export type ModelState = 'waiting' | 'next' | 'downloading' | 'ready' | 'failed';

export interface ModelProgress {
  model: ModelReadiness | undefined;
  state: ModelState;
  /** 0 to 100. */
  percent: number;
  /** Why the last attempt failed, as the server said it. */
  error: string | null;
}

export interface OnboardingDownloads {
  speech: ModelProgress;
  cleanup: ModelProgress | null;
  /** Speech, and cleanup when it's on: dictation can run. */
  ready: boolean;
  /** Retries are used up; the user decides what's next. */
  failed: ModelProgress | null;
  /** MB to free before the downloads fit, or 0. */
  diskShortMb: number;
  start: () => void;
  retry: () => void;
  useSmallerSpeechModel: () => void;
  checkDiskAgain: () => void;
  /** Share of both downloads done, 0 to 100, for the line along the top. */
  overall: number;
}

/**
 * Download the dictation models for onboarding: speech first, then cleanup.
 *
 * Once `started`, a model that is neither ready nor downloading is requested
 * again, so downloads stopped by a quit (Input Monitoring forces one) pick
 * up after the relaunch. A failed download is retried by itself a few times
 * before the user is asked.
 */
export function useOnboardingDownloads(
  readiness: DictationReadiness,
  started: boolean,
  onStart: () => void,
): OnboardingDownloads {
  const queryClient = useQueryClient();
  const { update } = useCaptureSettings();
  const [failures, setFailures] = useState<Record<string, number>>({});
  const requested = useRef(new Set<string>());

  const { data: tasks } = useQuery({
    queryKey: ['activeTasks'],
    queryFn: () => apiClient.getActiveTasks(),
    refetchInterval: 1000,
  });
  const { data: disk, refetch: refetchDisk } = useQuery({
    queryKey: ['modelsDiskSpace'],
    queryFn: () => apiClient.getModelsDiskSpace(),
  });

  const taskFor = useCallback(
    (model: ModelReadiness | undefined): ActiveDownloadTask | undefined =>
      model ? tasks?.downloads.find((d) => d.model_name === model.model_name) : undefined,
    [tasks],
  );

  const needsCleanup = readiness.autoRefine;
  const models = useMemo(
    () => [readiness.stt, needsCleanup ? readiness.llm : undefined].filter(Boolean),
    [readiness.stt, readiness.llm, needsCleanup],
  ) as ModelReadiness[];

  const neededMb = models.filter((m) => !m.ready).reduce((sum, m) => sum + (m.size_mb ?? 0), 0);
  const diskShortMb = disk ? missingDiskMb(disk.free_mb, neededMb) : 0;

  const request = useCallback(
    (model: ModelReadiness) => {
      requested.current.add(model.model_name);
      apiClient
        .triggerModelDownload(model.model_name)
        .catch((err) => console.warn('[onboarding] download request failed:', err))
        .finally(() => queryClient.invalidateQueries({ queryKey: ['activeTasks'] }));
    },
    [queryClient],
  );

  // Refresh readiness the moment a download disappears from the task list.
  const running = tasks?.downloads.filter((d) => d.status === 'downloading').length ?? 0;
  const lastRunning = useRef(running);
  useEffect(() => {
    if (running < lastRunning.current) {
      queryClient.invalidateQueries({ queryKey: ['capture-readiness'] });
    }
    lastRunning.current = running;
  }, [running, queryClient]);

  // Count failures, and retry by itself while that's still allowed.
  useEffect(() => {
    for (const model of models) {
      const task = taskFor(model);
      if (task?.status !== 'error' || !requested.current.has(model.model_name)) continue;
      requested.current.delete(model.model_name);
      const count = (failures[model.model_name] ?? 0) + 1;
      setFailures((f) => ({ ...f, [model.model_name]: count }));
      if (shouldRetryAutomatically(count)) {
        setTimeout(() => {
          apiClient
            .cancelDownload(model.model_name)
            .catch(() => {})
            .finally(() => request(model));
        }, RETRY_DELAY_MS);
      }
    }
  }, [models, taskFor, failures, request]);

  // Start (or restart) the next model once downloads were started: speech,
  // then cleanup.
  useEffect(() => {
    if (!started || diskShortMb > 0) return;
    const next = models.find((m) => !m.ready);
    if (!next) return;
    const task = taskFor(next);
    if (task?.status === 'downloading' || task?.status === 'extracting') return;
    if (task?.status === 'error') return;
    if (requested.current.has(next.model_name)) return;
    request(next);
  }, [started, diskShortMb, models, taskFor, request]);

  const progress = (model: ModelReadiness | undefined, isNext: boolean): ModelProgress => {
    const task = taskFor(model);
    const failuresSoFar = model ? (failures[model.model_name] ?? 0) : 0;
    if (model?.ready) return { model, state: 'ready', percent: 100, error: null };
    if (task?.status === 'error' || failuresSoFar > 0) {
      const percent = progressPercent(task) ?? 0;
      const gaveUp = task?.status === 'error' && !shouldRetryAutomatically(failuresSoFar);
      if (gaveUp) return { model, state: 'failed', percent, error: task?.error ?? null };
    }
    if (task && task.status !== 'error') {
      return { model, state: 'downloading', percent: progressPercent(task) ?? 0, error: null };
    }
    return {
      model,
      state: started ? (isNext ? 'downloading' : 'next') : 'waiting',
      percent: 0,
      error: null,
    };
  };

  const firstMissing = models.find((m) => !m.ready)?.model_name;
  const speech = progress(readiness.stt, readiness.stt?.model_name === firstMissing);
  const cleanup = needsCleanup
    ? progress(readiness.llm, readiness.llm?.model_name === firstMissing)
    : null;
  const failed = [speech, cleanup].find((p) => p?.state === 'failed') ?? null;
  const ready = speech.state === 'ready' && (!cleanup || cleanup.state === 'ready');
  const overall = cleanup ? (speech.percent + cleanup.percent) / 2 : speech.percent;

  const retry = useCallback(() => {
    if (!failed?.model) return;
    const model = failed.model;
    setFailures((f) => ({ ...f, [model.model_name]: 0 }));
    apiClient
      .cancelDownload(model.model_name)
      .catch(() => {})
      .finally(() => request(model));
  }, [failed, request]);

  const useSmallerSpeechModel = useCallback(() => {
    const current = readiness.stt?.model_name;
    if (current) apiClient.cancelDownload(current).catch(() => {});
    update({ stt_model: FALLBACK_STT_MODEL });
    queryClient.invalidateQueries({ queryKey: ['capture-readiness'] });
  }, [readiness.stt, update, queryClient]);

  return {
    speech,
    cleanup,
    ready,
    failed,
    diskShortMb,
    start: onStart,
    retry,
    useSmallerSpeechModel,
    checkDiskAgain: () => void refetchDisk(),
    overall,
  };
}
