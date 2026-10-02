from unittest.mock import AsyncMock

import pytest

from backend.services.refinement import RefinementFlags, prepare_refinement, refine_transcript
from backend.services.spelling import join_spelling, respell


def test_spelled_out_letters_lose_the_dashes_whisper_adds():
    assert join_spelling("m-r-g-n-h-n-t at gmail.com") == "mrgnhnt at gmail.com"
    assert join_spelling("It's spelled J-O-S-É.") == "It's spelled JOSÉ."
    # Real hyphenated words and two-letter pairs keep their dashes.
    assert join_spelling("an A-B test on my e-mail and T-shirt") == "an A-B test on my e-mail and T-shirt"
    assert join_spelling("a well-known x-ray") == "a well-known x-ray"


def test_saying_capital_before_a_letter_leaves_just_the_capital_letter():
    assert join_spelling("capital C-H-E-N-E-Y") == "Cheney"
    assert join_spelling("capital c-h-e-n-e-y") == "Cheney"
    assert join_spelling("Plan capital b, then capital C.") == "Plan B, then C."
    assert join_spelling("capital I") == "I"
    assert join_spelling("capital I-B-M stock") == "Ibm stock"
    assert join_spelling("I-B-M stock") == "IBM stock"
    # "capital" before a word is the word itself.
    assert join_spelling("the capital city of Utah") == "the capital city of Utah"
    assert join_spelling("capital-intensive work") == "capital-intensive work"
    # A letter that is a word, going on into a sentence, is that word.
    assert join_spelling("the capital I visited was Paris") == "the capital I visited was Paris"
    assert join_spelling("a capital a lot of people love") == "a capital a lot of people love"


def test_numbers_and_punctuation_said_with_spelling_join_it():
    assert join_spelling("My password is capital C-H-E-N-E-Y 0021!") == "My password is Cheney0021!"
    assert join_spelling("It's capital A 1 2 3") == "It's A123"
    assert join_spelling("user m-r-g-n underscore 96") == "user mrgn_96"
    assert join_spelling("C-A-T 42 exclamation point 7") == "CAT42!7"
    assert join_spelling("0021 C-H-E-N-E-Y") == "0021CHENEY"
    assert join_spelling("capital A dash capital B 7") == "A-B7"


def test_runs_without_spelling_or_across_sentence_punctuation_stay_apart():
    assert join_spelling("I got the iPhone 15 in room 12") == "I got the iPhone 15 in room 12"
    assert join_spelling("Spell C-A-T, 3 dogs ran.") == "Spell CAT, 3 dogs ran."
    assert join_spelling("It's C-A-T. 3 more to go") == "It's CAT. 3 more to go"
    assert join_spelling("A-B-C and 1 2 3") == "ABC and 1 2 3"


def test_a_word_said_then_spelled_is_written_once_as_spelled():
    def said(text):
        return respell(join_spelling(text))

    assert said("My name is Megan, M-E-G-H-A-N, nice to meet you.") == "My name is Meghan, nice to meet you."
    assert said("I added vulva, V-O-V-A to the dictionary") == "I added vova to the dictionary"
    assert said("Ask Jon, J-O-H-N and Megan spelled M-E-G-H-A-N.") == "Ask John and Meghan."
    assert said("I work at NASA, N-A-S-A.") == "I work at NASA."
    assert said("Call Bo, B-O tomorrow") == "Call Bo tomorrow"
    assert prepare_refinement("Say hi to Megan, MEGHAN", RefinementFlags())[0] == "Say hi to Meghan"


def test_spelling_after_a_different_word_stays():
    assert respell(join_spelling("an A-B test")) == "an A-B test"
    assert respell(join_spelling("My password is C-H-E-N-E-Y 0021")) == "My password is CHENEY0021"
    assert respell("the API is down, so is IBM") == "the API is down, so is IBM"
    assert respell("Meet me at the cafe, KFC") == "Meet me at the cafe, KFC"


@pytest.mark.asyncio
async def test_cleanup_drops_the_period_it_adds_after_an_exclamation(monkeypatch):
    output = "My password is CHENEY0021!."
    backend = type("Backend", (), {"model_size": "0.6B", "generate": AsyncMock(return_value=output)})()
    monkeypatch.setattr("backend.services.refinement.llm_service.get_llm_model", lambda: backend)
    refined, _ = await refine_transcript("My password is CHENEY0021!", RefinementFlags())
    assert refined == "My password is CHENEY0021!"
