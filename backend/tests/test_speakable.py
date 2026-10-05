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
        # Spaced slashes between words are a choice.
        ("Pick tab / page / sheet.", "Pick tab, page, or sheet."),
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
        ("Merge #2169 first.", "Merge number 2169 first."),
        # A numbered item's number is followed by a colon, one short pause.
        ("1. Merge it.\n2) Rerun the checks.", "1: Merge it.\n2: Rerun the checks."),
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


def test_dates_versions_and_initials_are_left_alone():
    assert speakable("On 10/2, version 0.7.3 shipped.") == "On 10/2, version 0.7.3 shipped."
    assert speakable("J. Smith wrote it with Node.js.") == "J. Smith wrote it with Node.js."


@pytest.mark.parametrize(
    ("written", "said"),
    [
        # A slash is read by what it's part of, with what that is said first.
        (
            "The player lives in tauri/src-tauri/src/read_aloud.rs.",
            "The player lives in the file tauri slash src hyphen tauri slash src slash read underscore aloud dot rs.",
        ),
        ("It's written up in FORK.md.", "It's written up in the file FORK dot md."),
        ("Look in scripts/fork/ for it.", "Look in the folder scripts slash fork for it."),
        (
            "Commits listed in scripts/fork/skip-upstream are skipped.",
            "Commits listed in the path scripts slash fork slash skip hyphen upstream are skipped.",
        ),
        (
            "Delete it in ~/.cache/huggingface/hub to free space.",
            "Delete it in the path tilde slash dot cache slash huggingface slash hub to free space.",
        ),
        ("It moved to /usr/local/bin.", "It moved to the path slash usr slash local slash bin."),
        # A path that starts the sentence starts with a capital.
        ("scripts/fork/sync-upstream merges it.", "The path scripts slash fork slash sync hyphen upstream merges it."),
        # Branches are read as named, with no label.
        ("Branch from upstream/main first.", "Branch from upstream slash main first."),
        ("Merge feature/read-aloud.", "Merge feature slash read hyphen aloud."),
        # A GitHub owner, with capitals or digits inside, makes a repository.
        ("The fork is SupposedlySam/kass.", "The fork is the repository SupposedlySam slash kass."),
        ("PRs go to mrgnhnt96/kass.", "PRs go to the repository mrgnhnt96 slash kass."),
        # Already named, so not named twice.
        ("Edit the file FORK.md.", "Edit the file FORK dot md."),
        ("Use the scripts/fork/ folder.", "Use the scripts slash fork folder."),
        # Only two plain words are a choice.
        ("Pick tab/page.", "Pick tab or page."),
        ("Use and/or here.", "Use and or here."),
        ("Ask Morgan/Jonah.", "Ask Morgan or Jonah."),
    ],
)
def test_a_slash_is_read_as_what_it_is_part_of(written, said):
    assert speakable(written) == said


@pytest.mark.parametrize(
    ("written", "said"),
    [
        (
            "A plain `git merge upstream/main` would apply it.",
            "A plain command, git merge upstream slash main, would apply it.",
        ),
        (
            "Run `scripts/fork/sync-upstream --dry` first.",
            "Run the command, scripts slash fork slash sync hyphen upstream dash dash dry, first.",
        ),
        ("Then `just install`.", "Then the command, just install."),
        # A one-word code span is just the word.
        ("Set `speak_naturally` off.", "Set speak_naturally off."),
    ],
)
def test_a_command_in_backticks_is_said_to_be_one(written, said):
    assert speakable(written) == said


def test_lines_are_still_read_one_by_one():
    assert split_sentences(speakable("Decision 9\nA. Cut them.\nB. Keep them.")) == [
        "Decision 9. Option A: Cut them.",
        "Option B: Keep them.",
    ]
