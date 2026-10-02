"""Take one round of corrections back out of the rounds made after it.

A capture's corrections stack: each holds the whole text as the user left
it, starting from the one before. Removing a round that newer ones were
built on takes back only its own changes and keeps theirs, a three-way merge
by words. Where a newer round changed the same words, the newer round wins.
"""

import re
from difflib import SequenceMatcher

_TOKEN = re.compile(r"\w+|\s+|[^\w\s]")


def take_back(before: str, removed: str, newer: str) -> str:
    """``newer`` without the changes that turned ``before`` into ``removed``.

    ``newer`` was made from ``removed``; its own changes are kept.
    """
    return "".join(_merge(_TOKEN.findall(removed), _TOKEN.findall(newer), _TOKEN.findall(before)))


def _merge(base: list[str], ours: list[str], theirs: list[str]) -> list[str]:
    """``base`` with the changes of both sides; ``ours`` wins where they touch."""
    sides = [(side, SequenceMatcher(None, base, side, autojunk=False).get_opcodes()) for side in (ours, theirs)]
    changes = sorted(
        (i1, i2, which) for which, (_, ops) in enumerate(sides) for tag, i1, i2, _, _ in ops if tag != "equal"
    )
    out: list[str] = []
    at = 0
    k = 0
    while k < len(changes):
        lo, hi, which = changes[k]
        involved = {which}
        k += 1
        # Changes that overlap are one chunk; ones that only meet both apply.
        while k < len(changes) and changes[k][0] < hi:
            hi = max(hi, changes[k][1])
            involved.add(changes[k][2])
            k += 1
        out += base[at:lo]
        side, ops = sides[0] if 0 in involved else sides[1]
        out += _slice(side, ops, lo, hi)
        at = hi
    out += base[at:]
    return out


def _slice(side: list[str], ops, lo: int, hi: int) -> list[str]:
    """What ``side`` has where ``base`` has ``lo:hi``, whose ends no change of ``side`` crosses."""
    out: list[str] = []
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal":
            start, end = max(i1, lo), min(i2, hi)
            if start < end:
                out += side[j1 + start - i1 : j1 + end - i1]
        elif lo <= i1 and i2 <= hi:
            out += side[j1:j2]
    return out
