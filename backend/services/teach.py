"""Teach Kass how you write by replying to conversations (docs/plans/TEACH_BY_REPLYING.md).

A session teaches one writing style. It holds conversations of different
kinds (a coding agent, team chat, an email...). Each opens with a
hand-written message; after every reply the cleanup model writes the other
side's next message and the facts for the user's next reply.

The user dictates replies in Kass's own window, which is cleaned up in
the style being taught while a session is open (``styles.teach_in_kass``).
A reply is linked to the captures made there since its turn was shown: their
raw transcripts are what was said, their cleanups what was shown. Finishing
saves the dictated replies to the style's profile the way calibration saved
its rewrites (``writing_style.save_run``).

Sessions live in memory and expire after two hours without use.
"""

import logging
import random
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

TARGET_REPLIES = 10
MAX_CONVERSATIONS = 8
MAX_REPLY_CHARS = 4000
MAX_MESSAGE_CHARS = 1200
SESSION_TTL_SECONDS = 2 * 60 * 60
# A new session starts with this many conversations of the style's own kinds.
STARTING_CONVERSATIONS = 3
MAX_CHIPS_PER_REPLY = 5
PROMPT_CACHE_KEY = "teach"


@dataclass(frozen=True)
class Kind:
    id: str
    # Who the user writes to, and what they write, for the model.
    other_side: str
    medium: str
    bundles: frozenset[str] = frozenset()
    categories: frozenset[str] = frozenset()


_TERMINALS = frozenset(
    {
        "com.mcclowes.saggar",
        "com.apple.Terminal",
        "com.googlecode.iterm2",
        "com.mitchellh.ghostty",
        "dev.warp.Warp-Stable",
        "net.kovidgoyal.kitty",
        "com.todesktop.230313mzl4w4u92",
        "com.microsoft.VSCode",
        "dev.zed.Zed",
        "com.exafunction.windsurf",
    }
)

KINDS = (
    Kind(
        "coding_agent",
        "an AI coding agent working in the user's software project",
        "instructions typed to a coding agent in a terminal",
        _TERMINALS,
        frozenset({"public.app-category.developer-tools"}),
    ),
    Kind(
        "design_feedback",
        "a designer or engineer who shared a design or a code change",
        "feedback on a design or a code change",
        _TERMINALS | {"com.figma.Desktop"},
        frozenset({"public.app-category.graphics-design"}),
    ),
    Kind(
        "notes",
        "the user's own notes app, prompting them to write something down",
        "notes to themselves",
        frozenset({"com.apple.Notes", "md.obsidian", "com.apple.reminders", "notion.id"}),
    ),
    Kind(
        "writeup",
        "a teammate who asked for a written plan, notes or a doc section",
        "a longer write-up such as a plan or a doc section",
        frozenset({"com.apple.iWork.Pages", "com.microsoft.Word", "notion.id", "com.apple.TextEdit"}),
        frozenset({"public.app-category.productivity"}),
    ),
    Kind(
        "team_chat",
        "a coworker in a team chat app",
        "short team chat messages",
        frozenset({"com.tinyspeck.slackmacgap", "com.microsoft.teams2", "com.hnc.Discord"}),
        frozenset({"public.app-category.business"}),
    ),
    Kind(
        "issue_comment",
        "a coworker commenting on an issue or pull request",
        "comments on an issue or pull request",
        frozenset({"com.linear", "com.github.GitHubClient"}),
    ),
    Kind(
        "email",
        "a colleague or someone the user deals with by email",
        "emails",
        frozenset({"com.apple.mail", "com.microsoft.Outlook", "com.superhuman.electron", "com.readdle.smartemail-Mac"}),
    ),
    Kind(
        "text_message",
        "a friend or family member texting the user",
        "text messages",
        frozenset(
            {
                "com.apple.MobileSMS",
                "net.whatsapp.WhatsApp",
                "org.whispersystems.signal-desktop",
                "ru.keepcoder.Telegram",
            }
        ),
        frozenset({"public.app-category.social-networking"}),
    ),
)
KINDS_BY_ID = {kind.id: kind for kind in KINDS}
# A style with none of its own kinds starts with these.
FALLBACK_KINDS = ("team_chat", "email", "text_message")

