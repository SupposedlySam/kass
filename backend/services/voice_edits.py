"""Voice edits: fix the text before the cursor by saying so (docs/plans/VOICE_EDITS.md).

A take that opens with "fix that", "fix", "edit" or "Kass" and says what to
change is an instruction for the text before the caret, not text to type:

- "Fix that, Morgan not Megan" and "Morgan, not Megan": the wrong word, after "not".
- "Edit, change Tuesday to Thursday", "replace X with Y".
- "Fix that, delete actually", "add tomorrow after meeting".
- "Fix that, Meghan, M-E-G-H-A-N": the spelled word replaces the word it is
  close to. Spelling reaches here joined ("MEGHAN", services/spelling.py).
- "Fix, it's Tuesday", "fix that, Morgan": one word replaces the word of its
  kind (a day, a month, a number or time), or else the one word that sounds
  most like it.

A bare "fix" opens so many sentences ("Fix the login bug") that it counts
only when set apart ("Fix, ...") or followed by "it's", "should be" and the
like.

It is read from the raw transcript. Cleanup would swap the words of "change
Tuesday to Thursday", drop "fix that", or resolve "Morgan, no, Megan" as a
self-correction, so an edit never reaches it.

The app sends the text before the caret (``last_take``), whoever wrote it,
and applies the result only where it can verify the write. Only a fix of
the part Kass's last take wrote is learned from. Anything
this can't resolve (the word isn't there, two are equally close, Whisper
heard both words the same) is declined with a message, and nothing changes.
"""

import logging
import re
from dataclasses import dataclass

from . import dictionary

# How letters sound, as the dictionary hears near misses ("Kris", "Chris").
from .dictionary import _sound

logger = logging.getLogger(__name__)

# The app's own command words, prompted to Whisper whenever voice edits are
# on so "Kass" is heard right. Whisper can still write "Cass" or "Kas", which
# open an edit too.
COMMAND_TERMS = ("Kass",)

TRANSFORM_NAME = "Voice edit"
NOTHING_TO_FIX = "Nothing to fix: Kass can't read the text before the cursor here"
SAY_WHAT = "Say what to fix after “fix that”"

_FILLER = r"(?:um+|uh+|uhm|erm?|so|okay|ok|oh|hey|and)"
_TRIGGER = r"(?:fix(?:\s+that)?|edit|[kc]a+s+)"
_OPENING = re.compile(
    rf"^[^\w]*(?:{_FILLER}\b[^\w]*)*(?P<triggers>(?:{_TRIGGER}\b(?P<sep>[^\w]*)){{1,2}})",
    re.IGNORECASE,
)
# A word, with "p.m.", "don't", "3:30" and unjoined spelling ("M-E-G") kept whole.
_WORD = re.compile(r"\w+(?:['\u2019.\-]\w+|(?<=\d):\d\d\b)*")
_TIME = re.compile(r"\d{1,2}(?::\d\d)?")

# Longest sides a spoken edit has: longer is a sentence being dictated.
_MAX_FIND = 6
_MAX_SIDE = 4
_CHANGE = {"change", "replace", "swap", "switch"}
_CHANGE_TO = {"to", "with", "into", "for"}
_DELETE = {"delete", "remove", "drop", "cut", "erase", "strike"}
# Whisper once wrote "add" as "at".
_ADD = {"add", "insert", "put", "at"}
_PLACES = {"after", "before"}
# "X is not Y" negates a verb: a sentence, not a correction.
_VERBS = {
    *("am", "is", "are", "was", "were", "be", "do", "does", "did", "can", "could"),
    *("should", "would", "will", "has", "have", "had", "must", "may", "might"),
}
# Words around the spelled letters that aren't the word being fixed.
_SPELLING = {"spelled", "spelt", "spell", "like", "as", "it's", "its", "that's", "is", "with", "a", "an", "the"}
# Kinds of word one said word replaces another of: "it's Tuesday" fixes
# "Monday". Months and days count only capitalized in the text ("we may").
_DAYS = {
    *("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"),
    *("today", "tonight", "tomorrow", "yesterday"),
}
_MONTHS = {
    *("january", "february", "march", "april", "may", "june", "july"),
    *("august", "september", "october", "november", "december"),
}
_NUMBER_WORDS = {
    *("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"),
    *("eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"),
    *("eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy"),
    *("eighty", "ninety", "hundred", "noon", "midnight"),
}
_HALF_DAY = re.compile(r"\s*[ap]\.?m\.?$", re.IGNORECASE)
_NUMBER = re.compile(r"\d+(?:[:,]\d+)*(?:am|pm|st|nd|rd|th)?")
_LEAD_INS = (
    ("please",),
    ("it's",),
    ("it", "is"),
    ("it", "was"),
    ("it", "should", "be"),
    ("that's",),
    ("that", "is"),
    ("that", "should", "be"),
    ("should", "be"),
    ("i", "meant"),
    ("i", "said"),
    ("make", "it"),
    ("the", "word"),
    ("the", "words"),
    ("word",),
)
_AUX_TAIL = re.compile(r"n't$")


