import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '@/platform/PlatformContext';

/**
 * Herga downloads a newer release in the background (tauri
 * src-tauri/src/updater.rs); it installs on restart or the next quit.
 */
export type UpdateStatus =
  | { state: 'current' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string };

/** Where the background update is, and a restart into it once it's ready. */
export function useUpdateCheck(): { status: UpdateStatus; restart: () => Promise<void> } {
  const platform = usePlatform();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'current' });

  useEffect(() => {
    if (!platform.metadata.isTauri) return;
    let disposed = false;
    let release: (() => void) | null = null;
    listen<UpdateStatus>('update:status', ({ payload }) => setStatus(payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else release = unlisten;
      })
      .catch((err) => console.warn('[update] listen failed:', err));
    invoke<UpdateStatus>('update_status')
      .then((current) => {
        if (!disposed) setStatus(current);
      })
      .catch((err) => console.warn('[update] status failed:', err));
    return () => {
      disposed = true;
      release?.();
    };
  }, [platform.metadata.isTauri]);

  const restart = useCallback(() => invoke<void>('restart_to_update'), []);
  return { status, restart };
}
