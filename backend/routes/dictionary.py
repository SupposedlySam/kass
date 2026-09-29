"""The user's dictionaries (docs/plans/DICTIONARIES.md)."""

import logging
import math
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import dictionary

router = APIRouter(prefix="/dictionary", tags=["dictionary"])
logger = logging.getLogger(__name__)


def _model(group: dictionary.Group) -> models.DictionaryEntryModel:
    return models.DictionaryEntryModel(**asdict(group))


def _places(places) -> list[dict] | None:
    return None if places is None else [place.model_dump() for place in places]


def _token_counter():
    """Whisper's token count for a term; an estimate when no model is loaded."""
    from ..services.transcribe import get_whisper_model

    try:
        whisper = get_whisper_model()
        if whisper.is_loaded():
            tokenizer = whisper.model.get_tokenizer(language="en")
            return lambda term: len(tokenizer.encode(" " + term))
    except Exception:
        logger.warning("Could not read Whisper's tokenizer; estimating term sizes", exc_info=True)
    return lambda term: max(1, math.ceil(len(term) / 3))


@router.get("", response_model=models.DictionaryResponse)
async def list_entries(db: Session = Depends(get_db)):
    return models.DictionaryResponse(entries=[_model(group) for group in dictionary.list_groups(db)])


@router.post("", response_model=models.DictionaryEntryModel)
async def add_entry(request: models.DictionaryEntryCreate, db: Session = Depends(get_db)):
    try:
        group = dictionary.add_group(db, request.written, request.spoken, _places(request.places))
    except dictionary.DuplicateEntryError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _model(group)


@router.get("/resolved", response_model=models.ResolvedDictionaryResponse)
async def resolved(bundle_id: str | None = None):
    resolved_entries = dictionary.resolved_for(bundle_id or None)
    fit, dropped = dictionary.fit_terms(dictionary.build(resolved_entries).terms, _token_counter())
    return models.ResolvedDictionaryResponse(
        entries=[
            models.ResolvedDictionaryEntry(
                **(asdict(entry) | {"id": entry.group_id or entry.id}), overridden=overridden
            )
            for entry, overridden in resolved_entries
        ],
        prompt_terms=fit,
        dropped_terms=dropped,
    )


@router.patch("/{entry_id}", response_model=models.DictionaryEntryModel)
async def update_entry(entry_id: str, request: models.DictionaryEntryUpdate, db: Session = Depends(get_db)):
    patch = request.model_dump(exclude_unset=True)
    if "places" in patch:
        patch["places"] = _places(request.places)
    try:
        group = dictionary.update_group(db, entry_id, patch)
    except dictionary.DuplicateEntryError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if group is None:
        raise HTTPException(status_code=404, detail="Dictionary entry not found")
    return _model(group)


@router.delete("/{entry_id}")
async def delete_entry(entry_id: str, db: Session = Depends(get_db)):
    if not dictionary.delete_group(db, entry_id):
        raise HTTPException(status_code=404, detail="Dictionary entry not found")
    return {"deleted": True}