@dataclass(frozen=True)
class Word:
    text: str
    start: int
    end: int
    key: str
    # Starts a sentence, where Whisper's capital letter says nothing.
    opens: bool
    # A comma (or other mark) follows it.
    marked: bool


@dataclass(frozen=True)
class Instruction:
    """What to change: ``find`` in the take becomes ``write`` ("" deletes)."""

    find: tuple[Word, ...]
    write: tuple[Word, ...]
    # ``write`` is one word spelled out letter by letter: its case follows the word it replaces.
    spelled: bool = False
    # "X, no, Y": whichever of the two the take has is the wrong one.
    either: bool = False
    # One word said alone: it replaces the word like it in the take.
    alike: bool = False
    # Add ``write`` "before" or "after" ``find`` instead of replacing it.
    place: str | None = None
    said: str = ""


@dataclass(frozen=True)
class Declined:
    message: str


@dataclass(frozen=True)
class Planned:
    """The take's text before and after the edit."""

    before: str
    after: str
    instruction: str
    # The wrong word, and the letters spelled for it (spelled edits only).
    replaced: str
    spelled: str | None = None


def _key(text: str) -> str:
    return re.sub(r"[.\-]", "", text.replace("\u2019", "'").casefold())


def _opens(text: str, at: int) -> bool:
    before = text[:at].rstrip()
    return not before or before[-1] in ".!?:\n"


def words(text: str) -> list[Word]:
    """The words of ``text``; a time said as "3 p.m." is one word, like "3pm"."""
    found = [
        Word(
            m.group(),
            m.start(),
            m.end(),
            _key(m.group()),
            _opens(text, m.start()),
            bool(text[m.end() : m.end() + 1].strip()),
        )
        for m in _WORD.finditer(text)
    ]
    merged: list[Word] = []
    for word in found:
        last = merged[-1] if merged else None
        if (
            last is not None
            and word.key in {"am", "pm"}
            and _TIME.fullmatch(last.text)
            and not text[last.end : word.start].strip()
        ):
            merged[-1] = Word(
                text[last.start : word.end], last.start, word.end, last.key + word.key, last.opens, word.marked
            )
        else:
            merged.append(word)
    return merged


def opening(text: str) -> tuple[str, bool, bool] | None:
    """What follows an opening "fix that", "fix", "edit" or "Kass", whether a
    mark (or the end) set it apart, and whether it was a bare "fix"; None
    when the text doesn't open with one."""
    match = _OPENING.match(text)
    if match is None:
        return None
    rest = text[match.end() :]
    bare = re.fullmatch(r"fix\W*", match.group("triggers"), re.IGNORECASE) is not None
    return rest, bool(match.group("sep").strip()) or not rest.strip(), bare


def starts_edit(text: str) -> bool:
    """Whether ``text`` opens an edit: a trigger set apart by a mark ("Fix
    that, ..."), or followed by words that read as one ("fix that add ...")."""
    found = opening(text)
    if found is None:
        return False
    _, marked, _ = found
    return marked or parse(text) is not None


def _strip_lead_ins(found: list[Word]) -> list[Word]:
    changed = True
    while changed:
        changed = False
        for lead in _LEAD_INS:
            if len(found) > len(lead) and tuple(w.key for w in found[: len(lead)]) == lead:
                found, changed = found[len(lead) :], True
    return found


def _is_spelled(found: tuple[Word, ...]) -> bool:
    return len(found) == 1 and len(found[0].text) >= 3 and found[0].text.isalpha() and found[0].text.isupper()


