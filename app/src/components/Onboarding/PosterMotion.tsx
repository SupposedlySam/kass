import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useEffect, useMemo, useState } from 'react';

/**
 * The bigger moments of the Poster onboarding: the color wipe between steps,
 * letters that rise into place, and confetti. The small ones are CSS in
 * poster.css.
 */

/**
 * The window's color. A new color spreads in a circle from `origin` (where
 * the user last clicked) over the one before it.
 */
export function ColorWipe({ color, origin }: { color: string; origin: { x: number; y: number } }) {
  const reduce = useReducedMotion();
  const [under, setUnder] = useState(color);
  const [over, setOver] = useState(color);
  // A step changed before its wipe finished: the next one spreads over that
  // step's color, never back over an older one.
  if (color !== over) {
    setUnder(over);
    setOver(color);
  }
  const at = `${origin.x}px ${origin.y}px`;
  return (
    <div className="pointer-events-none absolute inset-0" style={{ background: under }} aria-hidden>
      {color !== under ? (
        <motion.div
          key={color}
          className="absolute inset-0"
          style={{ background: color }}
          initial={{ clipPath: `circle(0px at ${at})` }}
          animate={{ clipPath: `circle(1400px at ${at})` }}
          transition={{ duration: reduce ? 0 : 0.7, ease: [0.65, 0, 0.35, 1] }}
          onAnimationComplete={() => setUnder(color)}
        />
      ) : null}
    </div>
  );
}

/** Text whose letters rise into place one after another, like it's being said. */
export function RiseLetters({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return <>{text}</>;
  let index = 0;
  const words = text.split(' ');
  return (
    <span>
      <span className="sr-only">{text}</span>
      {words.map((word, w) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed string
        <Fragment key={w}>
          {w ? ' ' : null}
          <span aria-hidden className="inline-block whitespace-nowrap">
            {[...word].map((letter) => {
              const i = index++;
              return (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={{ y: '0.35em', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{
                    delay: delay + i * 0.03,
                    type: 'spring',
                    stiffness: 380,
                    damping: 24,
                  }}
                >
                  {letter}
                </motion.span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

// Spoken words type out this fast, and never take longer than the cap.
const TYPE_MS_PER_CHAR = 16;
const TYPE_MAX_MS = 1000;

/** How long `text` takes to type out. */
export function typingMs(text: string): number {
  return Math.min(text.length * TYPE_MS_PER_CHAR, TYPE_MAX_MS);
}

/** How many characters of `text` are typed so far; starts over when `text` changes. */
function useTyped(text: string): number {
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce || !text) {
      setTyped(text.length);
      return;
    }
    const each = typingMs(text) / text.length;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const count = Math.min(text.length, Math.floor((now - started) / each) + 1);
      setTyped(count);
      if (count < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, reduce]);
  return typed;
}

/**
 * What was said, typed out quickly a character at a time. Untyped text
 * keeps its space, so the line never reflows. Once it's typed, the dropped
 * parts are struck: the nth at `strikeDelay(n)` ms.
 */
export function TypedParts({
  parts,
  keptClassName,
  strikeDelay,
}: {
  parts: { text: string; dropped: boolean }[];
  keptClassName?: string;
  strikeDelay: (nth: number) => number;
}) {
  const text = parts.map((part) => part.text).join(' ');
  const typed = useTyped(text);
  const done = typingMs(text);
  let start = 0;
  let strikes = 0;
  return (
    <>
      <span className="sr-only">{text}</span>
      {parts.map((part, i) => {
        const from = start + (i ? 1 : 0);
        start = from + part.text.length;
        const shown = Math.max(0, Math.min(part.text.length, typed - from));
        const strike = part.dropped ? strikes++ : null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt together and never reorder
          <Fragment key={i}>
            {i ? ' ' : null}
            <span
              aria-hidden
              className={part.dropped ? 'poster-strike' : keptClassName}
              style={
                strike === null ? undefined : { animationDelay: `${done + strikeDelay(strike)}ms` }
              }
            >
              {part.text.slice(0, shown)}
              <span className="invisible">{part.text.slice(shown)}</span>
            </span>
          </Fragment>
        );
      })}
    </>
  );
}

const CONFETTI_COLORS = ['#FFFFFF', '#F6C343', '#F2542D', '#7BE39A', '#8FA2FF', '#FF9AC8'];

type Burst = 'celebrate' | 'small';

/**
 * A burst of confetti over the window. `celebrate` fires from both bottom
 * corners; `small` pops from a point, given as fractions of the window.
 */
export function Confetti({
  burst = 'small',
  at = { x: 0.5, y: 0.5 },
  delay = 0,
}: {
  burst?: Burst;
  at?: { x: number; y: number };
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const [done, setDone] = useState(false);
  const pieces = useMemo(() => {
    const count = burst === 'celebrate' ? 110 : 36;
    return Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const origin =
        burst === 'celebrate' ? { x: fromLeft ? 0.04 : 0.96, y: 1.02 } : { x: at.x, y: at.y };
      const angle =
        burst === 'celebrate'
          ? (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50
          : Math.random() * 360;
      const speed = burst === 'celebrate' ? 520 + Math.random() * 420 : 120 + Math.random() * 160;
      const rad = (angle * Math.PI) / 180;
      return {
        id: i,
        origin,
        dx: Math.cos(rad) * speed,
        dy: Math.sin(rad) * speed,
        fall: 260 + Math.random() * 260,
        spin: (Math.random() - 0.5) * 900,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 6 + Math.random() * 6,
        h: Math.random() > 0.5 ? 6 + Math.random() * 4 : 12 + Math.random() * 6,
        round: Math.random() > 0.7,
        duration: (burst === 'celebrate' ? 2.2 : 1.3) + Math.random() * 0.8,
      };
    });
  }, [burst, at.x, at.y]);

  useEffect(() => {
    const timer = setTimeout(() => setDone(true), (delay + 3.4) * 1000);
    return () => clearTimeout(timer);
  }, [delay]);

  if (reduce || done) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute"
          style={{
            left: `${p.origin.x * 100}%`,
            top: `${p.origin.y * 100}%`,
            width: p.w,
            height: p.h,
            background: p.color,
            borderRadius: p.round ? 999 : 2,
          }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={{
            x: [0, p.dx, p.dx * 1.15],
            y: [0, p.dy, p.dy + p.fall],
            rotate: [0, p.spin / 2, p.spin],
            opacity: [1, 1, 0],
          }}
          transition={{ delay, duration: p.duration, times: [0, 0.35, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
