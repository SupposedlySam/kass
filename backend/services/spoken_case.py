"""Write a word in the case the speaker asked for.

Said after the word, with Whisper's pause before it: "I love, in all caps" or
"I love, with a capital L-O-V-E" is "I LOVE"; "I love, with a capital L" is
"I Love"; "in lowercase" and "with a lowercase N-A-S-A" lower it. Said just
before the word: "I all caps love you" is "I LOVE you". Around words: "I am
all caps yelling end caps at you" is "I am YELLING at you". Otherwise the case
asked for applies to the one word it is said next to. Spelled letters must spell that
word ("with a capital L" must start it), so a sentence about capitals is left
alone; so is case that is talked about ("I wrote it in all caps", "all caps is
hard to read").
"""

import re

_LETTER = r"[^\W\d_]"
_WORD = rf"{_LETTER}[\w'\u2019-]*"

_UPPER = r"caps|capitals|capital letters|block capitals|block letters|upper[ -]?case(?: letters)?"
_LOWER = r"lower[ -]?case(?: letters)?|small letters"
# "please", "that's" and "make it" around the ask are part of it.
_ASK = (
    r"(?:(?:make (?:that|it)|put (?:that|it)|that's|that is|write (?:that|it))\s+)?"
    r"(?:all\s+in\s+|in\s+all\s+|in\s+|all\s+|with\s+)?"
    rf"(?:(?P<upper>{_UPPER})|(?P<lower>{_LOWER}))(?:,?\s+please)?"
)
# Whisper's pause between the word and the ask: a comma, a dash, an ellipsis
# or the ask as its own sentence.
_PAUSE = r"[ \t]*(?:[,;:]|\.{3}|\u2026|[.!?]|[ \t][-\u2013\u2014])[ \t]*"
_END = r"(?=[ \t]*(?:[.!?,;:\n]|$))"

_CASE_AFTER = re.compile(rf"(?P<word>\b{_WORD})(?P<pause>{_PAUSE}){_ASK}{_END}", re.IGNORECASE)

# "with a capital L-O-V-E", "spelled with a capital L", "in lowercase n a s a".
_SPELLED_CASE = re.compile(
    rf"(?P<word>\b{_WORD})(?P<pause>{_PAUSE}|[ \t]+)"
    r"(?:(?:spelled|spelt|written)\s+)?(?:with\s+|in\s+)?(?:an?\s+)?(?:all\s+)?"
    r"(?:(?P<upper>capital|caps|upper[ -]?case|big)|(?P<lower>lower[ -]?case|small))(?:\s+letters?)?\s+"
    rf"(?P<letters>{_LETTER}+(?:(?:[ \t]*[,.-][ \t]*|[ \t]+){_LETTER}+)*){_END}",
    re.IGNORECASE,
)

# "all caps yelling end caps": everything between is written in capitals.
# Whisper's commas around either command are pauses, not text.
_CASE_SPAN = re.compile(
    r"\b(?:(?:start|begin)[ \t]+)?(?:all[ \t]+caps|caps[ \t]+on),?[ \t]+(?P<words>[^\n]+?),?[ \t]+"
    r"(?:(?:end|stop)[ \t]+(?:all[ \t]+)?caps|caps[ \t]+off)\b",
    re.IGNORECASE,
)

# "all caps love": the next word is written in capitals.
_CASE_BEFORE = re.compile(r"\b(?P<ask>all[ \t]+caps|all[ \t]+capitals),?[ \t]+(?P<word>" + _WORD + r")", re.IGNORECASE)

# Words that say the text was written in a case rather than ask for it:
# "I typed it, in all caps", "don't write in all caps".
_TALKED_ABOUT = frozenset(
    str.split(
        "it that this them those these everything something anything all one name text message title word words "
        "in with using use the a an of type typed typing write wrote written writing shout shouting is was are were "
        "be been being looks look reads read lock key"
    )
)


def _cased(word: str, upper: bool) -> str:
    return word.upper() if upper else word.lower()


def _rest(match: re.Match, text: str) -> str:
    """The sentence end the ask carried, when it was said as its own sentence."""
    pause = match.group("pause").strip()
    following = text[match.end() :].lstrip(" \t")[:1]
    if pause and pause[-1] in ".!?" and not following:
        return pause[-1]
    return ""


def _spelled(match: re.Match, text: str) -> str:
    word = match.group("word")
    letters = re.sub(r"[\W_]", "", match.group("letters"))
    upper = bool(match.group("upper"))
    if letters.lower() == re.sub(r"[\W_]", "", word).lower():
        written = _cased(word, upper)
    elif len(letters) == 1 and word[0].lower() == letters.lower():
        written = _cased(word[0], upper) + word[1:]
    else:
        return match.group()
    return written + _rest(match, text)


def _after(match: re.Match, text: str) -> str:
    word = match.group("word")
    pause = match.group("pause").strip()
    if word.lower() in _TALKED_ABOUT:
        return match.group()
    following = text[match.end() :].lstrip(" \t")[:1]
    # "Don't shout. In all caps, it reads as yelling." starts a new sentence.
    if pause[-1:] in ".!?" and following not in ("", ".", "!", "?", "\n"):
        return match.group()
    return _cased(word, bool(match.group("upper"))) + _rest(match, text)


def _before(match: re.Match, text: str) -> str:
    word = match.group("word")
    said_before = re.search(r"(\w+)[ \t,]*$", text[: match.start()])
    if word.lower() in _TALKED_ABOUT or (said_before and said_before.group(1).lower() in _TALKED_ABOUT):
        return match.group()
    return word.upper()


def apply_spoken_case(text: str) -> str:
    """Write words in the case said next to them ("I love, in all caps")."""
    if not re.search(r"cap|case|letters|big|small", text, re.IGNORECASE):
        return text
    text = _SPELLED_CASE.sub(lambda match: _spelled(match, match.string), text)
    text = _CASE_AFTER.sub(lambda match: _after(match, match.string), text)
    text = _CASE_SPAN.sub(lambda match: match.group("words").upper(), text)
    return _CASE_BEFORE.sub(lambda match: _before(match, match.string), text)
