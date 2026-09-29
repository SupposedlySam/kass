"""User settings endpoints — capture/refine defaults."""

import asyncio
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import history_retention, settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/captures", response_model=models.CaptureSettingsResponse)
async def get_capture_settings_endpoint(db: Session = Depends(get_db)):
    return settings_service.get_capture_settings(db)


@router.put("/captures", response_model=models.CaptureSettingsResponse)
async def update_capture_settings_endpoint(
    patch: models.CaptureSettingsUpdate,
    db: Session = Depends(get_db),
):
    try:
        saved = settings_service.update_capture_settings(db, patch.model_dump(exclude_unset=True))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if patch.history_retention_days is not None:
        # A shorter window applies now, not at the next hourly sweep, so the
        # captures list the app reloads after saving is already trimmed.
        await asyncio.to_thread(history_retention.sweep)
    return saved


@router.get("/captures/retention-preview", response_model=models.RetentionPreviewResponse)
async def retention_preview_endpoint(days: int, db: Session = Depends(get_db)):
    """How many captures keeping ``days`` of history would delete now."""
    if days not in get_args(models.HistoryRetentionDays):
        raise HTTPException(status_code=422, detail="days must be one of the retention choices")
    return models.RetentionPreviewResponse(days=days, expiring=history_retention.count_expiring(db, days))
