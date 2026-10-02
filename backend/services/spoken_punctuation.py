"""Write a punctuation mark the speaker said as a word, and keep it.

"I'm home comma see you soon period" is "I'm home, see you soon." Whisper's
own pauses around the word go with it ("home, comma, see" and "home. Comma."
are one comma). A mark the speaker said wins over every later choice: the
cleanup model, the learned writing style and the closing of a dictation may
punctuate the rest, but ``keep_spoken_punctuation`` puts a said mark back
where it was said. An exclamation mark Whisper heard in the speaker's voice is
kept the same way when cleanup flattens it to a period.

A mark word that is talked about stays a word: "a comma", "the Oxford comma"
once the speaker corrects it, "a period of time". Corrections also teach the
speaker's own words for a mark ("bang" for "!"); see ``learn``.
"""

import re
from collections import defaultdict
from difflib import SequenceMatcher
from functools import lru_cache

_MARKS = {
    "comma": ",",
    "period": ".",
    "full stop": ".",
    "question mark": "?",
    "exclamation point": "!",
    "exclamation mark": "!",
    "colon": ":",
    "semicolon": ";",
    "semi colon": ";",
    "semi-colon": ";",
}
_SENTENCE_END = ".?!"
# Before a mark word, these make it something talked about: "a comma", "the
# period", "with an exclamation point".
_NAMED = frozenset(
    str.split("a an the this that these those each every another any some no our my your his her its their one")
)
_WORD = re.compile(r"[\w'\u2019]+")
_PREVIOUS_WORD = re.compile(r"([\w'\u2019]+)[^\w\n]*\Z")
_NEXT_WORD = re.compile(r"[ \t]*([\w'\u2019]+)")
# Whisper's pause marks around a said mark, never a line break.
_PAUSE = " \t,.;:!?"
_CLOSERS = "\"')]}\u201d\u2019"
_OPENERS = "\"'([{\u201c\u2018"


@lru_cache(maxsize=8)
def _words_pattern(words: tuple[str, ...]) -> re.Pattern:
    alternatives = "|".join(
        r"[ \t-]?".join(re.escape(part) for part in re.split(r"[ -]", word))
        for word in sorted(words, key=len, reverse=True)
    )
    # Last, so a mark word said right wins: any word before "point" or "mark",
    # which ``_mark_for`` keeps only when it sounds like a mark's name.
    alternatives += r"|[^\W\d_]{4,}[ \t-]+(?:point|mark)"
    return re.compile(rf"(?<![\w'\u2019-])(?:{alternatives})(?![\w'\u2019-])", re.IGNORECASE)


_BUILT_IN = _words_pattern(tuple(_MARKS))


def _key(word: str) -> str:
    return word.casefold().replace("\u2019", "'")


def _spaced(said: str) -> str:
    return re.sub(r"[ \t-]+", " ", _key(said))


# How close a heard word must be to a mark's name: "explanation point" and
# "exclamatory mark" are "!", "presentation point" is words.
_SOUNDS_LIKE = 0.8


def _mark_for(said: str, aliases: dict[str, str]) -> str | None:
    word = _spaced(said)
    if found := _MARKS.get(word) or aliases.get(word):
        return found
    # Whisper mishears the long names: "explanation point" was "exclamation point".
    heard, _, noun = word.rpartition(" ")
    for name, mark in _MARKS.items():
        first, _, last = name.rpartition(" ")
        if first and last == noun and SequenceMatcher(None, heard, first).ratio() >= _SOUNDS_LIKE:
            return mark
    return None


def _convert(text: str, aliases: dict[str, str], kept: frozenset[str]) -> tuple[str, list[int]]:
    """``text`` with said marks written, and where each written mark is."""
    # Cached: streaming checks every partial cleanup.
    pattern = _words_pattern((*_MARKS, *sorted(aliases))) if aliases else _BUILT_IN
    out, last, placed = "", 0, []
    for match in pattern.finditer(text):
        if match.start() < last:
            continue
        mark = _mark_for(match.group(), aliases)
        # Said at the start of a line or of the text, it has nothing to follow.
        previous = _PREVIOUS_WORD.search(text[: match.start()])
        following = _NEXT_WORD.match(text, match.end())
        if (
            mark is None
            or not previous
            or _key(previous.group(1)) in _NAMED
            or f"{_key(previous.group(1))} {_spaced(match.group())}" in kept
            # "a period of time", "the colon of"
            or (following and _key(following.group(1)) == "of")
        ):
            continue
        out = (out + text[last : match.start()]).rstrip(_PAUSE)
        placed.append(len(out))
        out += mark
        last = match.end()
        rest = text[last:]
        last += len(rest) - len(rest.lstrip(_PAUSE))
        rest = text[last:]
        # A space only before words: "http colon//" stays joined.
        if not rest or not (rest[0].isalnum() or rest[0] in _OPENERS):
            continue
        if mark == ":" and rest[:1].isdigit() and out[-2:-1].isdigit():
            # "3 colon 30" is a time.
            continue
        out += " "
        if mark in _SENTENCE_END and text.lstrip()[:1].isupper():
            out += rest[:1].upper()
            last += 1
    return out + text[last:], placed