# Tricks that make a turn teach more than tone. The first turn of a
# conversation is its seed's; later turns rotate through these.
TRICKS = ("plain", "structure", "change_of_mind", "long", "tone", "terms")
_TRICK_INSTRUCTIONS = {
    "structure": "Ask two or three separate things in this message.",
    "long": "Ask for something that needs a longer answer: a reason, a plan or an explanation.",
    "tone": "Something has gone wrong or is urgent now; let it show in the message.",
}


@dataclass(frozen=True)
class Seed:
    """A hand-written opener: who writes, what they write, and the facts for the answer."""

    id: str
    kind: str
    persona: str
    relation: str
    message: str
    # One fact to pass on, or (question, answer) pairs.
    facts: str | None = None
    answers: tuple[tuple[str, str], ...] = ()
    title: str | None = None
    trick: str = "plain"
    example: str | None = None


SEEDS = (
    Seed(
        "agent-retry",
        "coding_agent",
        "Coding agent",
        "working in your project",
        "I added the retry to the upload request and the tests pass. Two questions before I go on:\n"
        "1. Should it retry on 500 errors too, or only on timeouts?\n"
        "2. Should the retry count be a setting, or hard-coded at 3?",
        answers=(("500 errors?", "Only timeouts"), ("Retry count?", "Hard-code it at 3 for now")),
        trick="change_of_mind",
        example="“retry on 500s too… no wait, only on timeouts”",
    ),
    Seed(
        "agent-build",
        "coding_agent",
        "Coding agent",
        "working in your project",
        "The build on main is failing after the dependency bump. I can pin the old version of the date "
        "library, or update our code to its new API. Which do you want?",
        facts="Update the code to the new API, and add a test for date formatting.",
        trick="long",
    ),
    Seed(
        "agent-config",
        "coding_agent",
        "Coding agent",
        "working in your project",
        "I found three places that parse the config file by hand. Want me to merge them into one helper? "
        "It touches the CLI, the server and the tests.",
        facts="Yes, but do the CLI and the server first, and leave the tests for a second change.",
    ),
    Seed(
        "design-settings",
        "design_feedback",
        "Riley",
        "a designer",
        "Here's the new settings page. I moved the account section to the top and made the save button "
        "sticky. Thoughts?",
        facts="Account at the top is good. The sticky button covers the last row in small windows.",
    ),
    Seed(
        "design-pr",
        "design_feedback",
        "Sam",
        "an engineer",
        "PR is up for the onboarding flow, screenshots are in the description. Anything you want changed "
        "before I merge?",
        answers=(("Must fix?", "The skip button is too hard to find"), ("Nice to have?", "Bigger progress dots")),
        trick="structure",
    ),
    Seed(
        "design-icons",
        "design_feedback",
        "Riley",
        "a designer",
        "Which icon set do you like for the toolbar, the outlined one or the filled one?",
        facts="Outlined, but filled for the active state.",
        trick="change_of_mind",
        example="“the filled one… actually no, outlined, with filled for the active state”",
    ),
    Seed(
        "notes-meeting",
        "notes",
        "Notes",
        "a note to yourself",
        "Your meeting with the design team just ended. What do you want to remember?",
        facts="The header gets darker, mockups are due Friday, and ask Dana about the invite bug.",
        trick="structure",
    ),
    Seed(
        "notes-groceries",
        "notes",
        "Notes",
        "a note to yourself",
        "Grocery run tonight. What do you need?",
        facts="Eggs, coffee, dish soap, and something for dinner on Thursday.",
    ),
    Seed(
        "notes-idea",
        "notes",
        "Notes",
        "a note to yourself",
        "You had an idea on the walk home. Get it down before you lose it.",
        facts="Group captures by app, maybe with counts, and ask people whether they want search.",
        trick="long",
    ),
    Seed(
        "writeup-plan",
        "writeup",
        "Dana",
        "your manager",
        "Can you write up a short plan for moving settings to the new layout? Just the steps and what could go wrong.",
        facts="Move Account first, then Notifications, then Advanced. The risk is people not finding Advanced.",
        trick="long",
    ),
    Seed(
        "writeup-release",
        "writeup",
        "Dana",
        "your manager",
        "Could you write this week's release notes? The main things are faster startup and the new dictionary page.",
        facts="Startup is about twice as fast, the dictionary teaches words and replacements, and the crash "
        "on empty captures is fixed.",
        trick="structure",
    ),
    Seed(
        "writeup-readme",
        "writeup",
        "Kai",
        "a teammate",
        "We need a paragraph for the README on setting up the dev environment. Can you write it?",
        facts="Install bun and Python 3.12, run just setup, then just dev.",
    ),
    Seed(
        "chat-ship",
        "team_chat",
        "Dana",
        "a coworker",
        "hey, are we still good to ship the onboarding changes Thursday? QA flagged something on the invite "
        "screen, not sure if it's a blocker",
        facts="It's not a blocker. You'll have a fix up Wednesday, so Thursday still works.",
        title="Slack DM",
    ),
    Seed(
        "chat-review",
        "team_chat",
        "Kai",
        "a coworker",
        "can you look at my PR when you get a sec? it's the settings page one",
        facts="Yes, after lunch. Ask whether it needs the migration too.",
        title="Slack DM",
    ),
    Seed(
        "chat-status",
        "team_chat",
        "Alex",
        "your lead",
        "Quick one before standup: where are we on the payments work?",
        answers=(
            ("Status?", "Blocked: the sandbox keys expired"),
            ("Plan?", "Finance is sending new keys; you're on the settings page meanwhile"),
        ),
        title="Slack DM",
        trick="structure",
    ),
    Seed(
        "issue-crash",
        "issue_comment",
        "Riley",
        "a coworker",
        "Reproduced on staging: submitting the invite form with an empty email field crashes the screen. "
        "Can you take this before Thursday's release?",
        facts="Yes. It's a missing check on the email field; you'll have a fix up Wednesday.",
        title="Invite screen crashes on empty email",
    ),
    Seed(
        "issue-search",
        "issue_comment",
        "Sam",
        "a coworker",
        "Search takes 8 seconds on accounts with over 10k items. Any idea what changed?",
        facts="The new ranking query skips the index. You'll add one and test again.",
        title="Search is slow on large accounts",
        trick="long",
    ),
    Seed(
        "issue-dark",
        "issue_comment",
        "Kai",
        "a coworker",
        "Is anyone working on this? Happy to pick it up.",
        facts="No one is. Go ahead, and reuse the color tokens from the settings page.",
        title="Dark mode for the export page",
    ),
    Seed(
        "email-budget",
        "email",
        "Priya Nair",
        "a colleague",
        "Hi,\n\nCan we go over the Q3 budget before Tuesday's meeting? The travel line looks a lot higher "
        "than last quarter and I want to make sure we can explain it.\n\nDoes Monday afternoon work for you?"
        "\n\nPriya",
        facts="Monday is full; Tuesday morning works. The conference was counted twice.",
        title="Budget review before Tuesday?",
    ),
    Seed(
        "email-intro",
        "email",
        "Jordan Lee",
        "a colleague",
        "Hi,\n\nI'd like to introduce you to Alex, who's leading the redesign. I think you two should talk "
        "about the onboarding flow.\n\nJordan",
        facts="Thank Jordan, say hi to Alex, and suggest a call next week.",
        title="Intro: Alex from the design team",
    ),
    Seed(
        "email-lease",
        "email",
        "Sam Ortiz",
        "your landlord",
        "Hello,\n\nYour lease ends on the 31st. Would you like to renew for another year at the same rent? "
        "Please let me know by Friday.\n\nThanks,\nSam",
        answers=(("Renew?", "Yes, for a year"), ("Anything else?", "Ask about fixing the dishwasher")),
        title="Lease renewal",
        trick="structure",
    ),
    Seed(
        "text-tonight",
        "text_message",
        "Sam",
        "a friend",
        "are you still coming tonight?",
        facts="Yes, but a little late; traffic is bad.",
    ),
    Seed(
        "text-photos",
        "text_message",
        "Mom",
        "family",
        "did you get the photos I sent",
        facts="Yes, the one with the dog is your favorite. Ask when she's visiting.",
    ),
    Seed(
        "text-lunch",
        "text_message",
        "Jess",
        "a friend",
        "want to grab lunch tomorrow?",
        facts="Tomorrow doesn't work; Thursday does. Suggest the taco place.",
        trick="change_of_mind",
        example="“tomorrow works… actually no, Thursday”",
    ),
)


