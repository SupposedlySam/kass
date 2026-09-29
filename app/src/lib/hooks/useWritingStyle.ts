import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type {
  MovedCorrections,
  StyledApp,
  WritingStyle,
  WritingStylesResponse,
} from '@/lib/api/types';

/** Per style: `[...WRITING_STYLE_KEY, styleId]`. Invalidating the prefix refreshes every style. */
export const WRITING_STYLE_KEY = ['writing-style'] as const;
export const WRITING_STYLES_KEY = ['writing-styles'] as const;

/** What Voicebox has learned about how the user punctuates in a style (the default when none). */
export function useWritingStyle(styleId?: string | null) {
  return useQuery({
    queryKey: [...WRITING_STYLE_KEY, styleId ?? 'default'],
    queryFn: () => apiClient.getWritingStyle(styleId),
    staleTime: 60_000,
  });
}

/** Every writing style, and every app with the style it uses. */
export function useWritingStyles() {
  return useQuery({
    queryKey: WRITING_STYLES_KEY,
    queryFn: () => apiClient.listWritingStyles(),
    staleTime: 60_000,
  });
}

/** Lookups over the styles listing. */
export function stylesById(data: WritingStylesResponse | undefined): Map<string, WritingStyle> {
  return new Map((data?.styles ?? []).map((style) => [style.id, style]));
}

export function defaultStyle(data: WritingStylesResponse | undefined): WritingStyle | undefined {
  return data?.styles.find((style) => style.is_default) ?? data?.styles[0];
}

/**
 * Put an app in a style, which also confirms a new app's style. Its
 * corrections come along or stay (`corrections`), so everything learned is
 * refetched. Ask first with `useMoveApp`.
 */
/** Keep every new app in the style it already uses, in one save. */
export function useConfirmApps() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apps: Pick<StyledApp, 'bundle_id' | 'name'>[]) => apiClient.confirmApps(apps),
    onMutate: async (apps) => {
      await queryClient.cancelQueries({ queryKey: WRITING_STYLES_KEY });
      const previous = queryClient.getQueryData<WritingStylesResponse>(WRITING_STYLES_KEY);
      if (previous) {
        const ids = new Set(apps.map((app) => app.bundle_id));
        queryClient.setQueryData<WritingStylesResponse>(WRITING_STYLES_KEY, {
          ...previous,
          apps: previous.apps.map((a) => (ids.has(a.bundle_id) ? { ...a, confirmed: true } : a)),
        });
      }
      return { previous };
    },
    onError: (error: Error, _apps, context) => {
      if (context?.previous) queryClient.setQueryData(WRITING_STYLES_KEY, context.previous);
      toast({
        title: t('writingStyle.styles.assignFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: (data) => queryClient.setQueryData(WRITING_STYLES_KEY, data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['captures', 'apps'] }),
  });
}

export function useAssignAppStyle() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      app,
      styleId,
      corrections = 'bring',
    }: {
      app: Pick<StyledApp, 'bundle_id' | 'name'>;
      styleId: string;
      corrections?: MovedCorrections;
    }) => apiClient.assignAppStyle(app.bundle_id, styleId, app.name, corrections),
    onMutate: async ({ app, styleId }) => {
      // Moves at once, so a dragged chip lands where it was dropped.
      await queryClient.cancelQueries({ queryKey: WRITING_STYLES_KEY });
      const previous = queryClient.getQueryData<WritingStylesResponse>(WRITING_STYLES_KEY);
      if (previous) {
        const known = previous.apps.some((a) => a.bundle_id === app.bundle_id);
        queryClient.setQueryData<WritingStylesResponse>(WRITING_STYLES_KEY, {
          ...previous,
          apps: known
            ? previous.apps.map((a) =>
                a.bundle_id === app.bundle_id ? { ...a, style_id: styleId, confirmed: true } : a,
              )
            : [
                ...previous.apps,
                {
                  bundle_id: app.bundle_id,
                  name: app.name,
                  style_id: styleId,
                  confirmed: true,
                  count: 0,
                  corrections: 0,
                },
              ],
        });
      }
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(WRITING_STYLES_KEY, context.previous);
      toast({
        title: t('writingStyle.styles.assignFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSuccess: (data) => queryClient.setQueryData(WRITING_STYLES_KEY, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['captures', 'apps'] });
      queryClient.invalidateQueries({ queryKey: WRITING_STYLE_KEY });
      queryClient.invalidateQueries({ queryKey: ['personal-examples'] });
      queryClient.invalidateQueries({ queryKey: ['correction-notes'] });
    },
  });
}