def apply_spoken_punctuation(text: str, learned: tuple[dict, frozenset] | None = None) -> str:
    """Write each punctuation mark said as a word ("comma", "period", "bang")."""
    aliases, kept = learned or ({}, frozenset())
    return _convert(text, aliases, kept)[0]


def _anchors(said: str, learned) -> list[tuple[str, int, str, bool, str | None]]:
    """Where ``said`` puts a mark that must stay: after which word, which time.

    Each is (word, occurrence, mark, spoken, next word as said). An
    exclamation mark Whisper wrote is one too, but not ``spoken``.
    """
    aliases, kept = learned or ({}, frozenset())
    converted, placed = _convert(said, aliases, kept)
    spots = {index: True for index in placed}
    for match in re.finditer(r"(?<=[\w'\u2019])!", converted):
        spots.setdefault(match.start(), False)
    anchors = []
    for index, spoken in sorted(spots.items()):
        words = _WORD.findall(converted[:index])
        if not words:
            continue
        key = _key(words[-1])
        following = _NEXT_WORD.match(converted, index + 1)
        anchors.append(
            (
                key,
                sum(_key(word) == key for word in words),
                converted[index],
                spoken,
                following.group(1) if following else None,
            )
        )
    return anchors


_AFTER = re.compile(rf"([,.;:!?]*)([{re.escape(_CLOSERS)}]*)([,.;:!?]*)")


def keep_spoken_punctuation(said: str, text: str, learned: tuple[dict, frozenset] | None = None) -> str:
    """Put back each mark ``said`` asked for that ``text`` changed or dropped.

    A mark goes back after the same word, counted from the start; a word the
    cleanup kept a different number of times is left alone. Whisper's
    exclamation marks only replace the period cleanup flattened them to.
    """
    anchors = _anchors(said, learned)
    if not anchors:
        return text
    said_counts = defaultdict(int)
    for word in _WORD.findall(apply_spoken_punctuation(said, learned)):
        said_counts[_key(word)] += 1
    found = defaultdict(list)
    for match in _WORD.finditer(text):
        found[_key(match.group())].append(match)
    capitals = text.lstrip()[:1].isupper()
    edits = []
    for key, occurrence, mark, spoken, said_next in anchors:
        matches = found.get(key, [])
        if len(matches) != said_counts[key] or occurrence > len(matches):
            continue
        end = matches[occurrence - 1].end()
        after = _AFTER.match(text, end)
        marks = after.group(1) + after.group(3)
        if mark in marks:
            continue
        if not spoken and marks != ".":
            continue
        if after.group(3):
            start, stop = after.start(3), after.end(3)
        elif after.group(1):
            start, stop = after.start(1), after.end(1)
        else:
            start = stop = after.end()
        replaced = text[start:stop]
        edits.append((start, stop, mark, replaced, said_next))
    for start, stop, mark, replaced, said_next in sorted(edits, reverse=True):
        rest = text[stop:]
        if rest[:1].isalnum():
            rest = " " + rest
        following = _NEXT_WORD.match(rest)
        if following:
            word = following.group(1)
            first = following.start(1)
            ended = any(m in _SENTENCE_END for m in replaced)
            if mark in _SENTENCE_END and not ended and capitals:
                word = word[:1].upper() + word[1:]
            elif mark not in _SENTENCE_END and ended and said_next and _key(word) == _key(said_next):
                # Lowered back only when the speaker's word was lower case.
                word = said_next[:1] + word[1:]
            rest = rest[:first] + word + rest[following.end(1) :]
        text = text[:start] + mark + rest
    return text


