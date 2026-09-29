"""The user's dictionaries: words dictation should get right (docs/plans/DICTIONARIES.md).

An entry is a term ("Kubernetes"), which Whisper is prompted with and whose
capitals are fixed after cleanup, or a replacement, which writes ``written``
wherever ``spoken`` was said. Entries belong to every app ("global"), to a
writing style, or to one app; a dictation merges its app's, its style's and
the global ones, and the most specific wins.

Dictation never reads the database: entries are read once per change, and
each app's merged dictionary is kept until the next one.
"""

import re
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime

SCOPES = ("app", "style", "global")
MAX_ENTRIES = 1000
MAX_LENGTH = 200
# Whisper keeps the last 223 tokens of its prompt; terms take at most this
# many, and the earlier text the rest.
PROMPT_TOKENS = 64

# Words, as correction_rules.py matches them.
_WORD = re.compile(r"\w+(?:['\u2019-]\w+)*", re.UNICODE)
# Between the words of a phrase: Whisper writes "voice box" and "voice-box".
_BETWEEN = r"[\s-]+"


class DuplicateEntryError(ValueError):
    """The scope already has an entry for the same word said."""


@dataclass(frozen=True)
class Entry:
    id: str
    scope: str
    scope_id: str | None
    app_name: str | None
    written: str
    spoken: str | None
    created_at: datetime | None
    # The entry this row is one place of (its own id when it applies in one).
    group_id: str | None = None


@dataclass(frozen=True)
class Place:
    scope: str
    scope_id: str | None = None
    app_name: str | None = None


@dataclass(frozen=True)
class Group:
    """An entry as the user edits it: one word, in every place it applies."""

    id: str
    written: str
    spoken: str | None
    places: tuple[Place, ...]
    created_at: datetime | None


def _key(written: str, spoken: str | None) -> str:
    return " ".join((spoken or written).split()).casefold()


def _phrase(text: str) -> str:
    """``text`` as a pattern that also matches it with other spaces or hyphens between words."""
    return _BETWEEN.join(re.escape(part) for part in re.split(_BETWEEN, text.strip()))


def _bounded(alternatives: Iterable[str]) -> re.Pattern | None:
    # Longest first, so "voice box app" wins over "voice box" where both match.
    ordered = sorted(set(alternatives), key=len, reverse=True)
    if not ordered:
        return None
    return re.compile(r"(?<![\w'\u2019-])(?:" + "|".join(ordered) + r")(?![\w'\u2019-])", re.IGNORECASE)


def _normal(text: str) -> str:
    return " ".join(re.split(_BETWEEN, text.strip())).casefold()


@dataclass
class Dictionary:
    """One app's merged dictionary, as dictation uses it."""

    # Whisper prompt candidates, most specific first: terms, then what replacements write.
    terms: tuple[str, ...] = ()
    # Capitalized terms, which dictation keeps capitalized mid-sentence.
    names: frozenset[str] = frozenset()
    replacements: dict[str, str] = field(default_factory=dict)
    # Terms whose case is fixed after cleanup, by lowercased form.
    spellings: dict[str, str] = field(default_factory=dict)
    # The most words a match covers, which provisional text holds back.
    span: int = 0
    _compiled: tuple | None = field(default=None, repr=False)

    def _patterns(self):
        # Built on first use, after dictation has loaded the word data
        # _common_word reads, never while a take starts.
        if self._compiled is None:
            from .phrase_seams import _common_word

            recased = {
                key: term
                for key, term in self.spellings.items()
                if not all(_common_word(word) for word in _WORD.findall(term))
            }
            self._compiled = (
                _bounded(_phrase(spoken) for spoken in self.replacements),
                _bounded(_phrase(term) for term in recased.values()),
                recased,
            )
        return self._compiled

    def apply(self, text: str) -> str:
        """Replacements, then terms written with their own capitals.

        A term that is a common word ("Mark", "Slack") keeps whatever case
        the text gave it: it may be the word ("mark this") and not the name.
        """
        if not text or not (self.replacements or self.spellings):
            return text
        replace, recase, recased = self._patterns()
        if replace is not None:
            text = replace.sub(lambda m: self.replacements.get(_normal(m.group()), m.group()), text)
        if recase is not None:
            text = recase.sub(lambda m: recased.get(_normal(m.group()), m.group()), text)
        return text


