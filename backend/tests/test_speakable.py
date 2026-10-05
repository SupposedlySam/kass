"""Read naturally: text the way a person would say it, with a pause wherever a symbol was."""

import pytest

from backend.services.speakable import speakable
from backend.services.speech import split_sentences


@pytest.mark.parametrize(
    ("written", "said"),
    [
        # A slash list in brackets is a list of examples, with commas to pause on.
        (
            "Keyboard policy (resize / lift / hold / cover): every host must pass it.",
            "Keyboard policy, for example resize, lift, hold, and cover: every host must pass it.",
        ),
        # Trailing off means there are more.
        (
            "The host kind (tab / page / sheet…) is read.",
            "The host kind, for example tab, page, sheet, and so on, is read.",
        ),
        (
            "Display format (portrait / large-format portrait...): this copies",
            "Display format, for example portrait, large-format portrait, and so on: this copies.",
        ),
        # Brackets are set off by commas, not read as nothing.
        ("Your rule (decision 22) already covers it.", "Your rule, decision 22, already covers it."),
        ("It covers the Duo (decision 22)", "It covers the Duo, decision 22."),
        ("Display features (a foldable's hinge): stored.", "Display features, a foldable's hinge: stored."),
        # Slashes between words are "or", never "slash".
        ("Pick tab/page.", "Pick tab or page."),
        ("Pick tab / page / sheet.", "Pick tab, page, or sheet."),
        ("Use and/or here.", "Use and or here."),
        # A lettered option keeps a pause after its letter.
        ("A. Cut them until something reads them.", "Option A: Cut them until something reads them."),
        ("B) Keep them for later.", "Option B: Keep them for later."),
        # Abbreviations and symbols in words.
        ("Some hosts, e.g. sheets, cover it.", "Some hosts, for example, sheets, cover it."),
        ("One host, i.e. the sheet.", "One host, that is, the sheet."),
        ("Tabs, pages, etc. all work.", "Tabs, pages, and so on all work."),
        ("It reads tabs, pages, etc.", "It reads tabs, pages, and so on."),
        ("Ship it -> done.", "Ship it to done."),
        ("Read & write.", "Read and write."),
        ("React vs. Vue.", "React versus Vue."),
        # Markdown is read as its text.
        ("## Decision 9 of 11", "Decision 9 of 11."),
        ("- **Bold** and `code` and *this*", "Bold and code and this."),
        (
            "See [the docs](https://example.com/docs) or https://www.github.com/kass/issues",
            "See the docs or github.com.",
        ),
    ],
)
def test_written_text_is_said_naturally(written, said):
    assert speakable(written) == said


def test_a_line_without_closing_punctuation_still_ends_in_a_pause():
    assert speakable("Decision 9 of 11: public API that nothing reads\nedgewise exposes it:") == (
        "Decision 9 of 11: public API that nothing reads.\nedgewise exposes it:"
    )


def test_plain_prose_is_left_as_it_is():
    prose = "I recommend A. Once it's published, anything left in can't be taken out. A or B?"
    assert speakable(prose) == prose


def test_dates_paths_and_initials_are_not_turned_into_words():
    assert speakable("On 10/2 it moved to /usr/local/bin.") == "On 10/2 it moved to /usr/local/bin."
    assert speakable("J. Smith wrote it.") == "J. Smith wrote it."


def test_lines_are_still_read_one_by_one():
    assert split_sentences(speakable("Decision 9\nA. Cut them.\nB. Keep them.")) == [
        "Decision 9. Option A: Cut them.",
        "Option B: Keep them.",
    ]