# A period that ends a quote or parenthesis goes after it: "it's done". and
# (see above). An ellipsis, "?" and "!" stay inside. An abbreviation keeps its
# own period too: (and so on, etc.).
_PERIOD_IN_CLOSERS = re.compile(rf"(\w+(?:\.\w+)*)\.([{re.escape(_CLOSERS)}]+)\.?(?=\s|$)")
# "U.S", "e.g", "a.m": single letters joined by periods.
_INITIALS = re.compile(r"(?:[^\W\d_]\.)+[^\W\d_]")


def _is_abbreviation(word: str) -> bool:
    from .writing_style import _ABBREVIATIONS

    return word.casefold() in _ABBREVIATIONS or bool(_INITIALS.fullmatch(word))


def period_after_closers(text: str) -> str:
    """``text`` with each period written inside closing quotes or parentheses moved after them."""

    def place(match: re.Match) -> str:
        word, closers = match.groups()
        return f"{word}{'.' if _is_abbreviation(word) else ''}{closers}."

    return _PERIOD_IN_CLOSERS.sub(place, text)


# --- Learning from corrections ---------------------------------------------

_TOKEN = re.compile(r"[\w'\u2019]+|[^\w\s]")
_MARK_CHARS = frozenset(",.;:!?")


def _tokens(text: str) -> list[str]:
    return [_key(token) for token in _TOKEN.findall(text)]


def _is_word(token: str) -> bool:
    return bool(_WORD.fullmatch(token))


def _observations(original: str, expected: str):
    """What one correction says about said marks.

    Yields ("alias", words, mark, anchor) where the speaker's own word became
    a mark, and ("keep", words, None, anchor) where a written mark went back
    to the word it was said as.
    """
    old, new = _tokens(original), _tokens(expected)
    for tag, a, b, c, d in SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag != "replace" or a == 0 or not _is_word(old[a - 1]):
            continue
        removed, added = old[a:b], new[c:d]
        removed_words = [token for token in removed if _is_word(token)]
        added_words = [token for token in added if _is_word(token)]
        added_marks = [token for token in added if token in _MARK_CHARS]
        removed_marks = [token for token in removed if token in _MARK_CHARS]
        if (
            1 <= len(removed_words) <= 2
            and not added_words
            and len(added_marks) == 1
            and all(token in _MARK_CHARS for token in removed if not _is_word(token))
            and not any(char.isdigit() for word in removed_words for char in word)
        ):
            yield "alias", " ".join(removed_words), added_marks[0], old[a - 1]
        elif (
            1 <= len(added_words) <= 2
            and not removed_words
            and len(removed_marks) == 1
            and _MARKS.get(" ".join(added_words)) == removed_marks[0]
        ):
            yield "keep", " ".join(added_words), None, old[a - 1]


def learn(examples) -> dict:
    """Learn the speaker's own words for marks, and where a mark word is a word.

    A new word for a mark needs two different dictations that taught it, one
    of them an explicit correction (a redictation only backs it up), and no
    correction that kept the word as a word. A built-in mark word goes back to
    being a word after the word before it ("trial period") once an explicit
    correction says so, unless more corrections there wanted the mark.
    """
    taught = defaultdict(set)
    explicit = defaultdict(bool)
    marks = defaultdict(set)
    keeps = defaultdict(set)
    converts = defaultdict(set)
    for example in examples:
        for kind, words, mark, anchor in _observations(example.original, example.expected):
            if kind == "alias":
                if words in _MARKS:
                    converts[f"{anchor} {words}"].add(example.capture_id)
                    continue
                taught[words].add(example.capture_id)
                marks[words].add(mark)
                explicit[words] |= example.source != "redictation"
            elif example.source != "redictation":
                keeps[f"{anchor} {words}"].add(example.capture_id)
    written = defaultdict(int)
    for example in examples:
        text = " " + " ".join(token for token in _tokens(example.expected) if _is_word(token)) + " "
        for words in taught:
            written[words] += f" {words} " in text
    aliases = {
        words: next(iter(marks[words]))
        for words, captures in taught.items()
        if len(captures) >= 2 and explicit[words] and len(marks[words]) == 1 and not written[words]
    }
    kept = sorted(context for context, captures in keeps.items() if len(captures) > len(converts[context]))
    return {"aliases": dict(sorted(aliases.items())), "kept": kept}