def _index(found: list[Word], keys: set[str], last: bool = False) -> int | None:
    hits = [i for i, w in enumerate(found) if w.key in keys and 0 < i < len(found) - 1]
    return (hits[-1] if last else hits[0]) if hits else None


def _instruction(found: list[Word], said: str, alone: bool = True) -> Instruction | None:
    """The edit ``found`` (the words after the trigger) says, by its general
    forms; with ``alone``, also by one word on its own."""
    if not found:
        return None
    head = found[0].key
    if head in _CHANGE and (at := _index(found, _CHANGE_TO)) is not None:
        find, write = found[1:at], found[at + 1 :]
        if len(find) <= _MAX_FIND and len(write) <= _MAX_FIND:
            return Instruction(tuple(_strip_lead_ins(find)), tuple(write), _is_spelled(tuple(write)), said=said)
        return None
    if head in _DELETE:
        find = _strip_lead_ins(found[1:])
        return Instruction(tuple(find), (), said=said) if 0 < len(find) <= _MAX_FIND else None
    if head in _ADD and (at := _index(found, _PLACES, last=True)) is not None:
        write, find = found[1:at], found[at + 1 :]
        if len(write) <= _MAX_FIND and len(find) <= _MAX_SIDE:
            return Instruction(tuple(find), tuple(write), place=found[at].key, said=said)
        return None
    keys = [w.key for w in found]
    if head == "not":
        # "Not Megan, Morgan": the wrong word first, up to its comma.
        comma = next((i for i, w in enumerate(found[1:-1], 1) if w.marked), None)
        if comma is None:
            return None
        return _either_side(found[comma + 1 :], found[1 : comma + 1], said)
    for i in range(1, len(found) - 1):
        if keys[i] == "instead" and keys[i + 1] == "of":
            return _either_side(found[:i], found[i + 2 :], said)
    if (at := _index(found, {"not"})) is not None:
        if keys[at - 1] in _VERBS or _AUX_TAIL.search(keys[at - 1]):
            return None
        return _either_side(found[:at], found[at + 1 :], said)
    if (at := _index(found, {"no"})) is not None:
        return _either_side(found[:at], found[at + 1 :], said, either=True)
    if _is_spelled((found[-1],)):
        hint = [w for w in found[:-1] if w.key not in _SPELLING]
        if len(hint) <= 2:
            return Instruction(tuple(hint), (found[-1],), spelled=True, said=said)
    if alone and len(found) == 1:
        return Instruction((), (found[0],), alike=True, said=said)
    return None


def _either_side(right: list[Word], wrong: list[Word], said: str, either: bool = False) -> Instruction | None:
    right = _strip_lead_ins(right)
    if not right or not wrong or len(right) > _MAX_SIDE or len(wrong) > _MAX_SIDE:
        return None
    return Instruction(tuple(wrong), tuple(right), _is_spelled(tuple(right)), either=either, said=said)


def parse(said: str) -> Instruction | Declined | None:
    """The edit ``said`` asks for; Declined when it is one that can't be done
    as heard; None when ``said`` isn't an edit."""
    found = opening(said)
    if found is None:
        return None
    rest, marked, bare = found
    after = words(said)
    offset = len(said) - len(rest)
    told = [w for w in after if w.start >= offset]
    stripped = _strip_lead_ins(told)
    led = len(stripped) < len(told)
    if bare and not marked and not led:
        # "Fix the login bug": a sentence, whatever its words look like.
        return None
    # A word alone is an edit only where it can't be the start of a sentence.
    instruction = _instruction(stripped, said, alone=marked or led)
    if instruction is None:
        return Declined(SAY_WHAT) if marked and not rest.strip(" \t.,!?;:") else None
    find, write = instruction.find, instruction.write
    if not instruction.spelled and write and [w.key for w in find] == [w.key for w in write]:
        # Whisper hears names that sound alike as one ("Meghan" as "Megan").
        return Declined(f"Heard “{_joined(write, said)}” twice. Try spelling it out")
    return instruction


def _joined(found: tuple[Word, ...], said: str) -> str:
    return said[found[0].start : found[-1].end] if found else ""


# -- matching in the text ------------------------------------------------------


