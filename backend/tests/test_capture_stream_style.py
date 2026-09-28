"""Streaming dictation cleans up in the style of the app it goes to (docs/plans/PER_APP_STYLE.md)."""

import asyncio
import struct
from unittest.mock import AsyncMock

import numpy as np
import pytest
from sqlalchemy.orm import Session, sessionmaker

from backend.database.models import Capture, WritingStyle
from backend.models import CaptureSettingsResponse
from backend.services import capture_stream, styles
from backend.tests.test_capture_stream import append, make_session, socket_app

SLACK = "com.tinyspeck.slackmacgap"


def seeded(engine):
    """Personal, and a Chat style for Slack that writes casually in lowercase."""
    with Session(engine) as db:
        styles.ensure_styles(db)
        chat = styles.create_style(db, "Chat")
        db.query(WritingStyle).filter(WritingStyle.id == chat.id).update(
            {"id": "chat", "punctuation_style": "casual", "capitalize_first": False}
        )
        db.commit()
        styles.invalidate()
        styles.assign_app(db, SLACK, "Slack", "chat")


@pytest.fixture
def database(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool

    from backend.database import session as database_session
    from backend.database.models import Base

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(database_session, "SessionLocal", sessionmaker(bind=engine))
    seeded(engine)
    return engine


async def dictate(tmp_path, monkeypatch, app, cleaned, set_app_late=False):
    session, _ = make_session(tmp_path, monkeypatch)
    session.settings.auto_refine = True
    refine = AsyncMock(return_value=(cleaned, "0.6B"))
    monkeypatch.setattr(capture_stream, "refine_transcript", refine)
    monkeypatch.setattr(capture_stream, "known_names", lambda: frozenset())
    from backend.services import correction_learning

    monkeypatch.setattr(correction_learning, "apply_learned_corrections", lambda text, _: text)
    session.recognize = AsyncMock(return_value="so I looked at the build")
    if not set_app_late:
        session.set_app(app, "Slack")
    worker = asyncio.create_task(session.run())
    append(session, 1)
    session.finish()
    await worker
    session.close()
    return session, refine


@pytest.mark.asyncio
async def test_the_app_at_key_down_picks_the_style_for_the_first_cleanup(tmp_path, monkeypatch, database):
    session, refine = await dictate(tmp_path, monkeypatch, SLACK, "So I looked at the build.")
    flags = refine.await_args.args[1]
    assert (flags.style, flags.punctuation_style, flags.capitalize_first) == ("chat", "casual", False)
    # Chat doesn't capitalize the first word.
    assert session.refined == "so I looked at the build."
    with Session(database) as db:
        row = session.persist(db)
    assert row.style_id == "chat"
    assert row.refinement_flags.style == "chat"


@pytest.mark.asyncio
async def test_an_unassigned_app_uses_the_default_style(tmp_path, monkeypatch, database):
    session, refine = await dictate(tmp_path, monkeypatch, "net.whatsapp.WhatsApp", "So I looked at the build.")
    assert refine.await_args.args[1].style == "personal"
    assert session.refined == "So I looked at the build."


def test_the_style_never_changes_once_cleanup_started(tmp_path, monkeypatch, database):
    session, _ = make_session(tmp_path, monkeypatch)
    assert session.set_app(SLACK, "Slack")
    assert session.style.id == "chat"
    session.cleanup_started = True
    assert not session.set_app("com.apple.mail", "Mail")
    assert session.style.id == "chat"
    # The capture still records where the text went.
    assert session.app_bundle_id == "com.apple.mail"
    session.close()


def test_the_app_message_prefills_its_style(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.routes import capture_stream as route

    app, engine = socket_app(tmp_path, monkeypatch)
    seeded(engine)
    monkeypatch.setattr(route, "get_capture_settings", lambda _: CaptureSettingsResponse(auto_refine=True))
    monkeypatch.setattr(route, "load_cleanup_model", AsyncMock())
    prefill = AsyncMock()
    monkeypatch.setattr(route, "prefill_cleanup", prefill)
    monkeypatch.setattr(capture_stream, "refine_transcript", AsyncMock(return_value=("Finished text.", "0.6B")))
    with TestClient(app) as client, client.websocket_connect("/captures/stream") as socket:
        socket.send_json(dict(type="start", protocol_version=1, sample_rate=16000, channels=1, encoding="pcm_s16le"))
        socket.receive_json()
        socket.send_json(dict(type="app", bundle_id=SLACK, name="Slack", category="public.app-category.business"))
        socket.send_bytes(struct.pack("<II", 0, 0) + np.ones(1600, dtype="<i2").tobytes())
        socket.send_json(dict(type="finish"))
        while (event := socket.receive_json())["type"] != "final":
            pass
    assert prefill.await_args.args[0].style == "chat"
    assert event["capture"]["style_id"] == "chat"
    assert event["capture"]["app_bundle_id"] == SLACK
    with Session(engine) as db:
        row = db.query(Capture).one()
        assert row.style_id == "chat"
        # Saved to suggest a style for the next new app of its category.
        assert row.app_category == "public.app-category.business"
