"""Named writing styles and the apps assigned to them (docs/plans/PER_APP_STYLE.md).

A style holds the settings that shape how dictation is written: punctuation,
whether the first word is capitalized, filler removal and technical terms.
Its calibration, habits, examples and rules are kept per style by
``writing_style``, ``personal_examples`` and ``correction_notes``. An app the
user hasn't assigned uses the default style.

Dictation reads styles on every take, so the rows are kept in memory as a
``Snapshot`` and reloaded only after a change.
"""

import threading
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..database.models import AppStyle, WritingStyle
from .refinement import PUNCTUATION_STYLES, RefinementFlags

MAX_NAME_CHARS = 40
MAX_STYLES = 12

# Existing global settings and learned data move into this style, which is
# the default (docs/plans/PER_APP_STYLE.md, Migration).
MIGRATED_STYLE = "work"

# (id, name, punctuation, capitalize first word, remove filler, keep technical terms)
PRESETS = (
    ("chat", "Chat", "casual", False, False, True),
    ("work", "Work", "standard", True, True, True),
    ("formal", "Formal", "standard", True, True, True),
    ("code", "Code", "casual", False, True, True),
)

SETTINGS = ("punctuation_style", "capitalize_first", "smart_cleanup", "preserve_technical")


@dataclass(frozen=True)
class Style:
    id: str
    name: str
    position: int
    is_default: bool
    punctuation_style: str
    capitalize_first: bool
    smart_cleanup: bool
    preserve_technical: bool


# Before the database exists (tests, tools), every app uses one Standard style.
_FALLBACK = Style(MIGRATED_STYLE, "Work", 0, True, "standard", True, True, True)


@dataclass(frozen=True)
class Snapshot:
    styles: tuple[Style, ...]
    # Bundle id -> style id, for the apps the user assigned.
    apps: dict[str, str] = field(default_factory=dict)
    app_names: dict[str, str] = field(default_factory=dict)

    @property
    def default(self) -> Style:
        return next((s for s in self.styles if s.is_default), self.styles[0])

    def get(self, style_id: str | None) -> Style | None:
        return next((s for s in self.styles if s.id == style_id), None)

    def for_app(self, bundle_id: str | None) -> Style:
        """The style ``bundle_id`` is assigned to, or the default."""
        return self.get(self.apps.get(bundle_id or "")) or self.default

    def resolve(self, style_id: str | None) -> Style:
        """``style_id``'s style, or the default for None or a deleted style."""
        return self.get(style_id) or self.default


_lock = threading.RLock()
_snapshot: Snapshot | None = None


def _style(row: WritingStyle) -> Style:
    return Style(
        id=row.id,
        name=row.name,
        position=row.position,
        is_default=row.is_default,
        punctuation_style=row.punctuation_style if row.punctuation_style in PUNCTUATION_STYLES else "standard",
        capitalize_first=row.capitalize_first,
        smart_cleanup=row.smart_cleanup,
        preserve_technical=row.preserve_technical,
    )


def load(db: Session) -> Snapshot:
    rows = [_style(row) for row in db.query(WritingStyle).order_by(WritingStyle.position, WritingStyle.created_at)]
    if not rows:
        return Snapshot((_FALLBACK,))
    assigned = db.query(AppStyle).all()
    return Snapshot(
        tuple(rows),
        {row.bundle_id: row.style_id for row in assigned},
        {row.bundle_id: row.app_name for row in assigned if row.app_name},
    )


def snapshot() -> Snapshot:
    """The styles and assignments, read from the database once per change."""
    global _snapshot
    with _lock:
        if _snapshot is None:
            from ..database import session as database_session

            if database_session.SessionLocal is None:
                return Snapshot((_FALLBACK,))
            with database_session.SessionLocal() as db:
                _snapshot = load(db)
        return _snapshot


def invalidate() -> None:
    global _snapshot
    with _lock:
        _snapshot = None


def _changed(examples: bool = False) -> None:
    """After a change: reload the snapshot, and regroup examples when apps moved."""
    invalidate()
    if examples:
        from . import personal_examples

        personal_examples.invalidate()


def default_id() -> str:
    return snapshot().default.id


def flags_for(style: Style, settings) -> RefinementFlags:
    """The refinement flags for dictation in ``style``; self-correction stays global."""
    return RefinementFlags(
        smart_cleanup=style.smart_cleanup,
        self_correction=settings.self_correction,
        preserve_technical=style.preserve_technical,
        punctuation_style=style.punctuation_style,
        capitalize_first=style.capitalize_first,
        style=style.id,
    )


def flags_for_app(bundle_id: str | None, settings) -> RefinementFlags:
    return flags_for(snapshot().for_app(bundle_id), settings)


