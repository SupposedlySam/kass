"""Local correction records for evaluation and future training datasets."""

import json
import logging

from sqlalchemy.orm import Session

from .. import beta
from ..database.models import CaptureFeedback
from ..models import CaptureFeedbackCreate, CaptureFeedbackResponse
from . import correction_learning, known_names, personal_examples, writing_style
from .captures import get_capture
from .spelling import join_spelling

logger = logging.getLogger(__name__)


def to_response(row: CaptureFeedback) -> CaptureFeedbackResponse:
    return CaptureFeedbackResponse(
        id=row.id,
        capture_id=row.capture_id,
        target=row.target,
        expected_text=row.expected_text,
        notes=row.notes,
        snapshot=json.loads(row.snapshot),
        source=row.source,
        created_at=row.created_at,
    )


def save_feedback(capture_id: str, request: CaptureFeedbackCreate, db: Session):
    if request.source != "manual" and not beta.enabled("voice_edits"):
        raise ValueError("Voice fixes are a beta feature.")
    capture = get_capture(capture_id, db)
    if capture is None:
        return None
    if capture != request.snapshot:
        raise ValueError("Capture changed. Refresh it before reporting a correction.")
    original = capture.transcript_raw if request.target == "raw" else capture.transcript_refined
    if original is None:
        raise ValueError("This capture has no refined output to report.")
    expected = request.expected_text
    # Spoken fixes come from speech: letters the user spelled ("M-E-G-H-A-N")
    # are one word, as they would have typed it.
    if request.source != "manual":
        expected = join_spelling(expected)
    if expected == original:
        raise ValueError("Expected output must differ from the model output.")
    row = CaptureFeedback(
        capture_id=capture_id,
        target=request.target,
        expected_text=expected,
        notes=request.notes.strip(),
        snapshot=capture.model_dump_json(),
        source=request.source,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _reports_changed(row.target, row.source, db)
    return to_response(row)


def withdraw_feedback(capture_id: str, report_id: str, db: Session) -> bool:
    """Delete one report and everything it taught.

    Examples, habits and names are read from the reports, so they drop it at
    once. Rules and the cleanup adapter are relearned without it at the next
    idle moment (correction_learning.request_run). Part of the voice_edits beta:
    without it, returns False as if there were no such report.
    """
    if not beta.enabled("voice_edits"):
        return False
    row = db.get(CaptureFeedback, report_id)
    if row is None or row.capture_id != capture_id:
        return False
    target, source = row.target, row.source
    db.delete(row)
    db.commit()
    _reports_changed(target, source, db, withdrawn=True)
    return True


def _reports_changed(target: str, source: str, db: Session, withdrawn: bool = False) -> None:
    # A withdrawn report may be in the cleanup adapter's training data too.
    correction_learning.request_run(retrain=withdrawn)
    if source not in CaptureFeedback.EXPLICIT_SOURCES:
        return
    if beta.enabled("voice_edits"):
        known_names.invalidate()
    if target != "refined":
        return
    personal_examples.invalidate()
    try:
        writing_style.refresh_feedback(db)
    except Exception:
        logger.warning("Could not update the writing style from a correction", exc_info=True)


def list_feedback(db: Session, capture_id: str | None = None):
    query = db.query(CaptureFeedback)
    if capture_id is not None:
        query = query.filter(CaptureFeedback.capture_id == capture_id)
    return [to_response(row) for row in query.order_by(CaptureFeedback.created_at.desc(), CaptureFeedback.id).all()]