def seeds_of(kind: str) -> list[Seed]:
    return [seed for seed in SEEDS if seed.kind == kind]


# --- Kinds for a style --------------------------------------------------------------


def kinds_for_apps(apps: list[tuple[str, str | None]]) -> list[str]:
    """The kinds that match ``apps`` ((bundle id, App Store category) pairs), in
    catalog order: by bundle id first, then by category."""
    bundles = {bundle for bundle, _ in apps}
    categories = {category for _, category in apps if category}
    by_bundle = [kind.id for kind in KINDS if kind.bundles & bundles]
    by_category = [kind.id for kind in KINDS if kind.categories & categories and kind.id not in by_bundle]
    return by_bundle + by_category


def style_apps(db, style_id: str) -> list[tuple[str, str | None]]:
    """The apps dictated into that use ``style_id``, with their categories."""
    from sqlalchemy import func

    from ..database.models import Capture
    from .styles import KASS_BUNDLE, snapshot

    styles = snapshot()
    rows = (
        db.query(Capture.app_bundle_id, func.max(Capture.app_category))
        .filter(Capture.app_bundle_id.isnot(None), Capture.app_bundle_id != KASS_BUNDLE)
        .group_by(Capture.app_bundle_id)
        .all()
    )
    found = [(bundle, category) for bundle, category in rows if styles.for_app(bundle).id == style_id]
    seen = {bundle for bundle, _ in found}
    found += [(bundle, None) for bundle, style in styles.apps.items() if style == style_id and bundle not in seen]
    return found


