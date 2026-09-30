import { Check, Mic } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { displayLabelForKey, modifierSideHint } from '@/lib/utils/keyCodes';

/**
 * Building blocks for the Poster onboarding: every step fills the window
 * with its own color, and text and buttons take theirs from the
 * `--poster-bg` / `--poster-fg` variables the window sets.
 */

export const DISPLAY_FONT = 'font-[ui-rounded,"SF_Pro_Rounded",system-ui,sans-serif]';

export function Headline({
  children,
  size = 'lg',
}: {
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  return (
    <h1
      className={cn(
        DISPLAY_FONT,
        'm-0 font-bold leading-[1.02] tracking-[-0.03em] text-balance',
        size === 'md' && 'text-[34px]',
        size === 'lg' && 'text-[44px]',
        size === 'xl' && 'text-[84px] leading-none tracking-[-0.04em]',
      )}
    >
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="m-0 max-w-[540px] text-[15px] leading-relaxed opacity-80">{children}</p>;
}

type ButtonKind = 'primary' | 'outline' | 'ghost' | 'success';

export function PosterButton({
  kind = 'primary',
  onClick,
  disabled,
  children,
  icon,
  autoFocus,
}: {
  kind?: ButtonKind;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  icon?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // biome-ignore lint/a11y/noAutofocus: each step has one obvious next action
      autoFocus={autoFocus}
      className={cn(
        'inline-flex h-[46px] items-center gap-2 whitespace-nowrap rounded-full px-[22px] text-[15px] font-semibold transition-opacity',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--poster-fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--poster-bg)]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        kind === 'primary' && 'bg-[var(--poster-fg)] text-[var(--poster-bg)]',
        kind === 'outline' &&
          'border-[1.5px] border-[var(--poster-fg)] bg-transparent text-[var(--poster-fg)]',
        kind === 'ghost' &&
          'bg-transparent px-3.5 font-medium text-[var(--poster-fg)] opacity-75 hover:opacity-100',
        kind === 'success' && 'bg-[#34C759] text-[#0B2A14]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Room for one short status, such as "Working…" or an error, that's kept
 * whether or not there's anything to say, so nothing below it moves.
 */
export function StatusLine({ children }: { children?: string | null }) {
  return (
    <p
      className="m-0 line-clamp-2 min-h-10 max-w-[600px] text-[13px] leading-5 opacity-85"
      title={children ?? undefined}
      aria-live="polite"
    >
      {children}
    </p>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-2.5">{children}</div>;
}

/** A green card that says a step worked. */
export function SuccessCard({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex max-w-[600px] items-center gap-3 rounded-2xl border-[1.5px] border-[#34C759] bg-[#34C759]/15 px-4 py-3.5">
      <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#34C759]">
        <Check className="h-[18px] w-[18px] text-white" strokeWidth={3} aria-hidden />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        <span className="text-[13px] opacity-80">{detail}</span>
      </div>
    </div>
  );
}

/** A soft panel on the step's color, for notes and progress. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex max-w-[600px] flex-col gap-2.5 rounded-2xl bg-white/12 px-[18px] py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ percent, tone }: { percent: number; tone?: 'fail' }) {
  return (
    <div className="h-1.5 rounded-full bg-[color-mix(in_srgb,var(--poster-fg)_22%,transparent)]">
      <div
        className={cn(
          'h-1.5 rounded-full transition-[width] duration-300',
          tone === 'fail' ? 'bg-[#FF9A85]' : 'bg-[var(--poster-fg)]',
        )}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

/**
 * The user's chord as keycaps. `down` sinks them, the way they move while
 * the real keys are held. Right- or left-hand modifiers get a small badge.
 */
export function Keycaps({
  keys,
  down = false,
  size = 'sm',
  tone,
}: {
  keys: string[];
  down?: boolean;
  size?: 'sm' | 'md' | 'xl';
  tone?: 'success';
}) {
  const edge = tone === 'success' ? '#34C759' : '#1D1B19';
  return (
    <span className={cn('inline-flex items-end', size === 'xl' ? 'gap-3.5' : 'gap-1.5')}>
      {keys.map((key) => {
        const side = modifierSideHint(key);
        return (
          <kbd
            key={key}
            className={cn(
              'relative inline-flex items-center justify-center border-2 bg-white font-mono font-medium text-[#1D1B19] transition-all duration-75',
              size === 'xl' && 'h-24 min-w-24 rounded-[20px] px-5 text-[40px]',
              size === 'md' && 'h-[52px] min-w-[52px] rounded-xl px-3 text-[22px]',
              size === 'sm' && 'h-8 min-w-8 rounded-lg px-2 text-sm',
              down && 'bg-[#FFE9A8]',
            )}
            style={{
              borderColor: edge,
              boxShadow: `0 ${down ? 2 : size === 'xl' ? 10 : 4}px 0 ${edge}`,
              transform: `translateY(${down ? (size === 'xl' ? 8 : 2) : 0}px)`,
            }}
          >
            {displayLabelForKey(key)}
            {side ? (
              <span className="absolute -top-2 -right-2 rounded bg-[#1D1B19] px-1 py-px font-mono text-[9px] leading-none text-white">
                {side}
              </span>
            ) : null}
          </kbd>
        );
      })}
    </span>
  );
}

/** A Dictate button next to the user's keys, wherever a step asks them to talk. */
export function SpeakRow({
  keys,
  listening,
  disabled,
  onDictate,
  dictateLabel,
  stopLabel,
  orHoldLabel,
}: {
  keys: string[];
  listening: boolean;
  disabled?: boolean;
  onDictate: () => void;
  dictateLabel: string;
  stopLabel: string;
  orHoldLabel: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', disabled && 'opacity-45')}>
      <button
        type="button"
        onClick={onDictate}
        disabled={disabled}
        className="inline-flex h-11 min-w-[124px] items-center justify-center gap-2 rounded-full bg-[var(--poster-fg)] px-[18px] text-sm font-semibold text-[var(--poster-bg)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--poster-fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--poster-bg)] disabled:cursor-not-allowed"
      >
        <Mic className="h-4 w-4" aria-hidden />
        {listening ? stopLabel : dictateLabel}
      </button>
      <span className="text-[13px] opacity-80">{orHoldLabel}</span>
      <Keycaps keys={keys} down={listening} />
      <ListeningBars visible={listening} />
    </div>
  );
}

/** Always laid out, and only shown while listening, so the row keeps its size. */
function ListeningBars({ visible }: { visible: boolean }) {
  return (
    <span
      className={cn('inline-flex h-7 items-center gap-[3px]', !visible && 'invisible')}
      aria-hidden
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={i}
          className="w-1 animate-pulse rounded-sm bg-[var(--poster-fg)]"
          style={{ height: `${8 + ((i * 7) % 18)}px`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  );
}
