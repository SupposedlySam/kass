"""Conservative spoken formatting for complete, explicit dictation commands.

Return None for ambiguous/unsupported wording so normal refinement still runs.
Only standalone commands are recognized; quoted/reported speech is preserved.
"""

import re

# A command must start the transcript or follow sentence punctuation/a line break.
_BOUNDARY = r"(?:^|(?<=[.!?\n])\s+)"
_LINE = r"(?:add (?:a )?|insert (?:a )?)?new (?:line|paragraph)"
_LIST = r"(?:create|make|add) (?:a )?(?:(?:bullet|bulleted) )?list of"
_START = re.compile(
    _BOUNDARY
    + rf"(?P<line>{_LINE})(?:\s+and\s+then)?\s+(?P<list>{_LIST})\s+"
    + "|"
    + _BOUNDARY
    + rf"(?P<list_only>{_LIST})\s+",
    re.IGNORECASE,
)
_CANCEL = re.compile(
    r"(?:and\s+)?(?:actually\s*,?\s*(?:no\s*,?\s*)?|no\s*,?\s*)?"
    r"(?:remove|delete)\s+(?:that|the)\s+list[.!]?\s*$",
    re.IGNORECASE,
)
_LAST_ITEM = re.compile(
    r"(?:and\s+)?(?:actually\s*,?\s*(?:no\s*,?\s*)?)?"
    r"(?:remove|delete)\s+the\s+last\s+item[.!]?\s*$",
    re.IGNORECASE,
)
# A spoken break: "new line", "newline", "line break", "new paragraph", "next
# line", optionally led by a verb ("add a new line", "go to the next line").
_BREAK = r"(?:new ?line(?: break)?|line break|new paragraph|paragraph break|next (?:line|paragraph))"
_LEAD = r"(?:add|insert|start|put|make|begin|type|give me|go to|move to|skip to|jump to|drop to)\s+(?:(?:a|an|the|another)\s+)?"
_BREAK_COMMAND = re.compile(
    # A comma Whisper put before the command goes with it; sentence marks stay.
    # A quoted phrase ("new line") is words, not a command.
    rf"(?:[ \t]*,)?[ \t]*(?<![\w'\u2019\"\u201c\u201d-])(?P<lead>{_LEAD})?(?P<phrase>{_BREAK})(?![\w'\u2019\"\u201c\u201d-])"
    # "a new line of products", "newline character": a noun, not a command.
    r"(?P<noun>\s+(?:of|for|characters?|chars?|feeds?|endings?|separators?|symbols?|breaks?)\b)?"
    r"[ \t]*[.,;:!]?[ \t]*",
    re.IGNORECASE,
)
# Before a phrase with no lead verb, these make it something talked about:
# "the next line", "on a new line", "our new line".
_TALKED_ABOUT = frozenset(
    "a an the this that these those each every another one any some no our my your his her its their"
    " of on in at to into onto with for by from per what which whose".split()
)
# Before "open quote" or "end quote", only these do: "the end quote".
_NAMED = frozenset("a an the this that these those each every another any some no our my your his her its their".split())
_PREVIOUS_WORD = re.compile(r"([\w'\u2019]+)\W*$")
# A spoken mark: "open quote", "end quote", "unquote", "open parenthesis",
# "close paren", or a bare "quote" or "parentheses" that opens and, said
# again, closes.
_MARK_COMMAND = re.compile(
    r"(?<![\w'\u2019-])(?:(?P<open>open|start|begin)\s+|(?P<close>close|end)\s+)?"
    r"(?:(?P<quote>quot(?:es?|ation marks?))|(?P<paren>paren(?:s|thesis|theses)?)|(?P<unquote>unquote))"
    r"(?![\w'\u2019-])",
    re.IGNORECASE,
)


def _capitalized(text: str) -> str:
    return text[:1].upper() + text[1:]


def apply_dictation_edits(text: str, *, formatting: bool, corrections: bool) -> str | None:
    """Apply a standalone list command with a clear, local edit target.

    Line and paragraph breaks alone are left to ``apply_line_breaks``, so the
    text around them still gets cleaned up.

    List items must be comma-separated. Only a final list, optionally followed
    by an explicit cancellation or last-item removal, is parsed. A mention of
    a list inside prose, quotes, or more complex edits is left to refinement.
    """
    if not formatting:
        return None
    # Quotation marks could make a command literal. Apostrophes in contractions
    # are fine, but quoted commands should never delete or restructure prose.
    if any(mark in text for mark in ('"', "\u201c", "\u201d", "\u2018")) or re.search(r"(?<!\w)['\u2019](?=\w)", text):
        return None

    matches = list(_START.finditer(text))
    if matches:
        if len(matches) != 1:
            return None
        match = matches[0]
        prefix = text[: match.start()].rstrip()
        tail = text[match.end() :].strip()
        # Keep parsing deliberately bounded: no sentence punctuation in items.
        parts = re.split(r"[.!?]\s+", tail, maxsplit=1)
        items_text = parts[0].rstrip(".!?").strip()
        revision = parts[1].strip() if len(parts) == 2 else ""
        cancel = bool(revision and _CANCEL.fullmatch(revision))
        remove_last = bool(revision and _LAST_ITEM.fullmatch(revision))
        if revision and not ((cancel or remove_last) and corrections):
            return None
        if any(char in items_text for char in ".!?\n"):
            return None
        items = [item.strip() for item in items_text.split(",")]
        if len(items) < 2 or any(not item for item in items):
            return None
        # Oxford comma or a final "B and C" are the supported list separators.
        last = re.sub(r"^and\s+", "", items.pop(), flags=re.IGNORECASE)
        items.extend(re.split(r"\s+and\s+", last, maxsplit=1, flags=re.IGNORECASE))
        if any(not item for item in items):
            return None
        if cancel:
            # Empty refinement results are not supported by captures; don't
            # manufacture a replacement when the entire take was retracted.
            return prefix or None
        if remove_last:
            items.pop()
        lines = "\n".join(f"- {_capitalized(item)}" for item in items)
        separator = "\n\n" if match.group("line") and "paragraph" in match.group("line").lower() else "\n"
        return prefix + separator + lines if prefix else lines

    return None