def _distance(a: str, b: str, limit: int) -> int:
    """Edit distance with swapped neighbours as one edit, or ``limit + 1`` past it."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    previous, current = None, list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        before, previous, current = previous, current, [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            current[j] = min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] != b[j - 1]),
            )
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                current[j] = min(current[j], before[j - 2] + 1)
        if min(current) > limit:
            return limit + 1
    return current[-1]


def _level(said: Word, heard: Word) -> int | None:
    """How ``heard`` in the take matches ``said``: exactly (0), but for case
    (1), or spelled a letter off (2, words of five letters or more)."""
    if said.text == heard.text:
        return 0
    if said.key == heard.key:
        return 1
    a, b = said.key, heard.key
    if len(a) >= 5 and len(b) >= 5 and a[0] == b[0] and _distance(a, b, 1) <= 1:
        return 2
    return None


def _spelled_level(letters: str, heard: Word) -> tuple[int, int] | None:
    """How close a spelled word is to ``heard``: the same sounds (0) or a
    letter or two off (1, by the distance); None for the word it already is."""
    if heard.key == letters:
        return None
    a, b = _sound(letters), _sound(heard.key)
    if not a or not b or a[0] != b[0]:
        return None
    if a == b:
        return 0, 0
    limit = 2 if len(a) >= 5 else 1
    distance = _distance(a, b, limit)
    return (1, distance) if distance <= limit else None


def _best(candidates: list[tuple[tuple, int, int]]) -> tuple[int, int] | Declined | None:
    """The span with the lowest rank; spans rank equal only when nothing tells them apart."""
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return Declined("Found it twice, so nothing changed")
    return candidates[0][1], candidates[0][2]


def _find(phrase: tuple[Word, ...], take: str, found: list[Word]) -> tuple[int, int] | Declined | None:
    """Where ``phrase`` is in the take: the closest match, then the one
    nearest the end (the caret)."""
    n = len(phrase)
    if not n:
        return None
    candidates = []
    for i in range(len(found) - n + 1):
        levels = [_level(said, heard) for said, heard in zip(phrase, found[i : i + n], strict=True)]
        if None in levels:
            continue
        start, end = found[i].start, found[i + n - 1].end
        candidates.append(((max(levels), len(take) - end), start, end))
    return _best(candidates)


def _find_spelled(letters: str, take: str, found: list[Word]) -> tuple[int, int] | Declined | None:
    candidates = []
    for heard in found:
        level = _spelled_level(letters, heard)
        if level is not None:
            candidates.append(((*level, len(take) - heard.end), heard.start, heard.end))
    return _best(candidates)


def _shaped(letters: str, like: str) -> str:
    """Spelled letters in the case of the word they replace: they carry none."""
    if like.isupper() and len(like) > 1:
        return letters.upper()
    if like[:1].isupper():
        return letters[:1].upper() + letters[1:].lower()
    return letters.lower()


def _written(instruction: Instruction, take: str, start: int, end: int) -> str:
    """What replaces ``take[start:end]``, cased for where it goes."""
    target = take[start:end]
    if instruction.spelled:
        return _shaped(instruction.write[0].text, target)
    text = _joined(instruction.write, instruction.said)
    first = instruction.write[0]
    # Whisper's capital says nothing where a sentence began, or where it
    # wrote the whole edit in lower case ("fix that morgan not megan").
    uncased = first.opens or not any(c.isupper() for c in instruction.said)
    if uncased and not (first.text.isupper() and len(first.text) > 1) and first.text != "I":
        upper = target[:1].isupper() if not instruction.place else False
        text = (text[:1].upper() if upper else text[:1].lower()) + text[1:]
    if _opens(take, start) and target[:1].isupper() and not instruction.place:
        text = text[:1].upper() + text[1:]
    if instruction.alike and (half := _HALF_DAY.search(target)) and not _HALF_DAY.search(text):
        # "It's 3:30" keeps the "p.m." of the time it fixes.
        text += half.group() if text[-1:].isdigit() else " " + half.group().lstrip()
    return text


def _delete(take: str, start: int, end: int) -> str:
    """``take`` without ``take[start:end]``, its comma and one space, and a
    sentence it began starting at the next word."""
    before, after = take[:start], take[end:]
    if after.startswith(",") and (not before.strip() or before.endswith(" ")):
        after = after[1:]
    if before.endswith(" ") and (after.startswith(" ") or after[:1] in {".", ",", "!", "?", ";", ":"}):
        before = before[:-1]
    elif not before.strip() or before.endswith("\n"):
        after = after.lstrip(" ")
    if _opens(take, start) and take[start : start + 1].isupper():
        lead = len(after) - len(after.lstrip())
        after = after[:lead] + after[lead : lead + 1].upper() + after[lead + 1 :]
    return before + after


def _apply(instruction: Instruction, take: str, start: int, end: int) -> str:
    if instruction.place == "after":
        return take[:end] + " " + _written(instruction, take, start, end) + take[end:]
    if instruction.place == "before":
        written = _written(instruction, take, start, end)
        if _opens(take, start):
            written = written[:1].upper() + written[1:]
        return take[:start] + written + " " + take[start:]
    if not instruction.write:
        return _delete(take, start, end)
    return take[:start] + _written(instruction, take, start, end) + take[end:]


def _kind(word: Word) -> str | None:
    """The kind of word ``word`` is, for one said alone to replace."""
    if word.key in _DAYS:
        return "day"
    if word.key in _MONTHS:
        return "month"
    if word.key in _NUMBER_WORDS or _NUMBER.fullmatch(word.key):
        return "number"
    return None


def _find_alike(said: Word, take: str, found: list[Word]) -> tuple[int, int] | Declined | None:
    """The word in the take that ``said`` replaces: the one of its kind
    nearest the caret, or else the one that sounds most like it, when no
    other sounds as close."""
    kind = _kind(said)
    if kind is not None:
        candidates = [
            ((len(take) - heard.end,), heard.start, heard.end)
            for heard in found
            if _kind(heard) == kind and heard.key != said.key and (kind == "number" or heard.text[:1].isupper())
        ]
        return _best(candidates)
    if len(said.key) < 3 or not said.key.isalpha():
        return None
    candidates = []
    for heard in found:
        level = _spelled_level(said.key, heard)
        if level is not None:
            candidates.append((level, heard.start, heard.end))
    candidates.sort(key=lambda c: c[0])
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return Declined(f"More than one word sounds like “{said.text}”, so nothing changed")
    return (candidates[0][1], candidates[0][2]) if candidates else None


def _target(instruction: Instruction, take: str, found: list[Word]) -> tuple[int, int, bool] | Declined:
    """Where the edit goes in the take, and whether an "X, no, Y" edit found
    its second side there (so that side is the wrong one)."""
    missing = Declined(f"Couldn't find “{_joined(instruction.find, instruction.said)}” in the text before the cursor")
    if instruction.either:
        sides = [_find(instruction.find, take, found), _find(instruction.write, take, found)]
        if declined := next((side for side in sides if isinstance(side, Declined)), None):
            return declined
        hits = [(side, swap) for swap, side in enumerate(sides) if side is not None]
        if len(hits) != 1:
            return Declined("Heard both words, so nothing changed") if hits else missing
        (start, end), swap = hits[0]
        return start, end, bool(swap)
    if instruction.alike:
        said = instruction.write[0]
        span = _find_alike(said, take, found)
        if span is None:
            if any(heard.key == said.key for heard in found):
                return Declined(f"“{said.text}” is already written that way")
            like = {"day": "day", "month": "month", "number": "number or time"}.get(_kind(said) or "")
            return Declined(
                f"No {like} in the text before the cursor"
                if like
                else f"Nothing like “{said.text}” in the text before the cursor"
            )
        return span if isinstance(span, Declined) else (*span, False)
    if instruction.spelled:
        letters = instruction.write[0].key
        span = _find(instruction.find, take, found) if instruction.find else None
        if isinstance(span, tuple) and take[span[0] : span[1]].casefold() == letters:
            # The word said is already spelled that way: find the one that isn't.
            span = None
        span = span or _find_spelled(letters, take, found)
        if span is None:
            return Declined(f"Nothing close to “{_shaped(letters, 'Aa')}” in the text before the cursor")
    else:
        span = _find(instruction.find, take, found) or missing
    return span if isinstance(span, Declined) else (*span, False)


def plan(said: str, take: str | None) -> Planned | Declined | None:
    """The edit ``said`` makes to ``take``, the text before the caret;
    None when ``said`` isn't an edit."""
    instruction = parse(said)
    if not isinstance(instruction, Instruction):
        return instruction
    if not take or not take.strip():
        return Declined(NOTHING_TO_FIX)
    target = _target(instruction, take, words(take))
    if isinstance(target, Declined):
        return target
    start, end, swap = target
    if swap:
        instruction = Instruction(instruction.write, instruction.find, instruction.spelled, said=said)
    after = _apply(instruction, take, start, end)
    replaced = take[start:end]
    if after == take:
        return Declined(f"“{replaced}” is already written that way")
    written = _written(instruction, take, start, end) if instruction.write else ""
    if instruction.place:
        described = f"Add “{written}” {instruction.place} “{replaced}”"
    elif not written:
        described = f"Delete “{replaced}”"
    else:
        described = f"“{replaced}” → “{written}”"
    spelled = instruction.write[0].text if instruction.spelled else None
    return Planned(take, after, described, replaced, spelled)


