import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '@/platform/PlatformContext';
import { version as builtVersion } from '../../../package.json';

/**
 * Herga downloads a newer release in the background (tauri
 * src-tauri/src/updater.rs); it installs on restart or the next quit.
 */
export type UpdateStatus =
  | { state: 'current' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string };

/**
 * The running version, where the background update is, and a restart into
 * it once it's ready. `restarting` is set from the click until Herga quits
 * (stopping the server takes a moment).
 */
export function useUpdateCheck(): {
  version: string;
  status: UpdateStatus;
  restarting: boolean;
  restart: () => void;
} {
  const platform = usePlatform();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'current' });
  // The app's own version, which an update changes; the frontend's is a fallback.
  const [version, setVersion] = useState(builtVersion);
  const [restarting, setRestarting] = useState(false);

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
    getVersion()
      .then((current) => {
        if (!disposed) setVersion(current);
      })
      .catch(() => {});
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

  const restart = useCallback(() => {
    setRestarting(true);
    invoke<void>('restart_to_update').catch((err) => {
      console.warn('[update] restart failed:', err);
      setRestarting(false);
    });
  }, []);
  return { version, status, restarting, restart };
}
