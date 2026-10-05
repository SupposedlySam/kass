"""Session WebSocket transport for streaming dictation."""

import asyncio
import contextlib
import json
import logging
import time
from collections import OrderedDict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from ..database import session as database_session
from ..services.capture_stream import StreamingCapture
from ..services.captures import target_app, target_app_category
from ..services.commands import MAX_SELECTION_CHARS
from ..services.prosody import measure_and_save
from ..services.refinement import load_cleanup_model, prefill_cleanup
from ..services.settings import get_capture_settings
from ..utils.origins import is_allowed_websocket_origin

router = APIRouter()
logger = logging.getLogger(__name__)
_active_sessions: set[str] = set()
MAX_SESSIONS = 2
IDLE_TIMEOUT = 30
MAX_COMMAND_CHARS = 4096
# A command session's selection message carries up to MAX_SELECTION_CHARS of
# text, some of it escaped.
MAX_SELECTION_MESSAGE_CHARS = 2 * MAX_SELECTION_CHARS + MAX_COMMAND_CHARS
_results: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_running: set[str] = set()
# Cleanup models loading ahead of a dictation's first phrase.
_loading: set[asyncio.Task] = set()


@router.get("/captures/stream/{session_id}/result")
async def streaming_result(session_id: str):
    now = time.monotonic()
    for key, (created, _) in list(_results.items()):
        if now - created > 600:
            del _results[key]
    if session_id in _results:
        return _results[session_id][1]
    if session_id in _running:
        return JSONResponse(status_code=202, content={"type": "pending"})
    raise HTTPException(status_code=404, detail="Streaming result unavailable; inspect Captures before retrying")


async def _load_cleanup(session: StreamingCapture) -> None:
    """Have the cleanup model resident before the first phrase needs it."""
    try:
        await load_cleanup_model(session.flags, session.settings.llm_model)
    except Exception:
        # The cleanup loads it anyway, just later.
        logger.warning("Could not load the cleanup model ahead of time", exc_info=True)


async def _prefill_style(session: StreamingCapture) -> None:
    """Cache the prompt of the session's style while the user speaks (docs/plans/PER_APP_STYLE.md)."""
    started = time.monotonic()
    try:
        await prefill_cleanup(session.flags, session.settings.llm_model)
        logger.info("Prefilled the %s style in %.3fs", session.style.name, time.monotonic() - started)
    except Exception:
        # Only a head start: the first cleanup prefills it anyway.
        logger.warning("Could not prefill the cleanup prompt", exc_info=True)