EMPTY = Dictionary()


def resolve(entries: Iterable[Entry], bundle_id: str | None, style_id: str | None) -> list[tuple[Entry, bool]]:
    """The entries a dictation in ``bundle_id`` uses, most specific first, and
    whether a more specific one overrides each (the same word said)."""
    rank = {"app": 0, "style": 1, "global": 2}
    applies = [
        entry
        for entry in entries
        if entry.scope == "global"
        or (entry.scope == "style" and style_id and entry.scope_id == style_id)
        or (entry.scope == "app" and bundle_id and entry.scope_id == bundle_id)
    ]
    # Newest first within a scope: a word just added is likely the one in use.
    applies.sort(key=lambda e: e.created_at or datetime.min, reverse=True)
    applies.sort(key=lambda e: rank[e.scope])
    seen: set[str] = set()
    resolved = []
    for entry in applies:
        key = _key(entry.written, entry.spoken)
        resolved.append((entry, key in seen))
        seen.add(key)
    return resolved


def build(resolved: list[tuple[Entry, bool]]) -> Dictionary:
    active = [entry for entry, overridden in resolved if not overridden]
    if not active:
        return EMPTY
    terms: list[str] = []
    spellings: dict[str, str] = {}
    replacements: dict[str, str] = {}
    for entry in active:
        if entry.spoken:
            replacements.setdefault(_normal(entry.spoken), entry.written)
    # Terms before what replacements write, which Whisper needs less: the
    # replacement fixes those whatever Whisper hears.
    for entry in sorted(active, key=lambda e: bool(e.spoken)):
        written = entry.written.strip()
        if _normal(written) in spellings:
            continue
        spellings[_normal(written)] = written
        terms.append(written)
    names = frozenset(word for term in terms for word in _WORD.findall(term) if word[:1].isupper())
    span = max(len(re.split(_BETWEEN, text)) for text in [*replacements, *spellings])
    return Dictionary(tuple(terms), names, replacements, spellings, span)


def fit_terms(
    terms: Iterable[str], count: Callable[[str], int], budget: int | None = None
) -> tuple[list[str], list[str]]:
    """The terms that fit Whisper's prompt in order, and the rest.

    ``count`` is the tokens of " <term>"; each term also takes a separator.
    The first that does not fit ends the list, so a lower scope never
    displaces a higher one.
    """
    budget = PROMPT_TOKENS if budget is None else budget
    fit, dropped, used = [], [], 1
    for term in terms:
        cost = count(term) + 1
        if dropped or used + cost > budget:
            dropped.append(term)
            continue
        fit.append(term)
        used += cost
    return fit, dropped


def prompt(terms: Iterable[str]) -> str:
    """The terms as Whisper reads them: a plain list that ends a sentence."""
    terms = list(terms)
    return ", ".join(terms) + "." if terms else ""


# -- the entries, read once per change --------------------------------------

_lock = threading.Lock()
_entries: tuple[Entry, ...] | None = None
_by_app: dict[tuple[str, str], Dictionary] = {}


def _entry(row) -> Entry:
    return Entry(
        id=row.id,
        scope=row.scope,
        scope_id=row.scope_id or None,
        app_name=row.app_name,
        written=row.written,
        spoken=row.spoken,
        created_at=row.created_at,
        group_id=row.group_id or row.id,
    )


def entries() -> tuple[Entry, ...]:
    global _entries
    with _lock:
        if _entries is not None:
            return _entries
    from ..database import session as database_session
    from ..database.models import DictionaryEntry

    if database_session.SessionLocal is None:
        return ()
    with database_session.SessionLocal() as db:
        loaded = tuple(_entry(row) for row in db.query(DictionaryEntry).all())
    with _lock:
        _entries = loaded
    return loaded


def invalidate() -> None:
    global _entries
    with _lock:
        _entries = None
        _by_app.clear()


