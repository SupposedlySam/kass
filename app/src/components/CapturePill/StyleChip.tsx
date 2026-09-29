import { motion } from 'framer-motion';
import { useMemo } from 'react';
import { cn } from '@/lib/utils/cn';

export interface StyleChange {
  /** Increases per change, so a new one replays the animation. */
  key: number;
  /** The style it replaced; `null` when the take was already in it. */
  from: string | null;
  to: string;
}

// One pass, in seconds: rise in, roll the name, glow as it lands, drift out.
const TOTAL_S = 2.72;
const ENTER_S = 0.32;
const ROLL_S = [0.64, 1.04] as const;
const GLOW_S = [0.92, 1.08, 1.76] as const;
const EXIT_S = 2.32;
const ROW_PX = 14;

const at = (seconds: number) => seconds / TOTAL_S;

/** The theme's accent (``--accent: 39 87% 62%``) with ``alpha``, in a form framer-motion interpolates. */
function accent(alpha: number): string {
  const [h = '39', s = '87%', l = '62%'] = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent')
    .trim()
    .split(/\s+/);
  return `hsla(${h}, ${s}, ${l}, ${alpha})`;
}

const DROP = '0 6px 12px -4px rgba(0, 0, 0, 0.45)';

/**
 * Shown above the pill when the user asks for a writing style by name at the
 * start of a dictation ("use formal mode"). The chip rises in on the style it
 * replaced, rolls to the new one, glows once as it lands and drifts away.
 */
export function StyleChip({ change, onDone }: { change: StyleChange; onDone: () => void }) {
  const glow = useMemo(
    () => [
      `0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 0px ${accent(0)}, ${DROP}`,
      `0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 0px ${accent(0)}, ${DROP}`,
      `0 0 0 1px ${accent(0.9)}, 0 0 0 4px ${accent(0.25)}, ${DROP}`,
      `0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 8px ${accent(0)}, ${DROP}`,
    ],
    [],
  );
  const rolls = change.from !== null;
  return (
    <motion.div
      key={change.key}
      className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-black/90 px-2.5 text-[11px] font-medium text-white/90"
      initial={{ opacity: 0, y: 8, boxShadow: glow[0] }}
      animate={{ opacity: [0, 1, 1, 0], y: [8, 0, 0, -4], boxShadow: glow }}
      transition={{
        opacity: {
          duration: TOTAL_S,
          times: [0, at(ENTER_S), at(EXIT_S), 1],
          ease: ['easeOut', 'linear', 'easeIn'],
        },
        y: {
          duration: TOTAL_S,
          times: [0, at(ENTER_S), at(EXIT_S), 1],
          ease: [[0.2, 0.8, 0.2, 1], 'linear', 'easeIn'],
        },
        boxShadow: {
          duration: GLOW_S[2],
          times: [0, ...GLOW_S.map((s) => s / GLOW_S[2])],
          ease: 'easeOut',
        },
      }}
      onAnimationComplete={onDone}
    >
      <motion.span
        className="h-[5px] w-[5px] rounded-full"
        initial={{ backgroundColor: rolls ? 'rgba(255, 255, 255, 0.35)' : accent(1) }}
        animate={{ backgroundColor: accent(1) }}
        transition={{ delay: ROLL_S[0], duration: ROLL_S[1] - ROLL_S[0] - 0.16 }}
      />
      <span className={cn('overflow-hidden', rolls && 'h-[14px]')}>
        {rolls ? (
          <motion.span
            className="flex flex-col leading-[14px]"
            initial={{ y: 0 }}
            animate={{ y: -ROW_PX }}
            transition={{
              delay: ROLL_S[0],
              duration: ROLL_S[1] - ROLL_S[0],
              ease: [0.5, 0, 0.1, 1],
            }}
          >
            <motion.span
              initial={{ opacity: 0.55 }}
              animate={{ opacity: 0 }}
              transition={{ delay: ROLL_S[0], duration: 0.32 }}
            >
              {change.from}
            </motion.span>
            <span>{change.to}</span>
          </motion.span>
        ) : (
          change.to
        )}
      </span>
    </motion.div>
  );
}