def _is_command(text: str, match: re.Match) -> bool:
    if match.group("noun"):
        return False
    if match.group("lead"):
        return True
    before = text[: match.start()].rstrip(" \t")
    if not before or before[-1] in ".!?:;\n":
        return True
    # "next line" alone mid-sentence is usually read out, not a command.
    if match.group("phrase").lower().startswith("next"):
        return False
    previous = _PREVIOUS_WORD.search(before)
    return not (previous and previous.group(1).lower() in _TALKED_ABOUT)


def apply_line_breaks(text: str) -> str:
    """Turn spoken line and paragraph breaks into ``\n`` and ``\n\n``.

    "new line", "newline", "line break", "new paragraph", "next line" and the
    like, alone or led by a verb ("add a new line"), anywhere in the text. One
    that is talked about ("a new line of products", "the next line", "the
    newline character") stays as words. The line after a break starts with a
    capital. A break at the very start or end is kept: the text then starts or
    ends on a new line.
    """
    if not re.search(r"line|paragraph", text, re.IGNORECASE):
        return text
    pieces = []
    last = 0
    for match in _BREAK_COMMAND.finditer(text):
        if not _is_command(text, match):
            continue
        pieces.append(text[last : match.start()])
        pieces.append("\n\n" if "paragraph" in match.group("phrase").lower() else "\n")
        last = match.end()
    if not pieces:
        return text
    pieces.append(text[last:])
    joined = "".join(pieces)
    # Two breaks in a row ("new line new line") make a paragraph, no more.
    joined = re.sub(r"\n{3,}", "\n\n", joined).strip(" \t")
    return re.sub(r"(?<=\n)([^\S\n]*)(\w)", lambda m: m.group(1) + m.group(2).upper(), joined)


def _talked_about(text: str, match: re.Match, closes: bool) -> bool:
    previous = _PREVIOUS_WORD.search(text[: match.start()])
    if not previous:
        return False
    # "sort of close paren" and "the new one parentheses" close what was
    # opened; "in parentheses" is words.
    named = match.group("open") or match.group("close") or match.group("unquote") or closes
    return previous.group(1).lower() in (_NAMED if named else _TALKED_ABOUT)


def _mark_roles(text: str, matches: list[re.Match]) -> dict[int, bool]:
    """Which matches are commands, by index: True opens a mark, False closes one.

    A bare "quote" or "parentheses" is a command only when it has a partner:
    one alone ("get a quote", "quote me on that") is a word. "open quote" or
    "end quote" is a command on its own. "quote unquote" is an idiom, not a
    pair of marks around nothing.
    """
    roles: dict[int, bool] = {}
    bare: set[int] = set()
    opened: dict[str, list[int]] = {'"': [], "(": []}
    for index, match in enumerate(matches):
        kind = "(" if match.group("paren") else '"'
        if _talked_about(text, match, closes=bool(opened[kind])):
            continue
        explicit_close = match.group("close") or match.group("unquote")
        if match.group("open") or not (explicit_close or opened[kind]):
            roles[index] = True
            opened[kind].append(index)
            if not match.group("open"):
                bare.add(index)
            continue
        roles[index] = False
        if opened[kind]:
            partner = opened[kind].pop()
            if not re.search(r"\w", text[matches[partner].end() : match.start()]):
                del roles[partner], roles[index]
    for index in opened['"'] + opened["("]:
        if index in bare:
            roles.pop(index, None)
    return roles


def apply_spoken_marks(text: str) -> str:
    """Turn spoken quotation marks and parentheses into ``"`` and ``()``.

    "open quote", "start quote", "end quote", "close quote", "unquote",
    "open parenthesis", "close paren" and the like, or a bare "quote" or
    "parentheses" said once to open and again to close. An opening mark sits
    against the word after it and a closing mark against the word before it.
    A mark that is talked about ("a quote", "in parentheses") or a bare one
    with no partner stays as words.
    """
    if not re.search(r"quot|paren", text, re.IGNORECASE):
        return text
    matches = list(_MARK_COMMAND.finditer(text))
    roles = _mark_roles(text, matches)
    if not roles:
        return text
    out = ""
    last = 0
    for index, match in enumerate(matches):
        if index not in roles:
            continue
        out += text[last : match.start()]
        last = match.end()
        rest = text[last:]
        if roles[index]:
            mark = "(" if match.group("paren") else '"'
            out = out.rstrip(" \t")
            if mark == "(":
                # "the plan, open paren": the comma was Whisper's pause.
                out = out.rstrip(",").rstrip(" \t")
            if out and out[-1] not in '\n("':
                out += " "
            out += mark
            # Whisper's pause after the command ("quote, I'm") goes with it.
            last += len(rest) - len(rest.lstrip(" \t,.;:"))
            continue
        mark = ")" if match.group("paren") else '"'
        out = out.rstrip(" \t").rstrip(",").rstrip(" \t") + mark
        spaces = len(rest) - len(rest.lstrip(" \t"))
        rest = rest[spaces:]
        if out[-2:-1] in (".", "!", "?") and rest[:1] == ".":
            # "tired. End quote." has its period inside the mark already.
            spaces += 1
        elif rest[:1].isalnum():
            out += " "
        last += spaces
    return out + text[last:]