def resolved_for(bundle_id: str | None) -> list[tuple[Entry, bool]]:
    from .styles import snapshot as styles_snapshot

    return resolve(entries(), bundle_id, styles_snapshot().for_app(bundle_id).id)


def for_app(bundle_id: str | None, style_id: str | None = None) -> Dictionary:
    """The dictionary a dictation in ``bundle_id`` uses (None: an unknown app),
    written in ``style_id`` when one was asked for, else the app's style."""
    from .styles import snapshot as styles_snapshot

    style_id = style_id or styles_snapshot().for_app(bundle_id).id
    cache_key = (bundle_id or "", style_id)
    with _lock:
        cached = _by_app.get(cache_key)
    if cached is not None:
        return cached
    built = build(resolve(entries(), bundle_id, style_id))
    with _lock:
        _by_app[cache_key] = built
    return built


# -- editing -----------------------------------------------------------------


def _clean(text: object, what: str) -> str:
    if not isinstance(text, str) or not (cleaned := " ".join(text.split())):
        raise ValueError(f"{what} can't be empty")
    if len(cleaned) > MAX_LENGTH:
        raise ValueError(f"{what} can be at most {MAX_LENGTH} characters")
    return cleaned


def _clean_spoken(spoken: object) -> str | None:
    if spoken is None or (isinstance(spoken, str) and not spoken.strip()):
        return None
    cleaned = _clean(spoken, "What you say")
    if not _WORD.search(cleaned):
        raise ValueError("What you say needs at least one word")
    return cleaned


def _place(place) -> Place:
    """A place from the API, checked: global, an existing style, or an app."""
    from .styles import snapshot as styles_snapshot

    if isinstance(place, Place):
        scope, scope_id, app_name = place.scope, place.scope_id, place.app_name
    else:
        scope, scope_id, app_name = place.get("scope"), place.get("scope_id"), place.get("app_name")
    if scope not in SCOPES:
        raise ValueError("Unknown dictionary scope")
    if scope == "global":
        return Place("global")
    if not isinstance(scope_id, str) or not scope_id.strip():
        raise ValueError("Choose the style or app this entry is for")
    scope_id = scope_id.strip()
    if scope == "style":
        if styles_snapshot().get(scope_id) is None:
            raise ValueError("That writing style doesn't exist")
        return Place("style", scope_id)
    return Place("app", scope_id, app_name if isinstance(app_name, str) and app_name.strip() else None)


def _places(places) -> list[Place]:
    """Checked, without repeats; everywhere replaces every other place."""
    cleaned: list[Place] = []
    for place in places or ():
        found = _place(place)
        if found.scope == "global":
            return [found]
        if all((p.scope, p.scope_id) != (found.scope, found.scope_id) for p in cleaned):
            cleaned.append(found)
    if not cleaned:
        raise ValueError("Choose where this word applies")
    return cleaned


def _place_name(place: Place) -> str:
    from .styles import snapshot as styles_snapshot

    if place.scope == "global":
        return "everywhere"
    if place.scope == "style":
        style = styles_snapshot().get(place.scope_id)
        return f"the {style.name} style" if style else "that style"
    return place.app_name or place.scope_id


def _check_unique(db, place: Place, key: str, group_id: str | None = None) -> None:
    from sqlalchemy import func

    from ..database.models import DictionaryEntry

    query = db.query(DictionaryEntry).filter(
        DictionaryEntry.scope == place.scope,
        DictionaryEntry.scope_id == (place.scope_id or ""),
        DictionaryEntry.key == key,
    )
    if group_id:
        query = query.filter(func.coalesce(DictionaryEntry.group_id, DictionaryEntry.id) != group_id)
    if query.first() is not None:
        raise DuplicateEntryError(f"That word is already in the dictionary for {_place_name(place)}")


def _rows(db, group_id: str):
    from sqlalchemy import func

    from ..database.models import DictionaryEntry

    return (
        db.query(DictionaryEntry)
        .filter(func.coalesce(DictionaryEntry.group_id, DictionaryEntry.id) == group_id)
        .order_by(DictionaryEntry.created_at)
        .all()
    )