# --- Sessions -----------------------------------------------------------------------


def _now() -> datetime:
    """Naive UTC, the way captures record ``created_at``."""
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass
class Reply:
    written: str
    said: str | None
    shown: str | None
    chips: list[dict]


@dataclass
class Conversation:
    id: str
    kind: str
    persona: str
    relation: str
    title: str | None
    # (from_you, text), oldest first.
    messages: list[tuple[bool, str]]
    note: dict | None
    seeds_used: list[str]
    turn_started_at: datetime
    tricks: list[str]
    replies: list[Reply] = field(default_factory=list)
    wrapped: bool = False
    turn: int = 0


@dataclass
class Session:
    id: str
    style: str
    conversations: list[Conversation]
    suggested_kinds: list[str]
    terms: list[str]
    touched: float = field(default_factory=time.monotonic)
    # Captures already part of a reply; each belongs to one.
    used_captures: set[str] = field(default_factory=set)


_lock = threading.RLock()
_sessions: dict[str, Session] = {}


def _expire() -> None:
    cutoff = time.monotonic() - SESSION_TTL_SECONDS
    for session_id in [key for key, value in _sessions.items() if value.touched < cutoff]:
        del _sessions[session_id]
    _refresh_teaching()


def _refresh_teaching() -> None:
    """Dictation in Kass's window follows the newest open session's style."""
    from .styles import teach_in_kass

    newest = max(_sessions.values(), key=lambda s: s.touched, default=None)
    teach_in_kass(newest.style if newest else None, SESSION_TTL_SECONDS)


