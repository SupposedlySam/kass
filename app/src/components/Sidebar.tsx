import { Link, useMatchRoute } from '@tanstack/react-router';
import {
  Box,
  Captions,
  ChartColumn,
  CircleAlert,
  type LucideIcon,
  SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import voiceboxLogo from '@/assets/voicebox-logo.png';
import { type ModelAlerts, useModelAlerts } from '@/lib/hooks/useModelAlerts';
import { cn } from '@/lib/utils/cn';
import { version } from '../../package.json';

const tabs: Array<{ id: string; path: string; icon: LucideIcon; labelKey: string }> = [
  { id: 'captures', path: '/captures', icon: Captions, labelKey: 'nav.captures' },
  { id: 'insights', path: '/insights', icon: ChartColumn, labelKey: 'nav.insights' },
  { id: 'models', path: '/models', icon: Box, labelKey: 'nav.models' },
  { id: 'settings', path: '/settings', icon: SlidersHorizontal, labelKey: 'nav.settings' },
];

/** The app's left rail: logo, labeled icons, version. */
export function Sidebar() {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const modelAlerts = useModelAlerts();

  return (
    <nav
      aria-label="Main"
      className="w-[68px] shrink-0 flex flex-col items-center gap-1 pt-3 pb-3 bg-sidebar border-r border-border"
    >
      <img src={voiceboxLogo} alt="Voicebox" className="mb-4 h-8 w-8 object-contain" />

      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = matchRoute({ to: tab.path, fuzzy: true });
        const alerts = tab.id === 'models' ? modelAlerts : undefined;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            aria-description={alerts?.level ? alerts.messages.join(' ') : undefined}
            className={cn(
              'group relative flex h-[52px] w-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
            {t(tab.labelKey)}
            {alerts?.level && <AlertBadge alerts={alerts} />}
          </Link>
        );
      })}

      <span className="mt-auto font-mono text-[10px] text-muted-foreground/60">v{version}</span>
    </nav>
  );
}

/**
 * A warning or error mark in the tab's corner, with a tip on hover or focus
 * that says what's wrong.
 */
function AlertBadge({ alerts }: { alerts: ModelAlerts }) {
  const Icon = alerts.level === 'error' ? CircleAlert : TriangleAlert;
  return (
    <>
      <Icon
        aria-hidden
        className={cn(
          'absolute right-1.5 top-1.5 h-3 w-3 rounded-full bg-sidebar',
          alerts.level === 'error' ? 'text-destructive' : 'text-warning',
        )}
        strokeWidth={2.2}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden w-60 -translate-y-1/2 flex-col gap-1 rounded-md border border-border bg-popover px-2.5 py-2 text-left text-[11px] leading-snug text-popover-foreground shadow-md group-hover:flex group-focus-visible:flex"
      >
        {alerts.messages.map((message) => (
          <span key={message}>{message}</span>
        ))}
      </span>
    </>
  );
}
