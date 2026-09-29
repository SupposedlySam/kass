import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { TeachChip, TeachConversation, TeachKind, TeachSession } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';
import { KindMenuItems } from './KindMenu';
import { chipKey, KIND_ICONS, visibleChips } from './kinds';

const T = 'writingStyle.teach';
/** Chips a conversation shows before "+N". */
const CHIP_LIMIT = 3;

/** Conversations in any order, what each picked up, and finishing. */
export function TeachSidebar({
  session,
  styleName,
  selected,
  adding,
  finishing,
  onSelect,
  onAdd,
  onFinish,
}: {
  session: TeachSession;
  styleName: string;
  selected: string;
  adding: boolean;
  finishing: boolean;
  onSelect: (id: string) => void;
  onAdd: (kind: TeachKind) => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const progress = Math.min(1, session.replies / session.target);

  return (
    <aside className="flex w-[290px] shrink-0 flex-col border-r border-border">
      <div className="space-y-2.5 px-[18px] pt-5 pb-3.5">
        <DialogTitle className="text-[15px]">{t(`${T}.title`)}</DialogTitle>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="truncate">{t(`${T}.anyOrder`, { style: styleName })}</span>
            <span className="shrink-0 font-mono text-[11px]">
              {t(`${T}.progress`, { count: session.replies, target: session.target })}
            </span>
          </div>
          <div className="h-[3px] rounded-sm bg-input">
            <div
              className="h-full rounded-sm bg-accent transition-[width]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {session.conversations.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            selected={conversation.id === selected}
            onSelect={() => onSelect(conversation.id)}
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              disabled={adding}
              className="mt-1.5 justify-start gap-2 border border-dashed border-input text-accent hover:text-accent"
            >
              {adding ? <Loader2 className="animate-spin" /> : <Plus />}
              {t(`${T}.addConversation`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[290px]">
            <KindMenuItems suggested={session.suggested_kinds} onPick={onAdd} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-2 border-t border-border px-[18px] py-3.5">
        <Button
          className="w-full font-semibold"
          disabled={!session.replies || finishing}
          onClick={onFinish}
        >
          {finishing && <Loader2 className="animate-spin" />}
          {t(`${T}.finish`)}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          {session.replies
            ? t(`${T}.finishNote`, { count: session.replies })
            : t(`${T}.finishEmpty`)}
        </p>
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation,
  selected,
  onSelect,
}: {
  conversation: TeachConversation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICONS[conversation.kind];
  const last = conversation.messages[conversation.messages.length - 1];
  const { shown, hidden } = visibleChips(conversation.chips, CHIP_LIMIT, expanded);

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg px-2.5 py-2',
        selected && 'bg-secondary',
        conversation.wrapped && !selected && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-input/60">
          <Icon className="h-3.5 w-3.5 text-foreground/80" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{conversation.persona}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {conversation.wrapped ? t(`${T}.wrappedShort`) : last?.text}
          </span>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {conversation.reply_count || '—'}
        </span>
      </button>
      {conversation.chips.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap gap-1 pl-[38px]',
            expanded && 'max-h-[52px] overflow-y-auto',
          )}
        >
          {shown.map((chip) => (
            <ChipLabel key={chipKey(chip)} chip={chip} />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-full border border-accent/30 bg-accent/10 px-2 py-px text-[11px] text-accent"
            >
              +{hidden}
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-full border border-input px-2 py-px text-[11px] text-muted-foreground"
            >
              {t(`${T}.showLess`)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One thing a reply showed, like "lowercase starts" or "“Hi Priya,” greeting". */
export function ChipLabel({ chip }: { chip: TeachChip }) {
  const { t } = useTranslation();
  return (
    <span className="whitespace-nowrap rounded-full border border-input bg-secondary px-2 py-px text-[11px]">
      {t(`${T}.chips.${chip.code}`, { value: chip.value ?? '' })}
    </span>
  );
}