def get(session_id: str) -> Session:
    with _lock:
        session = _sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        session.touched = time.monotonic()
        _refresh_teaching()
        return session


def conversation(session: Session, conversation_id: str) -> Conversation:
    found = next((c for c in session.conversations if c.id == conversation_id), None)
    if found is None:
        raise KeyError(conversation_id)
    return found


def _note(seed: Seed) -> dict:
    return {
        "facts": seed.facts,
        "answers": [{"ask": ask, "answer": answer} for ask, answer in seed.answers],
        "trick": seed.trick if seed.trick in ("change_of_mind", "long") else None,
        "example": seed.example,
    }


def _open(kind: str, used: set[str]) -> Conversation:
    """A new conversation of ``kind``, from a seed no conversation in the session has used yet."""
    options = seeds_of(kind)
    fresh = [seed for seed in options if seed.id not in used] or options
    seed = random.choice(fresh)
    # Later turns rotate through the tricks, starting anywhere.
    start = random.randrange(len(TRICKS))
    return Conversation(
        id=uuid.uuid4().hex,
        kind=kind,
        persona=seed.persona,
        relation=seed.relation,
        title=seed.title,
        messages=[(False, seed.message)],
        note=_note(seed),
        seeds_used=[seed.id],
        turn_started_at=_now(),
        tricks=list(TRICKS[start:] + TRICKS[:start]),
    )


def _used(session: Session) -> set[str]:
    return {seed for c in session.conversations for seed in c.seeds_used}


def start(style: str, own_kinds: list[str], terms: list[str]) -> Session:
    kinds = [kind for kind in own_kinds if kind in KINDS_BY_ID][:STARTING_CONVERSATIONS] or list(FALLBACK_KINDS)
    with _lock:
        _expire()
        session = Session(uuid.uuid4().hex, style, [], own_kinds, terms)
        for kind in kinds:
            session.conversations.append(_open(kind, _used(session)))
        _sessions[session.id] = session
        _refresh_teaching()
        return session


def add_conversation(session_id: str, kind: str) -> Session:
    if kind not in KINDS_BY_ID:
        raise ValueError("Unknown kind of conversation")
    with _lock:
        session = get(session_id)
        if sum(not c.wrapped for c in session.conversations) >= MAX_CONVERSATIONS:
            raise ValueError(f"Wrap up a conversation first; at most {MAX_CONVERSATIONS} stay open")
        session.conversations.append(_open(kind, _used(session)))
        return session


def new_theme(session_id: str, conversation_id: str) -> Session:
    """Replace a conversation with a fresh one of the same kind. Its replies are kept for the run."""
    with _lock:
        session = get(session_id)
        old = conversation(session, conversation_id)
        fresh = _open(old.kind, _used(session))
        if old.replies:
            old.wrapped = True
            session.conversations.append(fresh)
        else:
            session.conversations[session.conversations.index(old)] = fresh
        return session


def wrap_up(session_id: str, conversation_id: str) -> Session:
    with _lock:
        session = get(session_id)
        found = conversation(session, conversation_id)
        found.wrapped = True
        found.note = None
        return session


def discard(session_id: str) -> None:
    with _lock:
        _sessions.pop(session_id, None)
        _refresh_teaching()


def forget_style(style: str) -> None:
    """A reset or deleted style drops its open sessions."""
    with _lock:
        for session_id in [key for key, value in _sessions.items() if value.style == style]:
            del _sessions[session_id]
        _refresh_teaching()


def reply_count(session: Session) -> int:
    return sum(len(c.replies) for c in session.conversations)


# --- Replies ------------------------------------------------------------------------


@dataclass(frozen=True)
class Dictated:
    said: str
    shown: str
    capture_ids: tuple[str, ...]


