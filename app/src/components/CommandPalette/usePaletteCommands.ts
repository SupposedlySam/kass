import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { useCaptureSettings } from '@/lib/hooks/useSettings';
import { usePlatform } from '@/platform/PlatformContext';
import { type Theme, useUIStore } from '@/stores/uiStore';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Short mono hint on the right of the row. */
  hint: string;
  run: () => void;
}

/** Everything the palette can do besides opening a capture. */
export function usePaletteCommands(): PaletteCommand[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isTauri = usePlatform().metadata.isTauri;
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const { settings: captureSettings } = useCaptureSettings();

  const go = (
    id: string,
    label: string,
    to: string,
    hint = t('palette.keys.go'),
  ): PaletteCommand => ({
    id,
    label,
    hint,
    run: () => navigate({ to }),
  });
  const themeCommand = (value: Theme, label: string): PaletteCommand => ({
    id: `theme-${value}`,
    label,
    hint: t('palette.keys.theme'),
    run: () => setTheme(value),
  });
  const settings = t('palette.keys.settings');

  const commands: PaletteCommand[] = [
    go('captures', t('palette.cmd.captures'), '/captures'),
    go('models', t('palette.cmd.models'), '/models'),
    go('settings-general', t('palette.cmd.settingsGeneral'), '/settings', settings),
    go('settings-dictation', t('palette.cmd.settingsDictation'), '/settings/dictation', settings),
    go(
      'settings-command-mode',
      t('palette.cmd.settingsCommandMode'),
      '/settings/command-mode',
      settings,
    ),
    go(
      'settings-transcription',
      t('palette.cmd.settingsTranscription'),
      '/settings/transcription',
      settings,
    ),
    go(
      'settings-writing-style',
      t('palette.cmd.settingsWritingStyle'),
      '/settings/writing-style',
      settings,
    ),
  ];
  // Logs come from the desktop shell; the settings rail hides them on web too.
  if (isTauri) {
    commands.push(
      go('settings-logs', t('palette.cmd.settingsLogs'), '/settings/logs', settings),
      go('reports', t('palette.cmd.reports'), '/reports'),
    );
  }
  commands.push(
    go('settings-features', t('palette.cmd.settingsFeatures'), '/settings/features', settings),
    go('setup', t('palette.cmd.setup'), '/setup'),
    // Teaching starts from the writing style page.
    go('calibrate', t('palette.cmd.calibrate'), '/settings/writing-style', t('palette.keys.style')),
  );
  // Transforms rewrite the text selected in the app the user came from; Rust
  // finds it, reads the selection and replaces it (docs/plans/COMMAND_MODE.md).
  if (isTauri) {
    for (const transform of captureSettings?.command_transforms ?? []) {
      commands.push({
        id: `transform-${transform.id}`,
        label: t('palette.cmd.transform', { name: transform.name }),
        hint: t('palette.keys.transform'),
        run: () => {
          invoke('command_run', { instruction: transform.name }).catch((err) =>
            console.warn('[palette] command_run failed:', err),
          );
        },
      });
    }
  }
  // Offer only the themes the user isn't already on.
  if (theme !== 'light') commands.push(themeCommand('light', t('palette.cmd.themeLight')));
  if (theme !== 'dark') commands.push(themeCommand('dark', t('palette.cmd.themeDark')));
  if (theme !== 'system') commands.push(themeCommand('system', t('palette.cmd.themeSystem')));
  return commands;
}
