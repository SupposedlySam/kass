"""Spoken formatting regressions, including literal commands and opt-outs."""

import json
import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.services.dictation_edits import apply_dictation_edits, apply_line_breaks, apply_spoken_marks
from backend.services.refinement import RefinementFlags, refine_transcript

CASES = json.loads((Path(__file__).parent / "fixtures/dictation_edits.json").read_text())


@pytest.mark.parametrize("case", CASES[:2], ids=lambda case: case["name"])
def test_user_list_examples(case):
    assert apply_dictation_edits(case["raw"], formatting=True, corrections=True) == case["expected"]


@pytest.mark.parametrize(
    "raw",
    [
        CASES[2]["raw"],
        CASES[3]["raw"],
        "Please tell Sam to create a list of apples, pears, and oranges.",
        'She said "Create a list of apples, pears, and oranges."',
        "Create a list of research and development.",
        "Create a list of version 1.2, version 2.3, and version 3.4.",
        "Create a list of A, B, and C. Send it tomorrow.",
    ],
)
def test_ambiguous_or_literal_content_uses_normal_refinement(raw):
    assert apply_dictation_edits(raw, formatting=True, corrections=True) is None


def test_disabled_formatting_preserves_spoken_commands():
    assert apply_dictation_edits(CASES[1]["raw"], formatting=False, corrections=True) is None


def test_disabled_corrections_does_not_apply_retraction():
    assert apply_dictation_edits(CASES[0]["raw"], formatting=True, corrections=False) is None


def test_last_item_removal_preserves_other_items():
    assert (
        apply_dictation_edits(
            "Shopping. Create a list of apples, pears, and oranges. Actually, remove the last item.",
            formatting=True,
            corrections=True,
        )
        == "Shopping.\n- Apples\n- Pears"
    )


def test_paragraph_and_newline():
    assert (
        apply_line_breaks("Hello. New paragraph The review is ready. New line Please read it.")
        == "Hello.\n\nThe review is ready.\nPlease read it."
    )


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Anywhere, not only after a sentence, the way Whisper hears it.
        ("hello there new line how are you", "hello there\nHow are you"),
        ("Hello, new line, how are you?", "Hello\nHow are you?"),
        ("Hello. Newline. How are you?", "Hello.\nHow are you?"),
        ("first point line break second point", "first point\nSecond point"),
        ("thanks add a new line best Morgan", "thanks\nBest Morgan"),
        ("thanks insert a line break best", "thanks\nBest"),
        ("done go to the next line then this", "done\nThen this"),
        ("Next line. Bananas", "\nBananas"),
        ("intro new paragraph body", "intro\n\nBody"),
        ("intro paragraph break body", "intro\n\nBody"),
        ("hello new line new line there", "hello\n\nThere"),
        # At the very start or end, the text starts or ends on a new line.
        ("see you new line", "see you\n"),
        ("new line hello there", "\nHello there"),
        ("New paragraph. Hi", "\n\nHi"),
        ("new line", "\n"),
    ],
)
def test_spoken_line_breaks(raw, expected):
    assert apply_line_breaks(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "We launched a new line of products today",
        "Read the next line out loud",
        "Check next line and fix it",
        "It prints the newline character",
        "Put it on a new line",
        "Strip the line breaks from it",
        'Type "new line" into the box',
        "Our new line is selling well",
    ],
)
def test_line_break_talked_about_stays_words(raw):
    assert apply_line_breaks(raw) == raw


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("He said quote I'm tired end quote and left", 'He said "I\'m tired" and left'),
        ("He said, quote, I'm tired, end quote.", 'He said, "I\'m tired".'),
        ("He said. Quote. I'm tired. End quote.", 'He said. "I\'m tired."'),
        ("open quote hello close quote", '"hello"'),
        ("it was start quote great unquote honestly", 'it was "great" honestly'),
        ("the plan, open paren the new one, close paren, ships Friday", "the plan (the new one), ships Friday"),
        ("the plan parentheses the new one parentheses ships Friday", "the plan (the new one) ships Friday"),
        ("he wrote quote hi open parenthesis sort of close parenthesis end quote", 'he wrote "hi (sort of)"'),
        # An explicit mark applies alone; a quoted "new line" stays words.
        ("call me start quote soon", 'call me "soon'),
        ("Quote new line end quote", '"new line"'),
    ],
)
def test_spoken_marks(raw, expected):
    assert apply_spoken_marks(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "I'll send you a quote tomorrow",
        "quote me on that",
        "Put it in parentheses please",
        "he's quote unquote busy",
        "at the end quote the price",
        "Get quotes from both vendors",
    ],
)
def test_marks_talked_about_stay_words(raw):
    assert apply_spoken_marks(raw) == raw


def test_quoted_new_line_stays_words_in_cleanup():
    from backend.services.refinement import prepare_refinement

    assert prepare_refinement("type quote new line end quote", RefinementFlags())[0] == 'type "new line"'


@pytest.mark.asyncio
async def test_structural_edits_do_not_get_rewritten_by_model(monkeypatch):
    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock()})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    for case in CASES[:2]:
        actual, model = await refine_transcript(case["raw"], RefinementFlags())
        assert actual == case["expected"]
        assert model == "0.6B"
    backend.generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_ordinary_dictation_still_uses_refinement(monkeypatch):
    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock(return_value="Cleaned prose.")})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    assert await refine_transcript("um prose", RefinementFlags()) == ("Cleaned prose.", "0.6B")
    backend.generate.assert_awaited_once()


@pytest.mark.asyncio
async def test_each_line_of_spoken_breaks_is_cleaned(monkeypatch):
    async def generate(prompt, **_):
        return re.sub(r"(?i)\bum\s+", "", prompt).capitalize() + "."

    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock(side_effect=generate)})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    actual, _ = await refine_transcript("um hello there new line um how are you", RefinementFlags())
    assert actual == "Hello there.\nHow are you."
    assert backend.generate.await_count == 2


@pytest.mark.asyncio
async def test_a_listener_sees_the_lines_before_the_current_one(monkeypatch):
    from backend.backends.qwen_llm_backend import generation_listener

    heard = []

    async def generate(prompt, **_):
        generation_listener.get()(prompt)
        return prompt

    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock(side_effect=generate)})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    token = generation_listener.set(heard.append)
    try:
        await refine_transcript("first new paragraph second", RefinementFlags())
        assert generation_listener.get() == heard.append
    finally:
        generation_listener.reset(token)
    assert heard == ["first", "first\n\nSecond"]


@pytest.mark.asyncio
async def test_line_breaks_at_the_edges_are_kept_without_cleaning_nothing(monkeypatch):
    async def generate(prompt, **_):
        return prompt.capitalize() + "."

    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock(side_effect=generate)})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    assert (await refine_transcript("new line hello there new line", RefinementFlags()))[0] == "\nHello there.\n"
    assert backend.generate.await_count == 1
    assert (await refine_transcript("new line", RefinementFlags()))[0] == "\n"
    assert backend.generate.await_count == 1