# --- Setup -----------------------------------------------------------------------


def ensure_styles(db: Session) -> None:
    """Create the preset styles on first run, moving the global settings into Work.

    Also repairs a database left without exactly one default. Idempotent.
    """
    rows = db.query(WritingStyle).order_by(WritingStyle.position).all()
    if not rows:
        from ..database.models import CaptureSettings

        saved = db.query(CaptureSettings).first()
        for position, (style_id, name, punctuation, capitalize, filler, technical) in enumerate(PRESETS):
            if style_id == MIGRATED_STYLE and saved is not None:
                # Dictation keeps working exactly as it did before styles.
                punctuation = saved.punctuation_style or "standard"
                capitalize, filler, technical = True, saved.smart_cleanup, saved.preserve_technical
            db.add(
                WritingStyle(
                    id=style_id,
                    name=name,
                    position=position,
                    is_default=style_id == MIGRATED_STYLE,
                    punctuation_style=punctuation,
                    capitalize_first=capitalize,
                    smart_cleanup=filler,
                    preserve_technical=technical,
                )
            )
        db.commit()
    elif sum(row.is_default for row in rows) != 1:
        keep = next((row for row in rows if row.is_default), rows[0])
        for row in rows:
            row.is_default = row is keep
        db.commit()
    invalidate()


# --- Changes ----------------------------------------------------------------------


def _clean_name(db: Session, name: object, exclude: str | None = None) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Give the style a name")
    cleaned = " ".join(name.split())[:MAX_NAME_CHARS]
    taken = db.query(WritingStyle).filter(WritingStyle.id != (exclude or "")).all()
    if any(row.name.casefold() == cleaned.casefold() for row in taken):
        raise ValueError(f"There's already a style called {cleaned}")
    return cleaned


def create_style(db: Session, name: str) -> Style:
    """A new style, starting from the default's settings with nothing learned."""
    if db.query(WritingStyle).count() >= MAX_STYLES:
        raise ValueError(f"Voicebox keeps at most {MAX_STYLES} styles")
    base = snapshot().default
    last = db.query(WritingStyle).order_by(WritingStyle.position.desc()).first()
    row = WritingStyle(
        name=_clean_name(db, name),
        position=(last.position + 1) if last else 0,
        is_default=False,
        **{setting: getattr(base, setting) for setting in SETTINGS},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _changed()
    return _style(row)


def update_style(db: Session, style_id: str, patch: dict) -> Style | None:
    """Rename a style, change its settings, or make it the default."""
    row = db.get(WritingStyle, style_id)
    if row is None:
        return None
    if patch.get("name") is not None:
        row.name = _clean_name(db, patch["name"], exclude=style_id)
    if patch.get("punctuation_style") is not None:
        if patch["punctuation_style"] not in PUNCTUATION_STYLES:
            raise ValueError("Unknown punctuation style")
        row.punctuation_style = patch["punctuation_style"]
    for setting in ("capitalize_first", "smart_cleanup", "preserve_technical"):
        if patch.get(setting) is not None:
            setattr(row, setting, bool(patch[setting]))
    if patch.get("is_default"):
        db.query(WritingStyle).filter(WritingStyle.id != style_id).update({"is_default": False})
        row.is_default = True
    db.commit()
    db.refresh(row)
    # Unassigned apps follow the default, and their corrections with them.
    _changed(examples=bool(patch.get("is_default")))
    return _style(row)


def delete_style(db: Session, style_id: str) -> bool:
    """Delete a style and what it learned; its apps move to the default."""
    row = db.get(WritingStyle, style_id)
    if row is None:
        return False
    if row.is_default:
        raise ValueError("Make another style the default before deleting this one")
    db.query(AppStyle).filter(AppStyle.style_id == style_id).delete()
    db.delete(row)
    db.commit()
    _changed(examples=True)
    from . import correction_notes, writing_style

    writing_style.forget_style(style_id)
    correction_notes.forget_style(style_id)
    _refresh_habits(db)
    return True


def assign_app(db: Session, bundle_id: str, app_name: str | None, style_id: str) -> None:
    """Put ``bundle_id`` in ``style_id``; this also confirms a new app's style.

    The app's corrections now teach that style, so the learned habits are
    recounted.
    """
    if db.get(WritingStyle, style_id) is None:
        raise KeyError(style_id)
    row = db.get(AppStyle, bundle_id)
    if row is None:
        db.add(AppStyle(bundle_id=bundle_id, app_name=app_name, style_id=style_id))
    else:
        row.style_id = style_id
        row.app_name = app_name or row.app_name
    db.commit()
    _changed(examples=True)
    _refresh_habits(db)


def _refresh_habits(db: Session) -> None:
    from . import writing_style

    writing_style.refresh_feedback(db)