def changes_end(planned: Planned, chars: int) -> bool:
    """Whether the edit changes only the last ``chars`` of the text: the
    part Kass's last take wrote."""
    before, after = planned.before, planned.after
    start = 0
    while start < min(len(before), len(after)) and before[start] == after[start]:
        start += 1
    # Whole words: a change that starts mid-word starts at the word.
    while start > 0 and before[start - 1].isalnum():
        start -= 1
    return chars > 0 and start >= len(before) - chars


def learn_from(
    planned: Planned, target_capture_id: str | None, bundle_id: str | None, edit_capture_id: str | None = None
) -> None:
    """What a successful edit teaches, run after the take, off the event loop.

    The edit says the take that wrote ``planned.replaced`` got it wrong: that
    capture gets a correction report, and a word spelled for it goes in the
    Dictionary. Both are tied to ``edit_capture_id``, the edit's own
    capture, so deleting it takes them back.
    """
    from ..database import session as database_session

    if database_session.SessionLocal is None:
        return
    with database_session.SessionLocal() as db:
        if planned.spelled:
            try:
                dictionary.add_spelled_word(planned.spelled, bundle_id, planned.replaced, db, edit_capture_id)
            except Exception:
                logger.exception("Couldn't add the spelled word to the Dictionary")
        if target_capture_id:
            try:
                report_fix(planned, target_capture_id, db, edit_capture_id)
            except Exception:
                logger.exception("Couldn't file the voice fix as a correction")