def dictated(db, since: datetime, used: set[str] = frozenset()) -> Dictated | None:
    """What was said and shown in Kass's window since ``since``, joined in
    order, leaving out captures already part of a reply."""
    from sqlalchemy import or_

    from ..database.models import Capture
    from .refinement import strip_stt_artifacts
    from .styles import KASS_BUNDLE

    rows = (
        db.query(Capture.id, Capture.transcript_raw, Capture.transcript_refined)
        .filter(
            Capture.created_at >= since,
            Capture.source != "command",
            Capture.transcript_raw != "",
            or_(Capture.app_bundle_id == KASS_BUNDLE, Capture.app_bundle_id.is_(None)),
        )
        .order_by(Capture.created_at)
        .all()
    )
    rows = [row for row in rows if row[0] not in used]
    said = " ".join(strip_stt_artifacts(raw).strip() for _, raw, _ in rows).strip()
    if not said:
        return None
    shown = " ".join((refined or raw).strip() for _, raw, refined in rows).strip()
    return Dictated(said, shown, tuple(row[0] for row in rows))


def dictated_for(db, session_id: str, conversation_id: str) -> Dictated | None:
    """What was dictated for a conversation's current turn."""
    with _lock:
        session = get(session_id)
        since, used = conversation(session, conversation_id).turn_started_at, set(session.used_captures)
    return dictated(db, since, used)


_GREETING = re.compile(r"^(hi|hey|hello|dear|morning|good (morning|afternoon|evening)|yo)\b", re.IGNORECASE)
_SIGN_OFF = re.compile(r"^(thanks|thank you|cheers|best|regards|thx|ty|talk soon|see you)\b[\w\s,!.]{0,30}$", re.I)
_ABBREVIATIONS = ("lmk", "tbh", "np", "btw", "fyi", "imo", "idk", "thx", "omw", "rn", "asap", "tho", "pls", "ty")
_CODE_TOKEN = re.compile(r"\b\w+(?:[_./]\w+)+\b|\b[a-z]+[A-Z]\w*\b")
_EMOJI = re.compile("[\U0001f300-\U0001faff☀-➿]")
_RETRACTION = re.compile(r"\b(no wait|actually|scratch that|i mean|or rather|no no)\b", re.IGNORECASE)
_LIST_LINE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+")


def reply_chips(written: str, said: str | None, kind: str, terms: list[str]) -> list[dict]:
    """What a reply shows about how the user writes, as codes the app words.

    Each chip is ``{"code": ..., "value": ...}``; ``value`` is the text it
    points at, or None.
    """
    chips: list[dict] = []

    def add(code: str, value: str | None = None) -> None:
        if len(chips) < MAX_CHIPS_PER_REPLY and all(c["code"] != code for c in chips):
            chips.append({"code": code, "value": value})

    text = written.strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    words = text.split()
    if not lines:
        return chips
    if said and _RETRACTION.search(said) and not _RETRACTION.search(text):
        add("correction_resolved")
    for term in terms:
        if term in text:
            add("term", term)
            break
    if (token := _CODE_TOKEN.search(text)) is not None:
        add("kept_exact", token.group())
    body = list(lines)
    if _GREETING.match(lines[0]):
        add("greeting", lines[0][:40])
        body = body[1:]
    elif kind in ("team_chat", "text_message", "email", "issue_comment"):
        add("no_greeting")
    if len(lines) > 1 and _SIGN_OFF.match(lines[-1]):
        add("sign_off", lines[-1][:40])
        body = body[:-1]
    if any(_LIST_LINE.match(line) for line in body):
        add("list")
    elif len(body) > 1:
        add("line_per_thought")
    first_letter = next((ch for ch in text if ch.isalpha()), "")
    if first_letter.islower():
        add("lowercase_start")
    if len(words) >= 3 and text[-1].isalnum():
        add("no_final_period")
    lowered = {w.strip(".,!?").casefold() for w in words}
    if found := next((a for a in _ABBREVIATIONS if a in lowered), None):
        add("abbreviation", found)
    if (emoji := _EMOJI.search(text)) is not None:
        add("emoji", emoji.group())
    if len(words) <= 12 and len(lines) == 1:
        add("short")
    elif any(len(sentence.split()) >= 30 for sentence in re.split(r"[.!?]\s", text)):
        add("run_on")
    return chips


