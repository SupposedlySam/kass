"""Put spelled-out text back together.

Whisper writes spelled letters with dashes between them ("m-r-g-n") and keeps
"capital" as a word ("capital C"). Said in one run with numbers and spoken
punctuation, as in a password or a username, the pieces also come out
separated by spaces ("capital C-H-E-N-E-Y 0021!"). This joins them into the
one string the speaker spelled ("Cheney0021!").
"""

import re

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
