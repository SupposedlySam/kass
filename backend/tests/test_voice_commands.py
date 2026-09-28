"""Spoken commands: "paste from clipboard" becomes a marker the client fills."""

import pytest

from backend.services.content_check import check
from backend.services.refinement import RefinementFlags, refine_transcript
from backend.services.voice_commands import CLIPBOARD, commands_alone, mark_commands
from backend.tests.test_capture_stream_tail import refining_session, scripted


@pytest.mark.parametrize(
    ("said", "marked"),
    [
        ("Paste from clipboard.", f"{CLIPBOARD}."),
        ("here's the link paste from the clipboard let me know", f"here's the link {CLIPBOARD} let me know"),
        ("Paste from my clipboard, then paste from clipboard", f"{CLIPBOARD}, then {CLIPBOARD}"),
        ("copy it to the clipboard", "copy it to the clipboard"),
        ("the paste from clipboards", "the paste from clipboards"),
    ],
)
def test_the_phrase_becomes_a_marker_wherever_it_is_said(said, marked):
    assert mark_commands(said) == marked


def test_a_dictation_of_only_commands_has_nothing_to_clean():
    assert commands_alone(f"{CLIPBOARD}.") == CLIPBOARD
    assert commands_alone("[Clipboard]") == CLIPBOARD
    assert commands_alone(f"{CLIPBOARD} {CLIPBOARD}") == f"{CLIPBOARD} {CLIPBOARD}"
    assert commands_alone(f"Here {CLIPBOARD}.") is None
    assert commands_alone("") is None


@pytest.mark.asyncio
async def test_only_a_command_skips_the_model():
    class NoModel:
        model_size = "4B"

        async def generate(self, **_):
            raise AssertionError("the model ran")

    flags = RefinementFlags(True, True, True, "standard")
    assert await refine_transcript(f"{CLIPBOARD}.", flags, backend_override=NoModel()) == (CLIPBOARD, "4B")


def test_a_cleanup_that_drops_the_marker_is_rejected():
    said = f"Here's the link {CLIPBOARD} let me know"
    assert check(said, "Here's the link. Let me know.").outcome == "reject"
    # "clipboard" as a word is not the command.
    assert check(said, "Here's the link clipboard. Let me know.").outcome == "reject"
    assert check(said, f"Here's the link: {CLIPBOARD}. Let me know.").outcome == "ok"


@pytest.mark.asyncio
async def test_the_cleanup_sees_the_marker_mid_sentence(tmp_path, monkeypatch):
    refine, prompts = scripted(
        {f"Here's the link {CLIPBOARD} let me know.": f"Here's the link {CLIPBOARD}. Let me know."}
    )
    session, _ = refining_session(tmp_path, monkeypatch, refine)
    session.finish()
    await session.accept("Here's the link paste from clipboard let me know.")
    await session.run()
    session.close()
    assert prompts == [f"Here's the link {CLIPBOARD} let me know."]
    assert session.raw == f"Here's the link {CLIPBOARD} let me know."
    assert session.refined == f"Here's the link {CLIPBOARD}. Let me know."


@pytest.mark.asyncio
async def test_the_phrase_is_marked_across_a_pause(tmp_path, monkeypatch):
    refine, _ = scripted(
        {
            "Here's the link paste from": "Here's the link paste from.",
            f"Here's the link {CLIPBOARD} let me know.": f"Here's the link {CLIPBOARD}. Let me know.",
        }
    )
    session, _ = refining_session(tmp_path, monkeypatch, refine)
    await session.accept("Here's the link paste from-", paused=True)
    session.finish()
    await session.accept("clipboard let me know.")
    await session.run()
    session.close()
    assert session.raw == f"Here's the link {CLIPBOARD} let me know."
