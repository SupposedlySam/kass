"""Asking for a style by name at the start of a dictation writes it in that style."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.orm import Session

from backend.database.models import Capture, WritingStyle
from backend.services import capture_stream, styles
from backend.tests.test_capture_stream import append, make_session
from backend.tests.test_capture_stream_style import SLACK, database  # noqa: F401 — fixture

STYLES = styles.Snapshot(
    (
        styles.Style("personal", "Personal", 0, True, "standard", True),
        styles.Style("formal", "Formal", 1, False, "standard", True),
        styles.Style("work-email", "Work Email", 2, False, "standard", True),
        styles.Style("work", "Work", 3, False, "standard", True),
        styles.Style("chat", "Chat mode", 4, False, "casual", True),
        styles.Style("casual", "Casual", 5, False, "casual", True),
    )
)


@pytest.mark.parametrize(
    ("said", "style", "rest"),
    [
        ("Use formal mode. Dear team, the build is green.", "formal", "Dear team, the build is green."),
        ("use formal mode, dear team", "formal", "Dear team"),
        ("Use Formal Mode: Dear team", "formal", "Dear team"),
        ("Use formal-mode. iPhone sales are up.", "formal", "iPhone sales are up."),
        ("Use the formal style. Hello.", "formal", "Hello."),
        ("Use formal mode.", "formal", ""),
        ("Use work email mode. Hi Sam.", "work-email", "Hi Sam."),
        ("Use work mode. Hi Sam.", "work", "Hi Sam."),
        # A name ending in "mode" isn't said twice.
        ("Use chat mode. lol", "chat", "Lol"),
        # Other ways to ask, each standing alone before the text.
        ("Formal mode. Dear team.", "formal", "Dear team."),
        ("In formal mode: dear team.", "formal", "Dear team."),
        ("Switch to formal. Dear team.", "formal", "Dear team."),
        ("Change over to the work email style. Hi Sam.", "work-email", "Hi Sam."),
        ("Make this formal. Dear team.", "formal", "Dear team."),
        ("Make it more personal, hey mom.", "personal", "Hey mom."),
        ("Let's make this sound a bit more formal. Dear team.", "formal", "Dear team."),
        ("Write this more formally", None, None),
        ("I want this to be more personal. Hey mom.", "personal", "Hey mom."),
        ("I'd like this to sound more formal. Dear team.", "formal", "Dear team."),
        ("I would like it to be a little more casual.", "casual", ""),
        ("Okay, um, make this formal. Dear team.", "formal", "Dear team."),
        # Words for the same register pick the style named with another.
        ("Make this more professional. Dear team.", "formal", "Dear team."),
        ("I want this to be more informal. Hey.", "casual", "Hey."),
        ("Relaxed mode. Hey.", "casual", "Hey."),
    ],
)
def test_the_style_named_at_the_start_is_found_and_dropped(said, style, rest):
    found, remaining = styles.spoken_style(said, STYLES)
    if style is None:
        assert (found, remaining) == (None, said)
    else:
        assert found.id == style
        assert remaining == rest


@pytest.mark.parametrize(
    "said",
    [
        "Remember to use formal mode for this.",
        "Use formal language here.",
        "Use funny mode. Hi.",  # no style called Funny
        "Use formal modest wording.",
        "Use personal mode" + "l",
        # Looser lead-ins must stand alone; these open real sentences.
        "Formal mode is off by default.",
        "Make this formal letter shorter.",
        "I want this to be more personal than last year's card.",
        "Make it less formal.",
        "I want this to be more formal-looking, like a contract.",
        "Keep it casual.",
        "Switch to formal wear tonight.",
    ],
)
def test_other_text_is_left_alone(said):
    assert styles.spoken_style(said, STYLES) == (None, said)


async def dictate(tmp_path, monkeypatch, said, cleaned="Dear team, the build is green."):
    session, _ = make_session(tmp_path, monkeypatch)
    session.settings.auto_refine = True
    refine = AsyncMock(return_value=(cleaned, "0.6B"))
    monkeypatch.setattr(capture_stream, "refine_transcript", refine)
    monkeypatch.setattr(capture_stream, "known_names", lambda: frozenset())
    from backend.services import correction_learning

    monkeypatch.setattr(correction_learning, "apply_learned_corrections", lambda text, _: text)
    session.recognize = AsyncMock(return_value=said)
    session.set_app(SLACK, "Slack")
    worker = asyncio.create_task(session.run())
    append(session, 1)
    session.finish()
    await worker
    return session, refine


@pytest.fixture
def formal(database):  # noqa: F811
    with Session(database) as db:
        created = styles.create_style(db, "Formal")
        db.query(WritingStyle).filter(WritingStyle.id == created.id).update({"id": "formal"})
        db.commit()
        styles.invalidate()
    return database


@pytest.mark.asyncio
async def test_saying_a_style_overrides_the_apps(tmp_path, monkeypatch, formal):
    session, refine = await dictate(tmp_path, monkeypatch, "Use formal mode. Dear team, the build is green.")
    flags = refine.await_args.args[1]
    assert flags.style == "formal"
    # The command isn't cleaned up or pasted.
    assert refine.await_args.args[0] == "Dear team, the build is green."
    assert session.raw == "Dear team, the build is green."
    assert session.refined == "Dear team, the build is green."
    # The app's style can't take it back.
    assert not session.set_app(SLACK, "Slack")
    assert session.style.id == "formal"
    with Session(formal) as db:
        row = session.persist(db)
        saved = db.get(Capture, row.id)
        assert row.style_id == "formal"
        # Corrections teach Formal, not Slack's Chat style.
        assert saved.teaches_style_id == "formal"
    session.close()


@pytest.mark.asyncio
async def test_without_the_command_the_app_style_is_used(tmp_path, monkeypatch, formal):
    session, refine = await dictate(tmp_path, monkeypatch, "dear team, the build is green")
    assert refine.await_args.args[1].style == "chat"
    with Session(formal) as db:
        row = session.persist(db)
        assert db.get(Capture, row.id).teaches_style_id is None
    session.close()


@pytest.mark.asyncio
async def test_a_command_alone_leaves_nothing_to_paste(tmp_path, monkeypatch, formal):
    session, refine = await dictate(tmp_path, monkeypatch, "Use formal mode.")
    refine.assert_not_awaited()
    assert session.raw == ""
    assert session.style.id == "formal"
    session.close()


@pytest.mark.asyncio
async def test_the_phrase_after_a_lone_command_starts_the_dictation(tmp_path, monkeypatch, formal):
    session, _ = make_session(tmp_path, monkeypatch)
    monkeypatch.setattr(capture_stream, "known_names", lambda: frozenset())
    await session.accept("Use formal mode.", paused=True)
    await session.accept("Dear team.")
    assert session.style.id == "formal"
    assert session.raw == "Dear team."
    assert session.heard == "Dear team."
    # Only the start of a dictation picks a style.
    await session.accept("Use chat mode.")
    assert session.style.id == "formal"
    session.close()