def _group(rows) -> Group:
    first = rows[0]
    return Group(
        id=first.group_id or first.id,
        written=first.written,
        spoken=first.spoken,
        places=tuple(Place(row.scope, row.scope_id or None, row.app_name) for row in rows),
        created_at=min((row.created_at for row in rows if row.created_at), default=None),
    )


def _row(group_id: str, place: Place, written: str, spoken: str | None, key: str, created_at=None):
    from ..database.models import DictionaryEntry

    return DictionaryEntry(
        scope=place.scope,
        scope_id=place.scope_id or "",
        app_name=place.app_name,
        written=written,
        spoken=spoken,
        key=key,
        group_id=group_id,
        created_at=created_at or datetime.utcnow(),
    )


def list_groups(db) -> list[Group]:
    """Every entry, newest first."""
    from ..database.models import DictionaryEntry

    grouped: dict[str, list] = {}
    for row in db.query(DictionaryEntry).order_by(DictionaryEntry.created_at).all():
        grouped.setdefault(row.group_id or row.id, []).append(row)
    groups = [_group(rows) for rows in grouped.values()]
    groups.sort(key=lambda g: g.created_at or datetime.min, reverse=True)
    return groups


def add_group(db, written: str, spoken: str | None, places) -> Group:
    import uuid

    written, spoken, places = _clean(written, "What to write"), _clean_spoken(spoken), _places(places)
    if len(list_groups(db)) >= MAX_ENTRIES:
        raise ValueError(f"Dictionaries can hold at most {MAX_ENTRIES} entries")
    key = _key(written, spoken)
    for place in places:
        _check_unique(db, place, key)
    group_id, now = str(uuid.uuid4()), datetime.utcnow()
    for place in places:
        db.add(_row(group_id, place, written, spoken, key, now))
    db.commit()
    invalidate()
    return _group(_rows(db, group_id))


def update_group(db, group_id: str, patch: dict) -> Group | None:
    """Change an entry's words everywhere it applies, and where it applies."""
    rows = _rows(db, group_id)
    if not rows:
        return None
    current = _group(rows)
    written = _clean(patch["written"], "What to write") if patch.get("written") is not None else current.written
    spoken = _clean_spoken(patch["spoken"]) if "spoken" in patch else current.spoken
    places = _places(patch["places"]) if patch.get("places") is not None else list(current.places)
    key = _key(written, spoken)
    for place in places:
        _check_unique(db, place, key, group_id)
    wanted = {(p.scope, p.scope_id or ""): p for p in places}
    for row in rows:
        place = wanted.pop((row.scope, row.scope_id or ""), None)
        if place is None:
            db.delete(row)
            continue
        row.written, row.spoken, row.key, row.group_id = written, spoken, key, group_id
        row.app_name = place.app_name or row.app_name
    for place in wanted.values():
        db.add(_row(group_id, place, written, spoken, key, current.created_at))
    db.commit()
    invalidate()
    return _group(_rows(db, group_id))


def delete_group(db, group_id: str) -> bool:
    rows = _rows(db, group_id)
    if not rows:
        return False
    for row in rows:
        db.delete(row)
    db.commit()
    invalidate()
    return True


def list_entries(db) -> list[Entry]:
    """Every row, one per place, newest first."""
    from ..database.models import DictionaryEntry

    rows = db.query(DictionaryEntry).order_by(DictionaryEntry.created_at.desc()).all()
    return [_entry(row) for row in rows]


def move_style(db, style_id: str, to_style_id: str) -> None:
    """A deleted style's entries join ``to_style_id``'s; one it already has is dropped."""
    from ..database.models import DictionaryEntry

    rows = db.query(DictionaryEntry).filter(DictionaryEntry.scope == "style", DictionaryEntry.scope_id == style_id)
    taken = {
        key
        for (key,) in db.query(DictionaryEntry.key).filter(
            DictionaryEntry.scope == "style", DictionaryEntry.scope_id == to_style_id
        )
    }
    for row in rows.all():
        if row.key in taken:
            db.delete(row)
        else:
            row.scope_id = to_style_id
            taken.add(row.key)
    db.commit()
    invalidate()
