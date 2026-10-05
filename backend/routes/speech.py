"""Read Aloud endpoints (docs/plans/READ_ALOUD.md)."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import settings as settings_service, speech
from ..services.speakable import speakable

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/speech/voices", response_model=models.SpeechVoicesResponse)
async def speech_voices_endpoint():
    """The voices Read Aloud can speak in, for its settings."""
    return models.SpeechVoicesResponse(
        voices=[
            models.SpeechVoice(
                id=voice,
                name=name,
                accent="american" if voice[0] == "a" else "british",
                gender="female" if voice[1] == "f" else "male",
            )
            for voice, name in speech.VOICES.items()
        ],
        default=speech.DEFAULT_VOICE,
    )


@router.post("/speech/sentences", response_model=models.SpeechSentencesResponse)
async def speech_sentences_endpoint(request: models.SpeechRequest, db: Session = Depends(get_db)):
    """The pieces a selection is read in, so the app can fetch the next while one plays.

    With Read naturally on, they're the selection as it would be said aloud.
    """
    try:
        text = speech.validate_text(request.text)
        speech.ensure_model_ready()
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if settings_service.get_capture_settings(db).speak_naturally:
        text = speakable(text)
    return models.SpeechSentencesResponse(sentences=speech.split_sentences(text))


@router.post("/speech", response_class=Response)
async def speech_endpoint(request: models.SpeechRequest, db: Session = Depends(get_db)):
    """One piece of a reading, as WAV, in the saved voice and speed unless the request names them."""
    saved = settings_service.get_capture_settings(db)
    try:
        audio = await speech.speak(
            request.text,
            voice=request.voice or saved.speak_voice,
            speed=request.speed or saved.speak_speed,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        logger.exception("Read Aloud failed")
        raise HTTPException(status_code=500, detail=str(error)) from error
    return Response(content=audio, media_type="audio/wav")
