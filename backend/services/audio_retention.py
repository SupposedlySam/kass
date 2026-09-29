"""Recording retention: keep a capture's text without its audio.

With ``CaptureSettings.discard_audio`` on, a recording is deleted as soon as
its transcript is saved, and history retention keeps no audio for
corrections. It applies to recordings made after it is turned on; existing
captures keep their audio until history retention deletes them.
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def discards_now(settings) -> bool:
    """Whether a new recording is deleted as soon as its transcript is saved."""
    return bool(settings.discard_audio)


def discard(path: Path | None) -> None:
    """Delete a recording that was only needed to produce its transcript."""
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.exception("Could not delete the recording %s", path)