def record_reply(session_id: str, conversation_id: str, written: str, spoken: Dictated | None) -> Reply:
    written = written.strip()
    if not written:
        raise ValueError("Write or dictate a reply first")
    if len(written) > MAX_REPLY_CHARS:
        raise ValueError(f"Keep a reply under {MAX_REPLY_CHARS} characters")
    with _lock:
        session = get(session_id)
        found = conversation(session, conversation_id)
        if found.wrapped:
            raise ValueError("That conversation is wrapped up")
        said, shown = (spoken.said, spoken.shown) if spoken else (None, None)
        if spoken:
            session.used_captures.update(spoken.capture_ids)
        reply = Reply(written, said, shown, reply_chips(written, said, found.kind, session.terms))
        found.replies.append(reply)
        found.messages.append((True, written))
        found.note = None
        return reply


# --- The other side ----------------------------------------------------------------


def _system(conversation: Conversation, trick: str, terms: list[str]) -> str:
    kind = KINDS_BY_ID[conversation.kind]
    lines = [
        f"You play {conversation.persona}, {kind.other_side}, in a conversation with the user. "
        f"The user is practicing {kind.medium}.",
        f"Write {conversation.persona}'s next message: answer what the user just wrote, then keep the "
        "conversation going with a question or request the user needs to answer. Stay in character. "
        "Never mention practice, Kass or AI. Match how people really write "
        f"{kind.medium}: keep it short. Never repeat an earlier message: if the user left something "
        "unanswered, ask about just that part in new words.",
    ]
    if trick == "terms" and terms:
        lines.append(f"Mention {random.choice(terms)} naturally.")
    elif trick in _TRICK_INSTRUCTIONS:
        lines.append(_TRICK_INSTRUCTIONS[trick])
    lines.append(
        "Then give the facts the user needs for their answer, so they only choose the words.\n"
        "Answer with exactly two parts:\n"
        f"MESSAGE: <{conversation.persona}'s next message>\n"
        "TELL: <for each thing you asked, `question -> short answer`, separated by ` | `; "
        "or one short fact to pass on>"
    )
    return "\n\n".join(lines)


def _transcript(conversation: Conversation) -> str:
    return "\n\n".join(
        f"{'User' if from_you else conversation.persona}: {text}" for from_you, text in conversation.messages
    )


_PAIR = re.compile(r"(?P<ask>\S.*?)\s*(?:->|→)\s*(?P<answer>\S.*)")
_PARTS = re.compile(r"MESSAGE:\s*(?P<message>.*?)\s*\n\s*TELL:\s*(?P<tell>.*)", re.DOTALL | re.IGNORECASE)


def _clean_part(text: str) -> str:
    return text.strip().strip("`\"'“”<>").strip()


def parse_turn(output: str) -> tuple[str, dict] | None:
    """The message and note in the model's answer, or None when it isn't usable."""
    output = re.sub(r"<think>.*?</think>", "", output, flags=re.DOTALL).strip()
    found = _PARTS.search(output)
    if not found:
        return None
    message = _clean_part(found.group("message"))
    tell = _clean_part(found.group("tell").strip().splitlines()[0] if found.group("tell").strip() else "")
    if not message or len(message) > MAX_MESSAGE_CHARS or re.search(r"\b(MESSAGE|TELL):", message):
        return None
    answers, facts = [], None
    for part in (piece.strip() for piece in tell.split("|")):
        if not part:
            continue
        pair = _PAIR.match(part)
        if pair:
            answers.append({"ask": _clean_part(pair.group("ask")), "answer": _clean_part(pair.group("answer"))})
        elif facts is None:
            facts = part
    if not answers and not facts:
        return None
    return message, {"facts": None if answers else facts, "answers": answers[:4], "trick": None, "example": None}