async def _cancelled_while_finishing(websocket: WebSocket, worker: asyncio.Task) -> bool:
    """Wait for the last recognition and cleanup, listening for a cancel.

    Only an explicit cancel (the user pressed Escape) abandons a finished
    session. A dropped connection still commits it, for result recovery.
    """
    while not worker.done():
        receiver = asyncio.create_task(websocket.receive())
        try:
            await asyncio.wait({receiver, worker}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            if not receiver.done():
                receiver.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await receiver
        if receiver.cancelled() or receiver.exception() is not None:
            break
        message = receiver.result()
        if message["type"] == "websocket.disconnect":
            break
        with contextlib.suppress(ValueError, TypeError, AttributeError):
            if json.loads(message.get("text") or "{}").get("type") == "cancel":
                return True
    await asyncio.shield(worker)
    return False


def _start(coroutine) -> None:
    task = asyncio.create_task(coroutine)
    _loading.add(task)
    task.add_done_callback(_loading.discard)


@router.websocket("/captures/stream")
async def stream_capture(websocket: WebSocket):
    if not is_allowed_websocket_origin(websocket) or len(_active_sessions) >= MAX_SESSIONS:
        await websocket.close(code=1008)
        return
    token = str(id(websocket))
    _active_sessions.add(token)
    session = None
    worker = None
    receiver = None
    foreground = False
    try:
        await websocket.accept()
        text = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        if len(text) > 4096:
            raise ValueError("Start message too large")
        start = json.loads(text)
        if not isinstance(start, dict):
            raise ValueError("Expected a start object")
        with database_session.SessionLocal() as db:
            settings = get_capture_settings(db)
        session = StreamingCapture(start, settings, websocket.send_json)
        _running.add(session.id)
        from ..services.model_improvement.manager import begin_foreground

        foreground = True
        await asyncio.to_thread(begin_foreground)
        await websocket.send_json(
            dict(
                type="ready",
                session_id=session.id,
                auto_refine=settings.auto_refine,
                allow_auto_paste=settings.allow_auto_paste,
            )
        )
        worker = asyncio.create_task(session.run())
        # A command session prefills the same model when its selection arrives.
        cleans = settings.auto_refine and not session.is_command
        if cleans:
            _start(_load_cleanup(session))
        while True:
            receiver = asyncio.create_task(websocket.receive())
            done, _ = await asyncio.wait({receiver, worker}, timeout=IDLE_TIMEOUT, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                raise ValueError("Streaming session timed out waiting for audio")
            if worker in done:
                await asyncio.shield(worker)
                raise RuntimeError("Recognition ended before finish")
            message = receiver.result()
            receiver = None
            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect()
            if message.get("bytes") is not None:
                session.append(message["bytes"])
                continue
            text = message.get("text") or "{}"
            if len(text) > (MAX_SELECTION_MESSAGE_CHARS if session.is_command else MAX_COMMAND_CHARS):
                raise ValueError("Command too large")
            command = json.loads(text)
            if not isinstance(command, dict):
                raise ValueError("Expected a command object")
            if command.get("type") == "cancel":
                return
            if command.get("type") == "cue":
                # A sound the app played (the style cue), which the microphone may pick up.
                session.ignore_cue(command.get("start_samples"), command.get("end_samples"))
                continue
            if command.get("type") == "context":
                # The field's text before the caret, read just after key-down.
                session.set_context(command.get("before"))
                continue
            if command.get("type") == "last_take":
                # The text before the caret, which a voice edit may change.
                session.set_last_take(command.get("text"), command.get("capture_id"), command.get("own_chars"))
                continue
            if command.get("type") == "app":
                # The target app, from the focus snapshot at key-down.
                app = target_app(command.get("bundle_id"), command.get("name"))
                if session.set_app(*app, target_app_category(command.get("category"))) and cleans:
                    _start(_prefill_style(session))
                continue
            if command.get("type") == "selection":
                # A command session's selected text, read just after key-down.
                session.set_selection(command.get("text"))
                continue
            if command.get("type") != "finish":
                raise ValueError("Expected app, context, last_take, cue, selection, finish or cancel")
            if not session.samples:
                raise ValueError("Cannot finish empty audio")
            app = command.get("app")
            if isinstance(app, dict):
                session.set_app(
                    *target_app(app.get("bundle_id"), app.get("name")), target_app_category(app.get("category"))
                )

            async def send_finalizing(event):
                # Finish is a commit request. Complete and retain the result if
                # the connection drops while the last inference is running.
                with contextlib.suppress(Exception):
                    await websocket.send_json(event)

            session.send = send_finalizing
            session.finish()
            if await _cancelled_while_finishing(websocket, worker):
                # Escape after release: discard the take, save nothing.
                return
            with database_session.SessionLocal() as db:
                capture = session.persist(db)
            result = dict(
                type="final",
                session_id=session.id,
                revision=session.revision + 1,
                covered_samples=session.samples,
                capture=capture.model_dump(mode="json"),
                refinement_complete=True,
                refinement_error=session.refinement_error,
                degraded_reason=session.degraded_reason,
            )
            if (edit := session.edit_result()) is not None:
                # A voice edit: the app changes its last take instead of pasting.
                result["edit"] = edit
            logger.info("Dictation stream finished: %s", session.timing_summary())
            _results[session.id] = (time.monotonic(), result)
            while len(_results) > 32:
                _results.popitem(last=False)
            await send_finalizing(result)
            if "edit" in result:
                _start(asyncio.to_thread(session.learn_from_edit))
            elif not session.is_command:
                # How it was said, measured once the text is out.
                _start(measure_and_save(session.id, session.expression))
            return
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning(
            "Streaming capture failed: %s (%s)", error, session.timing_summary() if session else "before start"
        )
        error_event = dict(type="error", message=str(error), session_id=session.id if session else None)
        if session and session.finished:
            _results[session.id] = (time.monotonic(), error_event)
            while len(_results) > 32:
                _results.popitem(last=False)
        with contextlib.suppress(Exception):
            await websocket.send_json(error_event)
    finally:
        if receiver:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver
        if session:
            # Native inference cannot safely be interrupted by cancelling its
            # awaiting coroutine: wait before releasing temporary audio files.
            session.abort = True
            session.finish()
            if worker:
                with contextlib.suppress(Exception):
                    await asyncio.shield(worker)
            session.close()
            _running.discard(session.id)
        if foreground:
            from ..services.model_improvement.manager import end_foreground

            end_foreground()
        _active_sessions.discard(token)
        with contextlib.suppress(Exception):
            await websocket.close()
