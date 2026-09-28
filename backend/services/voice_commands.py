"""Spoken commands: words in a dictation that are an instruction, not text.

"Paste from clipboard" becomes a marker in the transcript, wherever in the
dictation it was said. Cleanup keeps it like any other word, and the content
check rejects a cleanup that loses it, so the transcript is used instead. The
client replaces the marker with what is on the clipboard.

The marker is bracketed text rather than a code-like token: the cleanup model
treats a sentence around "[clipboard]" as it would the spoken words, and
cleans it just as thoroughly.
"""

import re

CLIPBOARD = "[clipboard]"

# Whisper spells the verb by its sound: "paste", "Pace", "pays", "paced".
# Any short p- or b- word with an s sound before "from clipboard" is taken
# as it: nothing else is said that way.
_PASTE_CLIPBOARD = re.compile(r"\b[pb][aeiy]{1,2}[scz]\w*,?\s+from\s+(?:the\s+|my\s+)?clipboard\b", re.IGNORECASE)
_MARKER = re.compile(re.escape(CLIPBOARD), re.IGNORECASE)


def mark_commands(text: str) -> str:
    """``text`` with each spoken command replaced by its marker."""
    return _PASTE_CLIPBOARD.sub(CLIPBOARD, text)


def count_commands(text: str) -> int:
    return len(_MARKER.findall(text))


def commands_alone(text: str) -> str | None:
    """The markers, when ``text`` says nothing but commands: nothing to clean."""
    count = count_commands(text)
    if count and not re.search(r"\w", _MARKER.sub("", text)):
        return " ".join([CLIPBOARD] * count)
    return None
