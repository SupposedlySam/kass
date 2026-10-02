"""Read Aloud's "Read naturally": text rewritten the way a person would say it.

Kokoro speaks what misaki turns into phonemes, and misaki keeps only
``; : , . ! ? — …`` (and quotes) as pauses. So ``resize / lift / hold`` is read
"resize slash lift slash hold" in one breath, "A. Cut them" loses its period,
and "e.g." is spelled out. These rules swap such things for words and for
punctuation Kokoro pauses on; nothing is dropped without a pause in its place.
They don't touch what the text says.
"""

import re

# Written forms and what's said for them. Matched case-insensitively.
_ABBREVIATIONS = [
    (re.compile(r"\be\.g\.,?", re.I), "for example,"),
    (re.compile(r"\bi\.e\.,?", re.I), "that is,"),
    # A period only where "etc." ended the sentence too.
    (re.compile(r"\b(?i:etc)\.(?=\s*$|\s+[A-Z])", re.M), "and so on."),
    (re.compile(r"\betc\b\.?", re.I), "and so on"),
    (re.compile(r"\bvs\.?(?=\s)", re.I), "versus"),
    (re.compile(r"\bw/o\b", re.I), "without"),
    (re.compile(r"\bw/(?=\s)", re.I), "with"),
]
_SYMBOLS = [
    (re.compile(r"\s*(?:->|=>|→)\s*"), " to "),
    (re.compile(r"\s+&\s+"), " and "),
    (re.compile(r"\.\.\.+"), "…"),
]

_LINK = re.compile(r"!?\[([^\]]+)\]\([^)\s]+\)")
_URL = re.compile(r"\bhttps?://(?:www\.)?([^/\s)]+)[^\s)]*")
_CODE = re.compile(r"`([^`]+)`")
_EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")

# At a line's start: headings, bullets, quotes. A number list ("1. ") is kept.
_LINE_MARKER = re.compile(r"^\s*(?:#{1,6}\s+|[-*•+]\s+|>\s*)")
# "A. Cut them": a lettered option, which misaki would read "A cut them".
_OPTION = re.compile(r"^([A-F])[.)]\s+(?=[A-Z\"'“])")
_PARENS = re.compile(r"\s*\(([^()\n]*)\)")
# Words joined by slashes outside brackets: "tab/page", "lift / hold".
# A slash is spaced on both sides or neither, so "to /usr/bin" isn't a list.
_SLASHED = re.compile(r"(?<![\w/.:])([A-Za-z][\w'-]*(?:(?:\s+/\s+|/)[A-Za-z][\w'-]*)+)(?![\w/])")
_TRAILING_ELLIPSIS = re.compile(r"\s*(?:…|\.\.\.)$")
_ENDS_A_PAUSE = re.compile(r"[.!?:;,…—\"'”’]$")


def _spoken_list(items: list[str], joiner: str) -> str:
    """``a, b, and c``; two items are ``a and b``."""
    items = [item for item in items if item]
    if len(items) <= 1:
        return "".join(items)
    if len(items) == 2:
        return f"{items[0]} {joiner} {items[1]}"
    return f"{', '.join(items[:-1])}, {joiner} {items[-1]}"


def _slash_items(text: str) -> tuple[list[str], bool]:
    """The items of ``a / b / c…``, and whether it trailed off (meaning "and more")."""
    trails = bool(_TRAILING_ELLIPSIS.search(text))
    text = _TRAILING_ELLIPSIS.sub("", text)
    return [" ".join(item.split()) for item in text.split("/")], trails


def _parenthetical(match: re.Match) -> str:
    """``x (y) z`` said as ``x, y, z``; a slash list inside is a list of examples."""
    inner = match.group(1).strip()
    if not inner:
        return ""
    if inner.count("/") >= 1 and not _URL.search(inner):
        items, trails = _slash_items(inner)
        if trails:
            inner = f"for example {', '.join(items)}, and so on"
        elif len(items) >= 3:
            inner = f"for example {_spoken_list(items, 'and')}"
        else:
            inner = _spoken_list(items, "or")
    return f", {inner},"


def _slashed(match: re.Match) -> str:
    items, _ = _slash_items(match.group(1))
    # "and/or" is already said "and or".
    if [item.lower() for item in items] == ["and", "or"]:
        return "and or"
    return _spoken_list(items, "or")


def _tidy(line: str) -> str:
    """Punctuation the rules doubled up, and spaces before punctuation."""
    line = re.sub(r"\s+([,.;:!?…])", r"\1", line)
    line = re.sub(r",(?:\s*,)+", ",", line)
    line = re.sub(r",\s*([.;:!?…])", r"\1", line)
    line = re.sub(r"([:;])\s*,", r"\1", line)
    line = re.sub(r"^\s*,\s*|\s*,\s*$", "", line)
    line = re.sub(r"\s{2,}", " ", line)
    return line.strip()


def _line(line: str) -> str:
    line = _LINE_MARKER.sub("", line)
    line = _OPTION.sub(r"Option \1: ", line)
    line = _PARENS.sub(_parenthetical, line)
    line = _SLASHED.sub(_slashed, line)
    line = _tidy(line)
    # A line with no closing punctuation (a heading, a bullet) still ends in a pause.
    if line and re.search(r"\w", line) and not _ENDS_A_PAUSE.search(line):
        line += "."
    return line


def speakable(text: str) -> str:
    """``text`` as it would be said aloud. Lines stay lines, so they're still read one by one."""
    text = _LINK.sub(r"\1", text)
    text = _URL.sub(r"\1", text)
    text = _CODE.sub(r"\1", text)
    text = _EMPHASIS.sub(lambda m: m.group(2) or m.group(3), text)
    for pattern, said in _ABBREVIATIONS + _SYMBOLS:
        text = pattern.sub(said, text)
    return "\n".join(_line(line) for line in text.splitlines())
