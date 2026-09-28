"""Command Mode endpoints (docs/plans/COMMAND_MODE.md)."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import Capture as DBCapture, get_db
from ..services import commands, settings as settings_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/commands/run", response_model=models.CaptureResponse)
async def run_command_endpoint(request: models.CommandRunRequest, db: Session = Depends(get_db)):
    """Rewrite a selection by an instruction or a transform's name, and save it as a command capture.

    With ``capture_id``, the instruction is that capture's transcript: a
    command recording that went through the batch upload.
    """
    settings = settings_service.get_capture_settings(db)
    row = None
    spoken = request.instruction or ""
    if request.capture_id:
        row = db.query(DBCapture).filter(DBCapture.id == request.capture_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Capture not found")
        spoken = row.transcript_raw or ""
    try:
        return await commands.run_command(
            db,
            selection=request.selection,
            spoken=spoken,
            settings=settings,
            row=row,
            app_bundle_id=request.app_bundle_id,
            app_name=request.app_name,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("Command failed")
        raise HTTPException(status_code=500, detail=str(error)) from error
