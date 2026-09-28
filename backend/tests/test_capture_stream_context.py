"""Dictation that starts in the middle of a sentence already in the field."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from backend.services import capture_stream
from backend.tests.test_capture_stream import append, make_session


async def dictate(tmp_path, monkeypatch, before, heard, cleaned, auto_refine=True):
    session, _ = make_session(tmp_path, monkeypatch)
    session.settings.auto_refine = auto_refine
    stt = type("STT", (), {"transcribe_array": AsyncMock(return_value=heard)})()
    monkeypatch.setattr(capture_stream, "get_whisper_model", lambda: stt)
    monkeypatch.setattr(capture_stream, "refine_transcript", AsyncMock(return_value=(cleaned, "0.6B")))
    monkeypatch.setattr(capture_stream, "known_names", lambda: frozenset({"Slack"}))
    from backend.services import correction_learning

    monkeypatch.setattr(correction_learning, "apply_learned_corrections", lambda text, _: text)
    if before is not None:
        session.set_context(before)
    worker = asyncio.create_task(session.run())
    append(session, 1)
    session.finish()
    await worker
    session.close()
    return session, stt.transcribe_array.await_args.kwargs["previous_text"]


@pytest.mark.asyncio
async def test_a_common_first_word_continues_the_fields_sentence(tmp_path, monkeypatch):
    session, prompt = await dictate(
        tmp_path, monkeypatch, "I think we should ", "Move the meeting to Friday.", "Move the meeting to Friday."
    )
    # Whisper hears the sentence it continues.
    assert prompt == "I think we should "
    assert session.raw == "move the meeting to Friday."
    assert session.refined == "move the meeting to Friday."


@pytest.mark.asyncio
async def test_cleanup_follows_whispers_lowercase(tmp_path, monkeypatch):
    session, _ = await dictate(tmp_path, monkeypatch, "Can you", "send the report", "Send the report.")
    assert session.refined == "send the report."


@pytest.mark.asyncio
@pytest.mark.parametrize("heard", ["Morgan agreed", "Slack is down"])
async def test_names_keep_their_capital(tmp_path, monkeypatch, heard):
    session, _ = await dictate(tmp_path, monkeypatch, "and then ", heard, f"{heard}.")
    assert session.refined == f"{heard}."


@pytest.mark.asyncio
@pytest.mark.parametrize("before", [None, "", "Done. ", "Hi,\n"])
async def test_a_new_sentence_is_left_alone(tmp_path, monkeypatch, before):
    session, prompt = await dictate(tmp_path, monkeypatch, before, "Move it", "Move it.")
    assert prompt == ""
    assert session.refined == "Move it."


@pytest.mark.asyncio
async def test_without_cleanup_the_transcript_continues(tmp_path, monkeypatch):
    session, _ = await dictate(tmp_path, monkeypatch, "we should", "Move it", "unused", auto_refine=False)
    assert session.raw == "move it"


def test_context_must_be_text(tmp_path, monkeypatch):
    session, _ = make_session(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="Context must be text"):
        session.set_context(42)
    session.close()
