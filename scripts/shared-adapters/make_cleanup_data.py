#!/usr/bin/env python3
"""Make training pairs for the shared cleanup adapter from clean sentences.

Each pair is (raw, expected): ``expected`` is a clean sentence from
cleanup_sentences.py, and ``raw`` is that sentence as Whisper writes a
speaker who stumbles: filler words, a false start, a repeat, a changed
answer, missing punctuation, stray capitals, or symbols said as words.
Some pairs stay clean, so the model learns to leave good text alone.

    backend/venv/bin/python scripts/shared-adapters/make_cleanup_data.py

Sentences close to the test set are dropped, and validation pairs come from
sentences training never sees. See docs/plans/SHARED_ADAPTERS.md.
"""

import argparse
import hashlib
import json
import random
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cleanup_sentences as bank
from cleanup_test import CASES

OUT = Path(__file__).resolve().parents[2] / "build" / "shared-adapters" / "cleanup-data"

FILLERS = ("um", "uh", "like", "you know", "I mean", "basically", "sort of", "kind of")
OPENERS = ("Um", "Uh", "Hmm", "Uh, um", "Um, uh")
# Openers that carry meaning. They stay, so the model learns that not every
# opening phrase is a false start.
KEPT_OPENERS = (
    "So, ",
    "I think ",
    "Honestly, ",
    "Like I said, ",
    "Actually, ",
    "To be fair, ",
    "Anyway, ",
    "Okay, ",
    "Well, ",
    "By the way, ",
    "Just so you know, ",
)
COUNTS = ("two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")
CUES = (
    ", no, ",
    ", no wait, ",
    ", actually, ",
    ", sorry, ",
    ", I mean, ",
    ", scratch that, ",
    ", no, no, ",
    ", wait, no, ",
    ", or was it ",
    ", make that ",
)
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
COLORS = ("red", "blue", "green", "black", "white", "gray", "yellow", "orange", "purple")
SIZES = ("small", "medium", "large")
NUMBER = re.compile(r"(?<![\w.:/-])(\$?)(\d{1,3}(?:,\d{3})+|\d+)(?![\w.:/]|,\d)")
TIME = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s?(am|pm|AM|PM)\b")


def canonical(text):
    return " ".join(re.findall(r"\w+", text.casefold()))


def near_test(sentence, tests):
    key = canonical(sentence)
    return any(SequenceMatcher(None, key, test, autojunk=False).ratio() >= 0.75 for test in tests)


def lower_first(text, names):
    word = text.split(" ", 1)[0]
    bare = re.sub(r"\W", "", word)
    if bare in ("I", "Im", "Ill", "Ive", "Id") or bare in names or bare[1:].lower() != bare[1:]:
        return text
    return text[0].lower() + text[1:]


def words(text):
    return text.split(" ")


def filler(rng, text, names):
    if rng.random() < 0.35:
        return f"{rng.choice(OPENERS)}, {lower_first(text, names)}"
    parts = words(text)
    if len(parts) < 4:
        return None
    # Often right after the opening words ("Can you, uh, send"), where a
    # filler mustn't take the words before it along.
    at = rng.randint(1, min(3, len(parts) - 2)) if rng.random() < 0.5 else rng.randrange(1, len(parts) - 1)
    if re.search(r"[/_.@]|\d", parts[at - 1]):
        return None
    word = rng.choice(FILLERS)
    if rng.random() < 0.25:
        word = f"{word}, {rng.choice(('um', 'uh'))}"
    previous = parts[at - 1]
    joined = f"{previous}, {word}," if not previous.endswith(",") else f"{previous} {word},"
    return " ".join([*parts[: at - 1], joined, *parts[at:]])


def repeat(rng, text, names):
    parts = words(text)
    if len(parts) < 4:
        return None
    if rng.random() < 0.6:
        count = rng.randint(1, min(3, len(parts) - 2))
        head = " ".join(parts[:count]).rstrip(",")
        separator = ", " if rng.random() < 0.6 else " "
        return f"{head}{separator}{lower_first(text, names) if separator == ', ' else text}"
    at = rng.randrange(1, len(parts) - 1)
    if not re.fullmatch(r"[A-Za-z']+", parts[at]):
        return None
    return " ".join([*parts[: at + 1], parts[at], *parts[at + 1 :]])


