import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { usePlatform } from '@/platform/PlatformContext';

/**
 * Keep Rust's sound cue settings (`sound_cues.rs`) in step with the saved
 * `sound_cues` / `sound_cue_volume` capture settings. Rust plays the cues
 * itself and remembers the last values, so until settings load nothing is
 * sent and the remembered ones stand.
 *
 * Call once from the main app shell.
 */
export function useSoundCueSync() {
  const platform = usePlatform();
  const { settings } = useCaptureSettings();
  const enabled = settings?.sound_cues;
  const volume = settings?.sound_cue_volume;

  useEffect(() => {
    if (!platform.metadata.isTauri) return;
    if (enabled === undefined || volume === undefined) return;
    invoke('configure_sound_cues', { enabled, volume }).catch((err) => {
      console.warn('[sound-cues] configure_sound_cues failed:', err);
    });
  }, [platform.metadata.isTauri, enabled, volume]);
}
