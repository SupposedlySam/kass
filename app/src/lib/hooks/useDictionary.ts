import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api/client';
import type { DictionaryEntryCreate, DictionaryEntryUpdate } from '@/lib/api/types';

/** Every entry is `DICTIONARY_KEY`; an app's merged view is `[...DICTIONARY_KEY, 'resolved', bundleId]`. */
export const DICTIONARY_KEY = ['dictionary'] as const;

/** Every dictionary entry, in every scope. */
export function useDictionary() {
  return useQuery({
    queryKey: DICTIONARY_KEY,
    queryFn: () => apiClient.listDictionary(),
  });
}

/** What applies in one app: its entries, its style's and everywhere's. */
export function useResolvedDictionary(bundleId: string | null) {
  return useQuery({
    queryKey: [...DICTIONARY_KEY, 'resolved', bundleId],
    queryFn: () => apiClient.resolveDictionary(bundleId as string),
    enabled: !!bundleId,
  });
}

/** Adding and editing show their errors next to the inputs, so they don't toast. */
export function useAddDictionaryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DictionaryEntryCreate) => apiClient.createDictionaryEntry(body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY }),
  });
}

export function useUpdateDictionaryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DictionaryEntryUpdate }) =>
      apiClient.updateDictionaryEntry(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY }),
  });
}

export function useDeleteDictionaryEntry() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteDictionaryEntry(id),
    onError: (error: Error) =>
      toast({
        title: t('dictionary.entries.deleteFailed'),
        description: error.message,
        variant: 'destructive',
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DICTIONARY_KEY }),
  });
}
