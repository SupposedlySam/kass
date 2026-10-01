"""Words are written in the case the speaker asked for."""

import pytest

from backend.services.refinement import RefinementFlags, prepare_refinement
from backend.services.spelling import join_spelling
from backend.services.spoken_case import apply_spoken_case


def spoken_case(said: str) -> str:
    # Transcripts reach refinement with spelling already joined.
    return apply_spoken_case(join_spelling(said))


@pytest.mark.parametrize(
    ("said", "written"),
    [
        ("I love, with a capital L O V E", "I LOVE"),
        ("I love, with a capital L-O-V-E.", "I LOVE."),
        ("I love, with a capital L, O, V, E.", "I LOVE."),
        ("I love, with a capital L. O. V. E.", "I LOVE."),
        ("I love with capital L-O-V-E", "I LOVE"),
        ("I love, spelled with all capital letters L-O-V-E", "I LOVE"),
        ("I love, with a capital L", "I Love"),
        ("I use nasa, with a lowercase N-A-S-A.", "I use nasa."),
        ("I love, in all caps", "I LOVE"),
        ("I love, in all caps.", "I LOVE."),
        ("I love, all caps", "I LOVE"),
        ("I love, in caps please", "I LOVE"),
        ("I love, all in caps", "I LOVE"),
        ("I love, in capital letters", "I LOVE"),
        ("I love, in all capitals", "I LOVE"),
        ("I love, uppercase.", "I LOVE."),
        ("I love, in upper case.", "I LOVE."),
        ("I love. In all caps.", "I LOVE."),
        ("I love — all caps.", "I LOVE."),
        ("I love, make that all caps.", "I LOVE."),
        ("Write hello, in all caps, then sign it.", "Write HELLO, then sign it."),
        ("Say HELLO, in lowercase.", "Say hello."),
        ("I all caps love you", "I LOVE you"),
        ("I all caps, love you.", "I LOVE you."),
        ("I am all caps yelling end caps at you.", "I am YELLING at you."),
        ("I am all caps, really yelling, end caps at you.", "I am REALLY YELLING at you."),
        ("caps on this is loud caps off, sorry", "THIS IS LOUD, sorry"),
        ("I am all caps yelling end all caps at you.", "I am YELLING at you."),
    ],
)
def test_case_said_next_to_a_word_is_written(said, written):
    assert spoken_case(said) == written


@pytest.mark.parametrize(
    "said",
    [
        "I wrote it in all caps.",
        "I wrote it, in all caps.",
        "Don't type in all caps.",
        "Stop shouting in all caps",
        "Don't shout. In all caps, it reads as yelling.",
        "All caps is hard to read.",
        "Turn off all caps lock.",
        "Type it in all caps yesterday",
        "the capital city of Utah",
        "I love, with a capital idea",
        "I visited Paris, with a capital P too",
        "Plan capital b, then capital C.",
        "Use lowercase letters for the tags.",
        "My keyboard is all caps",
    ],
)
def test_case_that_is_talked_about_stays_words(said):
    assert spoken_case(said) == join_spelling(said)


def test_capital_before_letters_is_still_joined():
    assert join_spelling("capital C-H-E-N-E-Y") == "Cheney"
    assert join_spelling("with a capital L-O-V-E") == "with a capital LOVE"


def test_refinement_writes_the_case_before_the_model_sees_it():
    cleaned, _ = prepare_refinement(join_spelling("I love, with a capital L-O-V-E"), RefinementFlags())
    assert cleaned == "I LOVE"
    cleaned, _ = prepare_refinement("I love, in all caps", RefinementFlags(smart_cleanup=False))
    assert cleaned == "I love, in all caps"