# A false start the speaker drops is cut off: it can't stand on its own.
# Openers that can ("Can you,", "We should,") stay in the text, so the model
# never learns that any short phrase before a comma is a false start.
FALSE_STARTS = (
    "I was going to",
    "So what I",
    "Do you know if",
    "I feel like the",
    "Is there a",
    "What we need is",
    "My plan was to",
    "I wanted to",
    "The thing is that the",
    "What if we",
    "I think the",
    "We were going to",
)
# Where a speaker trails off before starting the sentence over.
ABANDONED = ("it", "the", "a", "that", "this", "to", "some", "we", "you", "my", "our")


def restart(rng, text, names):
    """A false start: the speaker begins one way, stops, and starts over.

    Usually the restart repeats how the sentence opens ("I'll send it, I'll
    send the invoice"); otherwise the dropped start is cut off mid-phrase.
    """
    parts = words(text)
    if rng.random() < 0.6 and len(parts) >= 4:
        count = rng.randint(1, min(3, len(parts) - 3))
        head = parts[:count]
        if any(re.search(r"[,.?!:;]$", word) for word in head):
            return None
        trailing = rng.choice([word for word in ABANDONED if word != parts[count].casefold()])
        return f"{' '.join(head)} {trailing}, {lower_first(text, names)}"
    start = rng.choice(FALSE_STARTS)
    if canonical(text).startswith(canonical(start)):
        return None
    return f"{start}, {lower_first(text, names)}"


def _changed_value(rng, kind, value):
    if kind == "weekday":
        return rng.choice([day for day in WEEKDAYS if day != value])
    if kind == "color":
        return rng.choice([color for color in COLORS if color != value])
    if kind == "size":
        return rng.choice([size for size in SIZES if size != value])
    if kind == "count":
        return rng.choice([count for count in COUNTS if count != value.lower()])
    if kind == "name":
        return rng.choice([name for name in bank.NAMES if name != value])
    if kind == "place":
        return rng.choice([place for place in bank.PLACES if place != value])
    if kind == "time":
        hour = int(TIME.match(value).group(1))
        other = rng.choice([h for h in range(1, 13) if h != hour])
        return TIME.sub(
            lambda m: f"{other}{':' + m.group(2) if m.group(2) else ''}{' ' if ' ' in value else ''}{m.group(3)}", value
        )
    if kind == "number":
        dollar, digits = NUMBER.fullmatch(value).groups()
        number = int(digits.replace(",", ""))
        other = number
        while other == number:
            other = max(1, round(number * rng.choice((0.5, 0.75, 1.5, 2, 3)))) if number > 3 else rng.randint(1, 9)
        formatted = f"{other:,}" if "," in digits or other >= 10_000 else str(other)
        return dollar + formatted
    raise ValueError(kind)


def slots(text):
    found = []
    for day in WEEKDAYS:
        found += [("weekday", m.start(), m.end()) for m in re.finditer(rf"\b{day}\b", text)]
    for color in COLORS:
        found += [("color", m.start(), m.end()) for m in re.finditer(rf"\b{color}\b", text)]
    for size in SIZES:
        found += [("size", m.start(), m.end()) for m in re.finditer(rf"\b{size}\b", text)]
    for name in bank.NAMES:
        found += [("name", m.start(), m.end()) for m in re.finditer(rf"\b{re.escape(name)}\b", text)]
    for place in bank.PLACES:
        found += [("place", m.start(), m.end()) for m in re.finditer(re.escape(place), text)]
    for count in COUNTS:
        found += [("count", m.start(), m.end()) for m in re.finditer(rf"\b{count}\b", text)]
    found += [("time", m.start(), m.end()) for m in TIME.finditer(text)]
    taken = [(start, end) for _, start, end in found]
    for m in NUMBER.finditer(text):
        if not any(start <= m.start() < end for start, end in taken):
            found.append(("number", m.start(), m.end()))
    return found


def changed_answer(rng, text, names):
    """The speaker says one value, takes it back, and says the right one."""
    found = slots(text)
    if not found:
        return None
    kind, start, end = rng.choice(found)
    right = text[start:end]
    wrong = _changed_value(rng, kind, right)
    cue = rng.choice(CUES)
    if cue == ", or was it " and rng.random() < 0.5:
        return f"{text[:start]}{wrong}{cue}{right}, {right}{text[end:]}"
    return f"{text[:start]}{wrong}{cue}{right}{text[end:]}"


