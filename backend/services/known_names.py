"""Words the user writes capitalized in the middle of a sentence: their names.

Dictation that continues a sentence lowercases a common first word
(phrase_seams.continue_phrase). A word that is common in general can still be
a name to this user ("Slack", "Mark"), and their own text shows it: recent
cleaned dictations and the corrections they typed. Names from dictations that
history retention deleted are kept in ``KnownName`` and still count while
they are that recent.
"""

import threading
import time

from .phrase_seams import mid_sentence_capitals

# Enough history to cover the names in regular use, read in a few ms.
_RECENT = 500
_TTL_SECONDS = 300

_lock = threading.Lock()
_cache: tuple[float, frozenset[str]] | None = None


def known_names() -> frozenset[str]:
    """The user's names, from recent captures and corrections. Blocking."""
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < _TTL_SECONDS:
            return _cache[1]
    texts, kept = _recent()
    names = frozenset(mid_sentence_capitals("\n".join(texts)) | kept)
    with _lock:
        _cache = (time.monotonic(), names)
    return names


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = None


def _recent() -> tuple[list[str], set[str]]:
    """Recent texts, and the kept names of deleted dictations that were as recent."""
    from ..database import session as database_session
    from ..database.models import Capture, CaptureFeedback, KnownName

    if database_session.SessionLocal is None:
        return [], set()
    with database_session.SessionLocal() as db:
        refined = (
            db.query(Capture.transcript_refined, Capture.created_at)
            .filter(Capture.transcript_refined.isnot(None))
            # A command's output may be a translation, not the user's writing.
            .filter(Capture.source != "command")
            .order_by(Capture.created_at.desc())
            .limit(_RECENT)
            .all()
        )
        corrected = (
            db.query(CaptureFeedback.expected_text)
            # A redictation's text is already a capture of its own above.
            .filter(CaptureFeedback.teaches_style())
            .order_by(CaptureFeedback.created_at.desc())
            .limit(_RECENT)
            .all()
        )
        kept = db.query(KnownName.name)
        # A full page of dictations newer than a deleted one pushes its names out.
        if len(refined) == _RECENT and refined[-1][1] is not None:
            kept = kept.filter(KnownName.last_seen_at >= refined[-1][1])
        names = {name for (name,) in kept}
    return [text for (text, *_) in [*refined, *corrected] if text], names