def corrected(output: str, before: str, after: str) -> str | None:
    """``output`` with the change that turned ``before`` into ``after``.

    ``before`` is the take as the field showed it, which may differ from the
    capture's output at its edges (spacing, a dropped final period), so the
    change is found by its own words and a little of the text around it, and
    applied only where that occurs once.
    """
    start = 0
    while start < min(len(before), len(after)) and before[start] == after[start]:
        start += 1
    end = 0
    while end < min(len(before), len(after)) - start and before[len(before) - 1 - end] == after[len(after) - 1 - end]:
        end += 1
    # Whole words: widen the change to the words it touches.
    while start > 0 and before[start - 1].isalnum():
        start -= 1
    while end > 0 and before[len(before) - end].isalnum():
        end -= 1
    old = before[start : len(before) - end]
    new = after[start : len(after) - end]
    left = before[max(0, start - _CONTEXT) : start]
    right = before[len(before) - end : len(before) - end + _CONTEXT]
    for context_left, context_right in ((left, right), (left, ""), ("", right), ("", "")):
        needle = context_left + old + context_right
        if needle and output.count(needle) == 1:
            at = output.index(needle) + len(context_left)
            return output[:at] + new + output[at + len(old) :]
    return None


# Characters of the text around a change used to find it in the capture.
_CONTEXT = 16


def report_fix(planned: Planned, capture_id: str, db, filed_by: str | None = None) -> None:
    """File the edit as a correction on the capture that wrote the text."""
    from ..models import CaptureFeedbackCreate
    from . import capture_feedback
    from .captures import get_capture

    capture = get_capture(capture_id, db)
    if capture is None:
        return
    target = "refined" if capture.transcript_refined is not None else "raw"
    output = capture.transcript_refined if target == "refined" else capture.transcript_raw
    expected = corrected(output or "", planned.before, planned.after)
    if expected is None or expected == output:
        logger.info("Voice fix not found in capture %s; no correction filed", capture_id)
        return
    capture_feedback.save_feedback(
        capture_id,
        CaptureFeedbackCreate(
            target=target,
            expected_text=expected,
            notes=planned.instruction,
            snapshot=capture,
            source="voice_fix",
        ),
        db,
        filed_by,
    )
