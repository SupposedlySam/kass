/**
 * The onboarding flow's order and rules, kept free of React so they can be
 * tested on their own (docs/plans/ONBOARDING.md).
 */

export const STEPS = [
  'welcome',
  'download',
  'inputMonitoring',
  'accessibility',
  'microphone',
  'keys',
  'name',
  'messy',
  'rewrite',
  'done',
] as const;

export type Step = (typeof STEPS)[number];

/** Steps that record speech, so they wait for the models. */
const SPOKEN: ReadonlySet<Step> = new Set(['name', 'messy', 'rewrite']);

/** Each step's color: a new one on every page. Text is dark only on sunflower. */
export const STEP_COLORS: Record<Step, string> = {
  welcome: '#F2542D',
  download: '#2742D9',
  inputMonitoring: '#1D1B19',
  accessibility: '#136F7A',
  microphone: '#0F7B5A',
  keys: '#F6C343',
  name: '#6B3FA0',
  messy: '#F2542D',
  rewrite: '#2742D9',
  done: '#0F7B5A',
};

export function isLightStep(step: Step): boolean {
  return STEP_COLORS[step] === '#F6C343';
}

export function nextStep(step: Step): Step {
  const i = STEPS.indexOf(step);
  return STEPS[Math.min(STEPS.length - 1, i + 1)];
}

export function previousStep(step: Step): Step {
  const i = STEPS.indexOf(step);
  return STEPS[Math.max(0, i - 1)];
}

/** A spoken step can't be used until dictation can transcribe and clean up. */
export function isLocked(step: Step, modelsReady: boolean): boolean {
  return SPOKEN.has(step) && !modelsReady;
}

/** What survives a quit: the open step, and whether downloads were started. */
export interface SavedProgress {
  step: Step;
  downloadsStarted: boolean;
}

export const STORAGE_KEY = 'herga.onboarding';

const START: SavedProgress = { step: 'welcome', downloadsStarted: false };

export function parseProgress(raw: string | null): SavedProgress {
  if (!raw) return START;
  try {
    const value = JSON.parse(raw) as Partial<SavedProgress>;
    const step = STEPS.includes(value.step as Step) ? (value.step as Step) : START.step;
    return { step, downloadsStarted: value.downloadsStarted === true };
  } catch {
    return START;
  }
}

export function loadProgress(): SavedProgress {
  try {
    return parseProgress(localStorage.getItem(STORAGE_KEY));
  } catch {
    return START;
  }
}

export function saveProgress(progress: SavedProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage can be refused; onboarding then starts over next time.
  }
}

export function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Automatic retries before a failed download asks the user what to do. */
export const AUTO_RETRIES = 3;
/** Pause before each automatic retry. */
export const RETRY_DELAY_MS = 4000;

export function shouldRetryAutomatically(failures: number): boolean {
  return failures > 0 && failures <= AUTO_RETRIES;
}

/** Room to spare on top of the downloads, for unpacking and the system. */
const DISK_HEADROOM_MB = 500;

/** MB still to free before the downloads fit, or 0 when they do. */
export function missingDiskMb(freeMb: number, neededMb: number): number {
  return Math.max(0, neededMb + DISK_HEADROOM_MB - freeMb);
}

/** The speech model offered when the default one keeps failing to download. */
export const FALLBACK_STT_MODEL = 'small';

/** One piece of a heard sentence, and whether cleanup dropped it. */
export interface HeardPart {
  text: string;
  dropped: boolean;
}

/**
 * Split what was heard into kept and dropped parts, by the words of what was
 * sent: a heard word that the sent text doesn't use at that point was
 * dropped. Case and punctuation are ignored when matching.
 */
export function heardParts(heard: string, sent: string): HeardPart[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const heardWords = heard.split(/\s+/).filter(Boolean);
  const sentWords = sent.split(/\s+/).map(norm).filter(Boolean);
  // Longest common subsequence of normalized words decides what was kept.
  const n = heardWords.length;
  const m = sentWords.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        norm(heardWords[i]) === sentWords[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: HeardPart[] = [];
  const push = (text: string, dropped: boolean) => {
    const last = parts[parts.length - 1];
    if (last && last.dropped === dropped) last.text += ` ${text}`;
    else parts.push({ text, dropped });
  };
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && norm(heardWords[i]) === sentWords[j]) {
      push(heardWords[i], false);
      i++;
      j++;
    } else if (j < m && lcs[i][j + 1] > lcs[i + 1][j]) {
      j++;
    } else {
      push(heardWords[i], norm(heardWords[i]) !== '');
      i++;
    }
  }
  return parts;
}
