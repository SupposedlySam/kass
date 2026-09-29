import {
  CircleDot,
  FileText,
  Hash,
  Mail,
  MessageCircle,
  NotebookPen,
  PenTool,
  SquareTerminal,
} from 'lucide-react';
import type { TeachChip, TeachKind } from '@/lib/api/types';

/** Every kind of conversation, in the order the server lists them. */
export const TEACH_KINDS: TeachKind[] = [
  'coding_agent',
  'design_feedback',
  'notes',
  'writeup',
  'team_chat',
  'issue_comment',
  'email',
  'text_message',
];

export const KIND_ICONS = {
  coding_agent: SquareTerminal,
  design_feedback: PenTool,
  notes: NotebookPen,
  writeup: FileText,
  team_chat: Hash,
  issue_comment: CircleDot,
  email: Mail,
  text_message: MessageCircle,
} satisfies Record<TeachKind, unknown>;

/** The kinds for the style's apps first, in catalog order, then the rest. */
export function groupKinds(suggested: TeachKind[]): { own: TeachKind[]; other: TeachKind[] } {
  const own = TEACH_KINDS.filter((kind) => suggested.includes(kind));
  return { own, other: TEACH_KINDS.filter((kind) => !own.includes(kind)) };
}

/** The chips a conversation shows collapsed: `limit` of them, and how many more there are. */
export function visibleChips(
  chips: TeachChip[],
  limit: number,
  expanded: boolean,
): { shown: TeachChip[]; hidden: number } {
  if (expanded || chips.length <= limit) return { shown: chips, hidden: 0 };
  return { shown: chips.slice(0, limit), hidden: chips.length - limit };
}

/** A stable key for a chip in a list. */
export function chipKey(chip: TeachChip): string {
  return `${chip.code}:${chip.value ?? ''}`;
}
