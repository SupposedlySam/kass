"""Teaching a writing style, the learned punctuation profile, and the user's examples.

Everything here is per writing style: ``style`` is a style id, and the
default style when left out (docs/plans/PER_APP_STYLE.md).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..database import Capture, get_db
from ..services import (
    correction_notes,
    dictionary,
    personal_examples,
    settings as settings_service,
    styles,
    teach,
    writing_style,
)
from ..services.content_check import check_refinement
from ..services.refinement import refine_transcript, style_first_word

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/writing-style", tags=["writing-style"])
# A preview needs something to restructure; shorter dictations rarely have it.
PREVIEW_MIN_WORDS = 12
PREVIEW_CANDIDATES = 50


def _style(style: str | None) -> str:
    """A known style's id; 404 for one that doesn't exist."""
    found = styles.snapshot().get(style) if style else styles.snapshot().default
    if found is None:
        raise HTTPException(status_code=404, detail="Style not found")
    return found.id


async def _clean(db: Session, said: str, style: str, extra=None, use_examples=True) -> str:
    """Clean ``said`` up the way dictation in ``style`` would.

    Falls back to what was said when the refinement model is unavailable.
    """
    saved = settings_service.get_capture_settings(db)
    flags = styles.flags_for(styles.snapshot().resolve(style), saved)
    try:
        refined, _ = await refine_transcript(
            said, flags, model_size=saved.llm_model, use_personal_examples=use_examples, extra_examples=extra
        )
    except Exception:
        logger.warning("Preview cleanup failed; showing what was said", exc_info=True)
        return said
    refined, _ = check_refinement(said, refined, flags)
    return style_first_word(refined, flags)


@router.get("", response_model=models.WritingStyleStatus)
async def get_writing_style(style: str | None = None):
    return writing_style.status(_style(style))


@router.delete("", response_model=models.WritingStyleStatus)
async def reset_writing_style(style: str | None = None):
    """Forget the style's taught replies, habits and rules; other styles keep theirs."""
    style = _style(style)
    writing_style.reset(style)
    teach.forget_style(style)
    correction_notes.forget_style(style)
    return writing_style.status(style)


@router.get("/examples", response_model=list[models.PersonalExample])
async def list_examples(style: str | None = None):
    return personal_examples.all_examples(_style(style))


@router.delete("/examples/{example_id}", status_code=204)
async def remove_example(example_id: str):
    """Stop using an example; corrections stay recorded for the personal model."""
    if not personal_examples.hide(example_id):
        raise HTTPException(status_code=404, detail="Example not found")


@router.get("/notes", response_model=models.CorrectionNotesStatus)
async def get_correction_notes(style: str | None = None):
    return correction_notes.status(_style(style))


@router.delete("/notes/{note_id}", status_code=204)
async def remove_correction_note(note_id: str, style: str | None = None):
    if not correction_notes.remove(note_id, _style(style)):
        raise HTTPException(status_code=404, detail="Rule not found")


# --- Teaching (docs/plans/TEACH_BY_REPLYING.md) ----------------------------------


def _session(session_id: str) -> teach.Session:
    try:
        return teach.get(session_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="This teaching session expired. Start it again.") from error


def _conversation(session_id: str, conversation_id: str) -> teach.Conversation:
    try:
        return teach.conversation(_session(session_id), conversation_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Conversation not found") from error


@router.post("/teach", response_model=models.TeachSession)
async def start_teaching(style: str | None = None, db: Session = Depends(get_db)):
    style = _style(style)
    own = teach.kinds_for_apps(teach.style_apps(db, style))
    terms = list(dictionary.for_app(None, style).terms)
    return teach.as_dict(teach.start(style, own, terms))


@router.post("/teach/{session_id}/conversations", response_model=models.TeachSession)
async def add_conversation(session_id: str, request: models.TeachConversationCreate):
    _session(session_id)
    try:
        return teach.as_dict(teach.add_conversation(session_id, request.kind))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/teach/{session_id}/conversations/{conversation_id}/new-theme", response_model=models.TeachSession)
async def new_theme(session_id: str, conversation_id: str):
    _conversation(session_id, conversation_id)
    return teach.as_dict(teach.new_theme(session_id, conversation_id))


@router.post("/teach/{session_id}/conversations/{conversation_id}/wrap-up", response_model=models.TeachSession)
async def wrap_up(session_id: str, conversation_id: str):
    _conversation(session_id, conversation_id)
    return teach.as_dict(teach.wrap_up(session_id, conversation_id))


@router.get("/teach/{session_id}/conversations/{conversation_id}/dictated", response_model=models.TeachDictated)
async def dictated(session_id: str, conversation_id: str, db: Session = Depends(get_db)):
    """The cleanup of what was dictated in Voicebox's window this turn, for the reply box."""
    _conversation(session_id, conversation_id)
    found = teach.dictated_for(db, session_id, conversation_id)
    return {"text": found.shown if found else None}


@router.post("/teach/{session_id}/conversations/{conversation_id}/restart-turn", status_code=204)
async def restart_turn(session_id: str, conversation_id: str):
    """The user cleared the reply box or opened this conversation: earlier dictation
    is no longer part of its reply."""
    _conversation(session_id, conversation_id)
    teach.start_turn_now(session_id, conversation_id)


@router.post("/teach/{session_id}/conversations/{conversation_id}/replies", response_model=models.TeachSession)
async def send_reply(
    session_id: str, conversation_id: str, request: models.TeachReplyRequest, db: Session = Depends(get_db)
):
    _conversation(session_id, conversation_id)
    try:
        teach.record_reply(
            session_id, conversation_id, request.written, teach.dictated_for(db, session_id, conversation_id)
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    saved = settings_service.get_capture_settings(db)
    return teach.as_dict(await teach.next_turn(session_id, conversation_id, saved.llm_model))


@router.post("/teach/{session_id}/finish", response_model=models.TeachFinishResult)
async def finish_teaching(session_id: str, db: Session = Depends(get_db)):
    _session(session_id)
    try:
        session, examples = teach.finish(session_id)
        status = writing_style.save_run(session.style, examples)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    spoken = [e["said"] for e in examples if e["said"]]
    before, after = await _preview(db, session.style, max(spoken, key=len) if spoken else None)
    return {
        "status": status,
        "before": before,
        "after": after,
        "replies": len(examples),
        "dictated": len(spoken),
    }


async def _preview(db: Session, style: str, fallback: str | None) -> tuple[str | None, str | None]:
    """One of the user's own dictations in ``style``, cleaned up before and after this run.

    Uses the newest dictation in one of the style's apps long enough to have
    something to restructure. With none, the longest reply the user
    dictated this run is cleaned up without and with their examples.
    """
    snapshot = styles.snapshot()
    rows = (
        db.query(Capture.transcript_raw, Capture.transcript_refined, Capture.app_bundle_id)
        .filter(
            Capture.transcript_raw != "",
            Capture.source != "command",
            or_(Capture.app_bundle_id.is_(None), Capture.app_bundle_id != styles.VOICEBOX_BUNDLE),
        )
        .order_by(Capture.created_at.desc())
        .limit(PREVIEW_CANDIDATES)
        .all()
    )
    for raw, refined, app in rows:
        if len(raw.split()) >= PREVIEW_MIN_WORDS and snapshot.for_app(app).id == style:
            return refined or raw, await _clean(db, raw, style)
    if not fallback:
        return None, None
    return await _clean(db, fallback, style, use_examples=False), await _clean(db, fallback, style)


@router.delete("/teach/{session_id}", status_code=204)
async def discard_teaching(session_id: str):
    teach.discard(session_id)
