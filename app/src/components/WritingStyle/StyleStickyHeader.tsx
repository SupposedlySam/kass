import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTile } from '@/components/CapturesTab/CaptureAppList';
import type { StyledApp, WritingStyle } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { appLabel } from './StyleBoard';

/** App icons the header shows before "+N more". */
const HEADER_APPS = 8;

/**
 * Pins the selected style's name and apps to the top of the page once the
 * style cards scroll out of view, so every setting below says whose it is.
 * Place it first in the block that holds the style's settings; it sticks
 * until that block ends. It takes no space, so showing it shifts nothing.
 */
export function StyleStickyHeader({ style, apps }: { style: WritingStyle; apps: StyledApp[] }) {
  const { t } = useTranslation();
  const sentinel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Shown only once the block's top has scrolled above the view, not
        // while it's still below.
        const above = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
        setShown(!entry.isIntersecting && above);
      },
      // The settings pane scrolls, not the window, and it starts below the
      // title bar, so measure against the pane.
      { root: scrollParent(el) },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const icons = apps.slice(0, HEADER_APPS);
  const rest = apps.length - icons.length;

  return (
    <>
      <div ref={sentinel} aria-hidden />
      <div className="sticky top-0 z-20 h-0">
        <div
          aria-hidden={!shown}
          className={cn(
            '-mx-12 flex items-center gap-3 border-b border-border/70 bg-background/90 px-12 py-2.5 backdrop-blur transition-[opacity,translate] duration-200 ease-out',
            shown ? 'opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
          )}
        >
          <span className="truncate text-sm font-semibold">{style.name}</span>
          {style.is_default && (
            <span className="shrink-0 rounded-full border border-input px-1.5 text-[10.5px] font-semibold text-muted-foreground">
              {t('writingStyle.styles.default')}
            </span>
          )}
          <ul className="ml-auto flex shrink-0 items-center gap-1.5">
            {icons.map((app) => (
              <li key={app.bundle_id} title={appLabel(app)}>
                <AppTile
                  bundleId={app.bundle_id}
                  name={appLabel(app)}
                  className="size-6 rounded-md text-[11px]"
                />
              </li>
            ))}
            {rest > 0 && (
              <li className="text-xs text-muted-foreground">
                {t('writingStyle.styles.more', { count: rest })}
              </li>
            )}
            {apps.length === 0 && (
              <li className="text-xs text-muted-foreground">
                {t('writingStyle.styles.count', { count: 0 })}
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

/** The nearest ancestor that scrolls vertically, or null for the window. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}
