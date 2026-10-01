"""Write a laugh as one word.

Whisper writes each "ha" or "he" of a laugh as its own word ("ha ha ha",
"Ha, ha, ha.", "he he he"). A laugh is typed as one word, spelled the way it
was heard: "hahaha", "hehehe".
"""

import re

_SYLLABLES = r"(?:ha|he)+"

# Two or more laugh syllables (each may already be joined, "haha ha") with only
# spaces, commas, periods or dashes between them.
_LAUGH = re.compile(rf"(?<![\w-]){_SYLLABLES}(?:[ \t,.\-]+{_SYLLABLES})+(?![\w-])", re.IGNORECASE)

# "he" is also a word, and a restart repeats it ("he, he went home"). Only
# "he"s that run into another word must be three or more to be a laugh.
_GOES_ON = re.compile(r"[ \t]*\w")


def is_laughter(text: str) -> bool:
    """Whether ``text`` is nothing but laugh syllables: "hahaha", "HeHe"."""
    return bool(re.fullmatch(_SYLLABLES, text, re.IGNORECASE))


def _join(match: re.Match) -> str:
    laugh = re.sub(r"[^a-zA-Z]", "", match.group())
    if "a" not in laugh.lower() and len(laugh) < 6 and _GOES_ON.match(match.string, match.end()):
        return match.group()
    if laugh.isupper():
        return laugh
    return laugh[0] + laugh[1:].lower()


def join_laughter(text: str) -> str:
    """``text`` with every spaced-out laugh written as one word ("hahaha")."""
    return _LAUGH.sub(_join, text)
