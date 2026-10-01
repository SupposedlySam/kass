from backend.services.laughter import join_laughter
from backend.services.refinement import RefinementFlags, prepare_refinement, strip_stt_artifacts


def test_a_laugh_is_written_as_one_word():
    assert join_laughter("ha ha ha") == "hahaha"
    assert join_laughter("Ha, ha, ha. That's great") == "Hahaha. That's great"
    assert join_laughter("that's funny ha ha") == "that's funny haha"
    assert join_laughter("haha ha-ha") == "hahahaha"
    assert join_laughter("HA HA HA") == "HAHAHA"
    assert join_laughter("Ha Ha") == "Haha"


def test_a_laugh_is_spelled_the_way_it_was_heard():
    assert join_laughter("he he he") == "hehehe"
    assert join_laughter("that's sneaky, he he.") == "that's sneaky, hehe."
    assert join_laughter("He, he, he, I win") == "Hehehe, I win"
    assert join_laughter("ha ha he he") == "hahahehe"


def test_he_said_again_is_a_restart_not_a_laugh():
    assert join_laughter("he, he went home") == "he, he went home"
    assert join_laughter("and he he said no") == "and he he said no"


def test_words_that_are_not_a_laugh_are_left_alone():
    assert join_laughter("ha") == "ha"
    assert join_laughter("hah, I knew it") == "hah, I knew it"
    assert join_laughter("Hawaii has a hat") == "Hawaii has a hat"
    assert join_laughter("aha ha") == "aha ha"


def test_a_long_laugh_is_kept_not_taken_for_a_whisper_loop():
    assert strip_stt_artifacts("ha ha ha ha ha ha ha ha that's so good") == "hahahahahahahaha that's so good"
    assert strip_stt_artifacts("hahahahahahaha") == "hahahahahahaha"
    cleaned, _ = prepare_refinement("ha ha ha ha ha ha ha you got me", RefinementFlags())
    assert cleaned.startswith("hahahahahahaha")
