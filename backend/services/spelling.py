"""Put spelled-out text back together.

Whisper writes spelled letters with dashes between them ("m-r-g-n") and keeps
"capital" as a word ("capital C"). Said in one run with numbers and spoken
punctuation, as in a password or a username, the pieces also come out
separated by spaces ("capital C-H-E-N-E-Y 0021!"). This joins them into the
one string the speaker spelled ("Cheney0021!").
"""

import re

from .dictionary import _sound

_LETTER = r"[^\W\d_]"

# Marks the text spelled letters became, so only runs that start from spelling
# are joined: "CHENEY 0021" was spelled, "iPhone 15" was not.
_SPELLED = "\ue000"

# Three or more single letters joined by dashes. Two letters stay dashed, since
# "A-B testing" and "T-shirt"-style words are written that way on purpose.
_SPELLED_LETTERS = re.compile(rf"(?<![\w-]){_SPELLED}?{_LETTER}(?:-{_LETTER}){{2,}}(?![\w-])")

_SYMBOLS = {
    "underscore": "_",
    "dash": "-",
    "hyphen": "-",
    "exclamation point": "!",
    "exclamation mark": "!",
    "question mark": "?",
    "at sign": "@",
    "dollar sign": "$",
    "percent sign": "%",
    "pound sign": "#",
    "hash": "#",
    "hashtag": "#",
    "ampersand": "&",
    "asterisk": "*",
    "period": ".",
    "dot": ".",
    "slash": "/",
    "plus sign": "+",
}
_SYMBOL_WORD = "|".join(sorted((re.escape(word) for word in _SYMBOLS), key=len, reverse=True))
_SYMBOL_WORDS = re.compile(rf"\b(?:{_SYMBOL_WORD})\b", re.IGNORECASE)

# "capital" said before a letter becomes that letter in upper case: "capital
# c" is "C". Before spelled-out letters it is the first one only, the way a
# name is spelled: "capital C-H-E-N-E-Y" is "Cheney". Before a word it's left
# alone, and so is a letter that is itself a word going on into more words:
# "the capital I visited" is the city, not the letter. A symbol word after the letter
# ("capital A dash") means the speaker is still spelling. "with a capital L"
# asks for the case of a word already said, so it is kept for
# ``apply_spoken_case``.
_CAPITAL_LETTER = re.compile(
    rf"(?<![Ww]ith a )(?<![Ww]ith an )(?<![Ww]ith )\b[Cc]apital\s+(?![AaIiOo]\s+(?!(?i:{_SYMBOL_WORD})\b){_LETTER})({_LETTER})((?:-{_LETTER})*)(?![\w-])"
)

# One piece of a spelled run: spelled letters, a number, or a symbol said as a
# word or written as itself, with any punctuation Whisper stuck on. Sentence
# punctuation ends the run, so "C-A-T, 3 dogs" doesn't become "CAT,3 dogs".
_PIECE = rf"(?:{_SPELLED}{_LETTER}+|\d+|(?i:{_SYMBOL_WORD})\b|[^\w\s{_SPELLED}])"
_RUN = re.compile(rf"(?<![\w{_SPELLED}])(?:{_PIECE}[^\w\s,;:.?!{_SPELLED}]*[ \t]+)+{_PIECE}[^\w\s{_SPELLED}]*")


def _join_run(match: re.Match) -> str:
    run = match.group()
    if _SPELLED not in run:
        return run
    run = _SYMBOL_WORDS.sub(lambda word: _SYMBOLS[word.group().lower()], run)
    return re.sub(r"[ \t]+", "", run)


def join_spelling(text: str) -> str:
    """Join spelled letters, and the numbers and punctuation said with them."""
    marked = _CAPITAL_LETTER.sub(lambda match: _SPELLED + match.group(1).upper() + match.group(2).lower(), text)
    marked = _SPELLED_LETTERS.sub(lambda match: _SPELLED + match.group().replace("-", "").lstrip(_SPELLED), marked)
    if _SPELLED not in marked:
        return text
    return _RUN.sub(_join_run, marked).replace(_SPELLED, "")


# -- a word said and then spelled ------------------------------------------------

# A word, then the same word spelled: joined letters, which Whisper writes in
# capitals ("Megan, MEGHAN"), or two letters it leaves dashed ("Bo, B-O").
_RESPELLED = re.compile(
    rf"(?<![\w'\u2019-])(?P<word>{_LETTER}+),?[ \t]+(?:(?i:spelled|spelt)[ \t]+)?"
    rf"(?P<letters>{_LETTER}{{2,}}|{_LETTER}-{_LETTER})(?![\w'\u2019-])"
)


def distance(a: str, b: str, limit: int) -> int:
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


def sounds_like(letters: str, word: str) -> int | None:
    """How many sounds spelled ``letters`` are off ``word``, when few enough
    for ``word`` to be them misheard: the first the same, and two in five of
    the longer of the two ("VOVA" for "vulva", "MEGHAN" for "Megan"); None
    when ``word`` is another word."""
    a, b = _sound(letters), _sound(word)
    if not a or not b or a[0] != b[0]:
        return None
    limit = 2 * max(len(a), len(b)) // 5
    off = distance(a, b, limit)
    return off if off <= limit else None


def shaped(letters: str, like: str) -> str:
    """Spelled letters in the case of the word they replace: they carry none."""
    if like.isupper() and len(like) > 1:
        return letters.upper()
    if like[:1].isupper():
        return letters[:1].upper() + letters[1:].lower()
    return letters.lower()


def is_spelled(text: str) -> bool:
    """Whether ``text`` reads as letters spelled aloud: three or more joined
    in capitals ("MEGHAN"), or two Whisper left dashed ("B-O")."""
    letters = text.replace("-", "")
    if not letters.isalpha() or not letters.isupper():
        return False
    return len(letters) >= 3 or (len(letters) == 2 and "-" in text)


def _respelled(match: re.Match) -> str | None:
    word, spelled = match["word"], match["letters"]
    letters = spelled.replace("-", "")
    if not is_spelled(spelled) or sounds_like(letters, word) is None:
        return None
    return word if word.casefold() == letters.casefold() else shaped(letters, word)


def respell(text: str) -> str:
    """A word said and then spelled is that word, as spelled: the spelling
    corrects how Whisper heard it ("Megan, M-E-G-H-A-N" is "Meghan"). Run
    after ``join_spelling``."""
    kept, done, at = [], 0, 0
    while match := _RESPELLED.search(text, at):
        written = _respelled(match)
        if written is None:
            # The word after may be one said and then spelled itself.
            at = match.start("letters")
            continue
        kept += [text[done : match.start()], written]
        done = at = match.end()
    return "".join(kept) + text[done:]
