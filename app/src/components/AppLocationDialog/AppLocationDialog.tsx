import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { usePlatform } from '@/platform/PlatformContext';

interface AppLocation {
  needs_move: boolean;
  path: string | null;
  replaces_existing: boolean;
}

// Module scope so it asks once per launch, not once per mount.
let asked = false;

/**
 * Asks to move Herga into /Applications when it runs from anywhere else
 * (the build folder, Downloads, a disk image). macOS permissions don't work
 * reliably for an app outside Applications: Herga can be missing from
 * the Input Monitoring list, or its switch is on but does nothing. Moving
 * copies the app, puts the old copies in the Trash and relaunches.
 */
export function AppLocationDialog() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const [location, setLocation] = useState<AppLocation | null>(null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (asked || !platform.metadata.isTauri) return;
    asked = true;
    invoke<AppLocation>('app_location')
      .then((result) => {
        setLocation(result);
        setOpen(result.needs_move);
      })
      .catch((err) => console.warn('[app-location] check failed:', err));
  }, [platform.metadata.isTauri]);

  const move = async () => {
    setMoving(true);
    setError(null);
    try {
      // The app quits and reopens from Applications when this succeeds.
      await invoke('move_to_applications');
    } catch (err) {
      setError(String(err));
      setMoving(false);
    }
  };

  if (!location) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('appLocation.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('appLocation.description', { path: location.path ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {location.replaces_existing && (
          <p className="text-sm text-muted-foreground">{t('appLocation.replaces')}</p>
        )}
        {error && (
          <div className="space-y-1 text-sm">
            <p className="text-destructive">{error}</p>
            <p className="text-muted-foreground">{t('appLocation.manual')}</p>
          </div>
        )}
        <AlertDialogFooter>
          <Button variant="ghost" disabled={moving} onClick={() => setOpen(false)}>
            {t('appLocation.later')}
          </Button>
          <Button disabled={moving} onClick={move}>
            {moving ? t('appLocation.moving') : t('appLocation.move')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
