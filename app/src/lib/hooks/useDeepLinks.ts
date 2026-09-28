import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';
import { usePlatform } from '@/platform/PlatformContext';
import { router } from '@/router';

/**
 * Open `voicebox://` links (`deep_link.rs`) in the router, e.g.
 * `voicebox://captures?capture=<id>` opens that capture.
 *
 * Rust keeps the latest link until it is taken, so a link that launched the
 * app waits until the router is on screen (`ready`). The event is only a
 * signal to take it.
 *
 * Call once from the main app shell.
 */
export function useDeepLinks(ready: boolean) {
  const platform = usePlatform();

  useEffect(() => {
    if (!platform.metadata.isTauri || !ready) return;
    const take = () => {
      invoke<string | null>('take_deep_link')
        .then((href) => {
          if (href) router.navigate({ href });
        })
        .catch((err) => console.warn('[deep-link] take_deep_link failed:', err));
    };
    take();
    const unlisten = listen('deep-link', take);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [platform.metadata.isTauri, ready]);
}
