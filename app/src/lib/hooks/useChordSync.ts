import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDictationReadiness } from '@/lib/hooks/useDictationReadiness';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { usePlatform } from '@/platform/PlatformContext';

/**
 * Spawn (or quiet) the global hotkey monitor from the saved
 * `capture_settings.hotkey_enabled` flag and Input Monitoring, keep its
 * bindings in sync with the user's chords, and tell Rust whether dictation
 * can run yet.
 *
 *  - hotkey_enabled = false OR Input Monitoring off → `disable_hotkey`. We
 *    never call `enable_hotkey` then, so the macOS Input Monitoring prompt is
 *    never triggered for users who haven't opted in.
 *  - Otherwise → `enable_hotkey` with the saved chords, re-run whenever a
 *    chord changes.
 *  - Models missing → the dictation gate is set: a chord press shows "Still
 *    downloading" in the pill instead of recording into nowhere. Cleared
 *    once the models are ready.
 *
 * `paused` hands all of this to another window (onboarding) for a while.
 */
export function useChordSync({ paused = false }: { paused?: boolean } = {}) {
  const { t } = useTranslation();
  const platform = usePlatform();
  const { settings } = useCaptureSettings();
  const { inputMonitoring, missing } = useDictationReadiness();
  const enabled = settings?.hotkey_enabled;
  const pushKeys = settings?.chord_push_to_talk_keys;
  const toggleKeys = settings?.chord_toggle_to_talk_keys;
  const commandKeys = settings?.chord_command_keys ?? [];
  const modelsReady = !missing.includes('stt') && !missing.includes('llm');
  const gate = modelsReady ? null : t('dictation.stillDownloading');

  useEffect(() => {
    if (!platform.metadata.isTauri || paused) return;
    if (enabled === undefined || !pushKeys || !toggleKeys) return;
    const shouldArm = enabled && inputMonitoring;
    const command = shouldArm ? 'enable_hotkey' : 'disable_hotkey';
    const args = shouldArm
      ? { pushToTalk: pushKeys, toggleToTalk: toggleKeys, command: commandKeys }
      : {};
    invoke(command, args).catch((err) => {
      console.warn(`[chord-sync] ${command} failed:`, err);
    });
  }, [
    platform.metadata.isTauri,
    paused,
    enabled,
    inputMonitoring,
    // Stringify so a referentially-new array with the same content
    // doesn't fire a redundant invoke on every settings refetch.
    pushKeys?.join(','),
    toggleKeys?.join(','),
    commandKeys.join(','),
  ]);

  useEffect(() => {
    if (!platform.metadata.isTauri || paused) return;
    invoke('set_dictation_gate', { blocked: gate }).catch((err) => {
      console.warn('[chord-sync] set_dictation_gate failed:', err);
    });
  }, [platform.metadata.isTauri, paused, gate]);
}
