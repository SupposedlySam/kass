"""Read Aloud's "Read naturally": text rewritten the way a person would say it.

Kokoro speaks what misaki turns into phonemes, and misaki keeps only
``; : , . ! ? — …`` (and quotes) as pauses. So ``resize / lift / hold`` is read
"resize slash lift slash hold" in one breath, "A. Cut them" loses its period,
and "e.g." is spelled out. These rules swap such things for words and for
punctuation Kokoro pauses on; nothing is dropped without a pause in its place.
They don't touch what the text says.

A slash means different things, so it's read by what its token looks like:
a path is "the file scripts slash fork dot sh", a branch "upstream slash
main", a repository "the repository SupposedlySam slash kass", a command in
backticks "the command, git status,", and only two plain words "tab or page".
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
# Marks a command from a code span until its label is added (_label_commands).
_COMMAND_START, _COMMAND_END = "\x01", "\x02"
# A code span starting with one of these, and longer than one word, is a command.
_COMMANDS = frozenset(
    {
        "git",
        "gh",
        "just",
        "npm",
        "npx",
        "bun",
        "bunx",
        "yarn",
        "pnpm",
        "cargo",
        "rustup",
        "cd",
        "ls",
        "cat",
        "rm",
        "mv",
        "cp",
        "mkdir",
        "open",
        "sudo",
        "brew",
        "pip",
        "pip3",
        "python",
        "python3",
        "uv",
        "curl",
        "make",
        "docker",
        "kubectl",
        "flutter",
        "dart",
        "ssh",
        "echo",
        "export",
        "source",
        "chmod",
        "grep",
        "sed",
    }
)

# A path, a branch or a repository: words joined by slashes, maybe starting
# at ~, ., .. or /, maybe ending in /. Or a bare file name with a known extension.
_EXTENSIONS = (
    "md|mdx|rs|py|ts|tsx|js|jsx|mjs|cjs|json|toml|yaml|yml|txt|sh|zsh|html|css|scss|lock|swift|"
    "dart|kt|go|rb|java|cpp|plist|sql|log|csv|wav|mp3|png|jpg|svg|pdf|zip|spec|cfg|ini|env|xml"
)
# A part may start with a dot (".cache") but never ends with one, so a
# sentence's period isn't read as part of a path.
_SEGMENT = r"\.?[\w@+-](?:[\w@.+-]*[\w@+-])?"
_TECHNICAL = re.compile(
    rf"(?<![\w/~.@:-])("
    rf"(?:~|\.\.?)?/?{_SEGMENT}(?:/{_SEGMENT})+/?"  # a/b, ~/a/b, ./a, a/b/
    rf"|/{_SEGMENT}(?:/{_SEGMENT})*/?"  # /usr/bin
    rf"|{_SEGMENT}\.(?:{_EXTENSIONS})"  # FORK.md
    rf")(?![\w/])"
)
_FILE = re.compile(rf"\.(?:{_EXTENSIONS})$")
# Two-part names that are git branches: a remote or branch prefix, or a
# branch name, on either side ("upstream/main", "feature/read-aloud").
_REF_LEFT = frozenset(
    {
        "origin",
        "upstream",
        "feature",
        "fix",
        "bugfix",
        "hotfix",
        "release",
        "chore",
        "docs",
        "refactor",
        "test",
        "heads",
        "remotes",
        "refs",
    }
)
_REF_RIGHT = frozenset({"main", "master", "develop", "dev", "trunk", "head"})
# Said already, so no label goes in front ("the file x", "branch x").
_NAMED = frozenset(
    {
        "a",
        "an",
        "the",
        "this",
        "that",
        "file",
        "files",
        "folder",
        "folders",
        "directory",
        "dir",
        "path",
        "script",
        "scripts",
        "branch",
        "branches",
        "repo",
        "repository",
        "command",
    }
)
_EMPHASIS = re.compile(r"(\*\*|__)(.+?)\1|(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")

# At a line's start: headings, bullets, quotes. A number list ("1. ") is kept.
_LINE_MARKER = re.compile(r"^\s*(?:#{1,6}\s+|[-*•+]\s+|>\s*)")
# "A. Cut them": a lettered option, which misaki would read "A cut them".
_OPTION = re.compile(r"^([A-F])[.)]\s+(?=[A-Z\"'“])")
_PARENS = re.compile(r"\s*\(([^()\n]*)\)")
# Words joined by spaced slashes outside brackets: "lift / hold". Unspaced
# ones ("tab/page") are told apart from paths by _technical.
_SLASHED = re.compile(r"(?<![\w/.:])([A-Za-z][\w'-]*(?:\s+/\s+[A-Za-z][\w'-]*)+)(?![\w/])")
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


def _said_technically(token: str) -> str:
    """``token`` with its symbols as words: "src-tauri/main.rs" is "src hyphen tauri slash main dot rs"."""
    said = re.sub(r"^~", "tilde ", token.rstrip("/"))
    said = said.replace("/", " slash ").replace("-", " hyphen ").replace("_", " underscore ")
    said = re.sub(r"\.(?=\w)", " dot ", said)
    return " ".join(said.split())


def _is_plain_word(segment: str) -> bool:
    return segment.isalpha() and (segment.islower() or segment.istitle())


def _technical(match: re.Match) -> str:
    """A slashed token or file name, said as what it is (see the module docstring)."""
    token = match.group(1)
    segments = [segment for segment in token.split("/") if segment]
    before = match.string[: match.start()].split()
    named = bool(before) and before[-1].lower().strip("`\"'“(") in _NAMED

    def labeled(label: str) -> str:
        said = _said_technically(token)
        if named:
            return said
        return f"{label} {said}" if before else f"{label.capitalize()} {said}"

    if all(segment.isdigit() for segment in segments):
        return token  # 10/2, 24/7
    if "/" not in token:
        # A bare file name, unless it's a name like Node.js.
        if re.fullmatch(r"[A-Z][a-z]+\.js", token):
            return token
        return labeled("the file")
    if _FILE.search(token):
        return labeled("the file")
    if token.endswith("/"):
        return labeled("the folder")
    if token.startswith(("/", "~", ".")) or len(segments) >= 3:
        return labeled("the path")
    left, right = segments
    if left.lower() in _REF_LEFT or right.lower() in _REF_RIGHT:
        return _said_technically(token)
    if [left.lower(), right.lower()] == ["and", "or"]:
        return "and or"
    if _is_plain_word(left) and _is_plain_word(right):
        return f"{left} or {right}"
    # An owner with digits or capitals inside ("mrgnhnt96", "SupposedlySam").
    if re.search(r"\d|[a-z][A-Z]", left):
        return labeled("the repository")
    return _said_technically(token)


def _label_commands(line: str) -> str:
    """A command from a code span, set off by commas: "run the command, git status,"."""

    def label(match: re.Match) -> str:
        before = line[: match.start()].split()
        article = bool(before) and re.fullmatch(r"(?i)a|an|the|this|that|your|our|plain", before[-1])
        return f"{'command' if article else 'the command'}, {match.group(1)},"

    return re.sub(f"{_COMMAND_START}(.*?){_COMMAND_END}", label, line)


def _said_command(command: str) -> str:
    """A command as typed: paths without labels, and flags with their dashes."""
    said = _TECHNICAL.sub(
        lambda m: m.group(1) if m.group(1).replace("/", "").isdigit() else _said_technically(m.group(1)),
        command,
    )
    return re.sub(r"(?<!\S)(--?)(?=\w)", lambda m: "dash " * len(m.group(1)), said)


def _code(match: re.Match) -> str:
    inner = match.group(1).strip()
    words = inner.split()
    if len(words) > 1 and (words[0] in _COMMANDS or words[0].startswith(("./", "scripts/"))):
        return f"{_COMMAND_START}{_said_command(inner)}{_COMMAND_END}"
    return inner


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
    line = _TECHNICAL.sub(_technical, line)
    line = _label_commands(line)
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
    text = _CODE.sub(_code, text)
    text = _EMPHASIS.sub(lambda m: m.group(2) or m.group(3), text)
    # Before paths are read, so "w/o" is "without", not a path.
    for pattern, said in _ABBREVIATIONS + _SYMBOLS:
        text = pattern.sub(said, text)
    return "\n".join(_line(line) for line in text.splitlines())