def strip_punctuation(rng, text, names):
    """Whisper sometimes writes a take with no punctuation or capitals."""
    stripped = re.sub(r"[.,!?;:](?=\s|$)", "", text)
    stripped = re.sub(
        r"(^|(?<=\s))([A-Z])([a-z']+)\b",
        lambda m: m.group(0) if m.group(0) in names else m.group(1) + m.group(2).lower() + m.group(3),
        stripped,
    )
    stripped = re.sub(r"\bi\b", "I", stripped)
    return stripped if stripped != text else None


def stray_capitals(rng, text, names):
    parts = words(text)
    candidates = [i for i, word in enumerate(parts[1:], 1) if re.fullmatch(r"[a-z]{3,}[,.]?", word)]
    if not candidates:
        return None
    for i in rng.sample(candidates, min(len(candidates), rng.randint(1, 2))):
        parts[i] = parts[i][0].upper() + parts[i][1:]
    return " ".join(parts)


SPOKEN = (("/", " slash "), ("_", " underscore "), (".", " dot "))


def spoken_symbols(rng, text, names):
    """File paths and identifiers as the speaker said them."""

    def say(match):
        token = match.group(0)
        if re.fullmatch(r"\d+(\.\d+)+", token) or re.fullmatch(r"https?:.*", token):
            return token
        if token.startswith("--"):
            return "dash dash " + token[2:]
        for symbol, spoken in SPOKEN:
            token = token.replace(symbol, spoken)
        return re.sub(r"\s+", " ", token).strip()

    spoken = re.sub(r"--[\w-]+|\b[\w-]+(?:[/_.][\w-]+)+", say, text)
    return spoken if spoken != text else None


def make_pair(rng, sentence, kind, names):
    """(raw, expected, edits) for one clean sentence."""
    if kind == "statements" and rng.random() < 0.15:
        sentence = rng.choice(KEPT_OPENERS) + lower_first(sentence, names)
    if rng.random() < 0.15:
        return sentence, sentence, "leave"
    edits = {
        filler: 3,
        repeat: 2,
        changed_answer: 4,
        stray_capitals: 1,
        restart: 3,
        strip_punctuation: 6 if kind in ("questions", "commands") else 2,
    }
    if kind == "technical":
        edits[spoken_symbols] = 6
    raw, applied = sentence, []
    for _ in range(1 if rng.random() < 0.75 else 2):
        # An edit that doesn't fit this sentence gives way to another one.
        for _ in range(6):
            edit = rng.choices(list(edits), list(edits.values()))[0]
            # Without its comma, a false start can't be told from content.
            if edit in applied or (edit is strip_punctuation and restart in applied):
                continue
            result = edit(rng, raw, names)
            if result and result != raw:
                raw = result
                applied.append(edit)
                break
    return raw, sentence, "+".join(edit.__name__ for edit in applied) or "leave"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=int, default=3000)
    parser.add_argument("--valid", type=int, default=150)
    parser.add_argument("--seed", type=int, default=5)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    tests = [canonical(text) for _, raw, expected in CASES for text in (raw, expected)]
    names = frozenset(bank.NAMES)
    sources = {
        "statements": bank.STATEMENTS,
        "questions": bank.QUESTIONS,
        "commands": bank.COMMANDS,
        "technical": bank.TECHNICAL,
    }
    shares = {"statements": 0.45, "questions": 0.15, "commands": 0.22, "technical": 0.18}
    splits = {"train": {}, "valid": {}}
    dropped = 0
    for kind, sentences in sources.items():
        for sentence in sentences:
            if near_test(sentence, tests):
                dropped += 1
                continue
            bucket = int(hashlib.sha256(sentence.encode()).hexdigest()[:8], 16) % 10
            splits["valid" if bucket == 0 else "train"].setdefault(kind, []).append(sentence)
    OUT.mkdir(parents=True, exist_ok=True)
    for split, count in (("train", args.train), ("valid", args.valid)):
        rows = []
        kinds = list(shares)
        while len(rows) < count:
            kind = rng.choices(kinds, [shares[k] for k in kinds])[0]
            sentence = rng.choice(splits[split][kind])
            raw, expected, edit = make_pair(rng, sentence, kind, names)
            rows.append({"raw": raw, "expected": expected, "kind": kind, "edit": edit})
        with (OUT / f"{split}.jsonl").open("w") as stream:
            for row in rows:
                stream.write(json.dumps(row) + "\n")
    print(f"dropped {dropped} sentences close to the test set; wrote {OUT}")


if __name__ == "__main__":
    main()
