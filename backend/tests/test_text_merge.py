"""Removing one round of corrections keeps the rounds made after it."""

from backend.services.text_merge import take_back


def test_takes_back_only_the_removed_round():
    assert (
        take_back("See you Tuesday, Megan.", "See you Tuesday, Morgan.", "See you Monday, Morgan.")
        == "See you Monday, Megan."
    )


def test_the_newer_round_wins_on_the_same_words():
    assert take_back("See you Tuesday, Megan.", "See you Tuesday, Morgan.", "See you Tuesday, Morgana.") == (
        "See you Tuesday, Morgana."
    )


def test_added_and_deleted_words():
    assert take_back("a b c", "a x b c", "a x b y c") == "a b y c"
    assert take_back("a b c", "a c", "a c d") == "a b c d"
    assert take_back("Hi", "Hi there", "Hi there friend") == "Hi friend"
