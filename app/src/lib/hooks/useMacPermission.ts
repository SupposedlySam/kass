import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from '@/platform/PlatformContext';

/** How often to ask again while a permission Herga once held reads as missing. */
const WATCH_INTERVAL_MS = 2_000;
/** How long to keep asking before leaving it to window focus. */
const WATCH_LIMIT_MS = 2 * 60_000;

/**
 * Tracks a macOS permission through its `check_*` Tauri command. Checked on
 * mount and on window focus (the user flipping the toggle in System Settings
 * and alt-tabbing back).
 *
 * Right after a reinstall macOS can report a permission Herga already held as
 * missing, and the window may stay hidden, so no focus arrives to check again.
 * When the permission was granted on an earlier launch, it's asked again every
 * few seconds for a couple of minutes so the global keys come back without
 * opening the window. A permission never granted is left to focus alone.
 */
export function useMacPermission(command: string, grantedKey: string) {
  const platform = usePlatform();
  const [needsPermission, setNeedsPermission] = useState(false);
  const [checking, setChecking] = useState(false);

  // Quiet: the background watch doesn't flip `checking`, which the notices
  // show as "Rechecking…".
  const check = useCallback(async (): Promise<boolean> => {
    if (!platform.metadata.isTauri) return true;
    try {
      const trusted = await invoke<boolean>(command);
      setNeedsPermission(!trusted);
      if (trusted) rememberGranted(grantedKey);
      return trusted;
    } catch (err) {
      console.warn(`[permission] ${command} failed:`, err);
      return false;
    }
  }, [platform.metadata.isTauri, command, grantedKey]);

  const recheck = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      return await check();
    } finally {
      setChecking(false);
    }
  }, [check]);

  useEffect(() => {
    if (!platform.metadata.isTauri) return;
    recheck();
    const onFocus = () => {
      recheck();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [platform.metadata.isTauri, recheck]);

  useEffect(() => {
    if (!platform.metadata.isTauri || !needsPermission || !wasGranted(grantedKey)) return;
    const stopAt = Date.now() + WATCH_LIMIT_MS;
    const timer = setInterval(() => {
      if (Date.now() >= stopAt) clearInterval(timer);
      else check();
    }, WATCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [platform.metadata.isTauri, needsPermission, grantedKey, check]);

  return { needsPermission, setNeedsPermission, checking, recheck };
}

function wasGranted(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function rememberGranted(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage can be refused; a reinstall then waits for focus as before.
  }
}