def _normalized(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", "", text.casefold()).split())


def repeats_earlier(conversation: Conversation, message: str) -> bool:
    """Whether ``message`` is one the other side already sent (small models copy their last one)."""
    said = _normalized(message)
    return any(not from_you and _normalized(text) == said for from_you, text in conversation.messages)


def _fallback(session: Session, found: Conversation) -> tuple[str, dict]:
    """A hand-written opener of the same kind, as a new topic in the same conversation."""
    used = _used(session)
    options = seeds_of(found.kind)
    seed = next((s for s in options if s.id not in used), random.choice(options))
    found.seeds_used.append(seed.id)
    return seed.message, _note(seed)


async def next_turn(session_id: str, conversation_id: str, model_size: str, generate=None) -> Session:
    """Write the other side's next message and the note for the user's answer.

    ``generate`` is the cleanup model's ``generate``; tests pass their own.
    """
    with _lock:
        session = get(session_id)
        found = conversation(session, conversation_id)
        found.turn += 1
        trick = found.tricks[found.turn % len(found.tricks)]
        system, prompt = _system(found, trick, session.terms), _transcript(found)
    parsed = None
    try:
        if generate is None:
            from . import llm as llm_service

            generate = llm_service.get_llm_model().generate
        from ..backends.qwen_llm_backend import prompt_cache_key

        # A repeat of an earlier message gets one more try before a written opener.
        for _ in range(2):
            key = prompt_cache_key.set(PROMPT_CACHE_KEY)
            try:
                output = await generate(
                    prompt=prompt, system=system, max_tokens=320, temperature=0.7, model_size=model_size
                )
            finally:
                prompt_cache_key.reset(key)
            parsed = parse_turn(output)
            if parsed is None or not repeats_earlier(found, parsed[0]):
                break
            logger.info("The next teaching turn repeated an earlier message; asking again")
            parsed = None
    except Exception:
        logger.warning("Could not write the next teaching turn; using a written one", exc_info=True)
    with _lock:
        if parsed is None:
            message, note = _fallback(session, found)
        else:
            message, note = parsed
            if trick in ("change_of_mind", "long"):
                note["trick"] = trick
        found.messages.append((False, message))
        found.note = note
        found.turn_started_at = _now()
        return session


def start_turn_now(session_id: str, conversation_id: str) -> None:
    """Captures from before now are not this turn's (the user dictated and deleted, say)."""
    with _lock:
        conversation(get(session_id), conversation_id).turn_started_at = _now()


# --- Finishing ---------------------------------------------------------------------


def finish(session_id: str) -> tuple[Session, list[dict]]:
    """End the session; returns it and its replies as profile examples."""
    with _lock:
        session = get(session_id)
        if not reply_count(session):
            raise ValueError("Reply at least once before finishing")
        _sessions.pop(session_id, None)
        _refresh_teaching()
    examples = [
        {
            "paragraph_id": f"teach:{c.kind}",
            "said": reply.said,
            # A typed reply is its own cleanup: no example, no habit evidence.
            "shown": reply.shown if reply.said else reply.written,
            "written": reply.written,
        }
        for c in session.conversations
        for reply in c.replies
    ]
    return session, examples


def as_dict(session: Session) -> dict:
    return {
        "session_id": session.id,
        "style_id": session.style,
        "target": TARGET_REPLIES,
        "replies": reply_count(session),
        "suggested_kinds": session.suggested_kinds,
        "conversations": [
            {
                "id": c.id,
                "kind": c.kind,
                "persona": c.persona,
                "relation": c.relation,
                "title": c.title,
                "messages": [{"from_you": from_you, "text": text} for from_you, text in c.messages],
                "note": c.note,
                "reply_count": len(c.replies),
                "chips": _conversation_chips(c),
                "wrapped": c.wrapped,
            }
            for c in session.conversations
        ],
    }


def _conversation_chips(found: Conversation) -> list[dict]:
    """Every reply's chips, newest first, each once."""
    seen, chips = set(), []
    for reply in reversed(found.replies):
        for chip in reply.chips:
            key = (chip["code"], chip["value"])
            if key not in seen:
                seen.add(key)
                chips.append(chip)
    return chips
