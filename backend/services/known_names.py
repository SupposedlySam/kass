"""Words the user writes capitalized in the middle of a sentence: their names.

Dictation that continues a sentence lowercases a common first word
(phrase_seams.continue_phrase). A word that is common in general can still be
a name to this user ("Slack", "Mark"), and their own text shows it: recent
cleaned dictations and the corrections they typed.
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
    names = frozenset(mid_sentence_capitals("\n".join(_recent_texts())))
    with _lock:
        _cache = (time.monotonic(), names)
    return names


def _recent_texts() -> list[str]:
    from ..database import session as database_session
    from ..database.models import Capture, CaptureFeedback

    if database_session.SessionLocal is None:
        return []
    with database_session.SessionLocal() as db:
        refined = (
            db.query(Capture.transcript_refined)
            .filter(Capture.transcript_refined.isnot(None))
            .order_by(Capture.created_at.desc())
            .limit(_RECENT)
            .all()
        )
        corrected = (
            db.query(CaptureFeedback.expected_text).order_by(CaptureFeedback.created_at.desc()).limit(_RECENT).all()
        )
    return [text for (text,) in [*refined, *corrected] if text]
