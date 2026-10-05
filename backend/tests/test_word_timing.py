"""Word times from the attention Whisper's decode already computes."""

import json

import numpy as np
import pytest

from backend.backends import word_timing
from backend.backends.word_timing import Alignment, Word, dtw, median_filter, split_words, trim_long_starts


def reference_dtw(x):
    """mlx-audio's dtw_cpu, one cell at a time."""
    n, m = x.shape
    cost = np.full((n + 1, m + 1), np.inf)
    trace = -np.ones((n + 1, m + 1), dtype=int)
    cost[0, 0] = 0
    for j in range(1, m + 1):
        for i in range(1, n + 1):
            c0, c1, c2 = cost[i - 1, j - 1], cost[i - 1, j], cost[i, j - 1]
            if c0 < c1 and c0 < c2:
                c, t = c0, 0
            elif c1 < c0 and c1 < c2:
                c, t = c1, 1
            else:
                c, t = c2, 2
            cost[i, j] = x[i - 1, j - 1] + c
            trace[i, j] = t
    trace[0, :] = 2
    trace[:, 0] = 1
    i, j, path = n, m, []
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        t = trace[i, j]
        if t == 0:
            i, j = i - 1, j - 1
        elif t == 1:
            i -= 1
        else:
            j -= 1
    path = np.array(path[::-1]).T
    return path[0], path[1]


@pytest.mark.parametrize("seed", range(5))
def test_dtw_takes_the_same_path_as_mlx_audio(seed):
    x = np.random.default_rng(seed).normal(size=(7, 40))
    for got, want in zip(dtw(x), reference_dtw(x), strict=True):
        np.testing.assert_array_equal(got, want)


def test_median_filter_reflects_at_the_ends():
    x = np.array([[5.0, 1.0, 1.0, 9.0, 1.0, 1.0]])
    np.testing.assert_array_equal(median_filter(x, 3), [[1.0, 1.0, 1.0, 1.0, 1.0, 1.0]])
    # Too short to filter: unchanged.
    np.testing.assert_array_equal(median_filter(np.array([[3.0]]), 7), [[3.0]])


@pytest.mark.parametrize(
    ("pieces", "words"),
    [
        ([" Hello", ",", " world", "."], [("Hello,", 0, 0), ("world.", 2, 2)]),
        ([" read", " privacy", ".", "md", " now"], [("read", 0, 0), ("privacy.md", 1, 3), ("now", 4, 4)]),
        ([" V", "-", "O", "-", "V", "-", "A"], [("V-O-V-A", 0, 6)]),
        ([" costs", " $", "19", " ."], [("costs", 0, 0), ("$19 .", 1, 2)]),
        # A spaced mark stays with its word, spaced as written.
        ([" great", " !"], [("great !", 0, 0)]),
    ],
)
def test_split_words_keeps_words_as_whisper_wrote_them(pieces, words):
    assert split_words(pieces) == words


def test_a_long_start_after_a_pause_is_brought_forward():
    spans = [
        ["First", 0.0, 2.0],
        ["word.", 2.0, 2.3],
        ["Then", 2.3, 4.0],
        ["more", 4.0, 4.2],
        ["words", 4.2, 4.5],
    ]
    words = trim_long_starts(spans)
    # Median length is 0.3 s, so a start after a pause reaches back at most 0.6 s.
    assert words[0] == Word("First", pytest.approx(1.4), 2.0)
    assert words[2] == Word("Then", pytest.approx(3.4), 4.0)
    assert words[1:2] + words[3:] == [Word("word.", 2.0, 2.3), Word("more", 4.0, 4.2), Word("words", 4.2, 4.5)]


def test_alignment_heads_come_from_the_generation_config(tmp_path):
    assert word_timing.alignment_heads(tmp_path) is None
    (tmp_path / "generation_config.json").write_text(json.dumps({"alignment_heads": [[2, 4], [3, 11]]}))
    assert word_timing.alignment_heads(tmp_path) == [(2, 4), (3, 11)]
    (tmp_path / "generation_config.json").write_text(json.dumps({"alignment_heads": [[2]]}))
    assert word_timing.alignment_heads(tmp_path) is None


class Pieces:
    """A tokenizer whose tokens are indices into a list of texts."""

    eot = 100

    def __init__(self, texts):
        self.texts = texts

    def decode(self, tokens):
        return "".join(self.texts[token] for token in tokens)


def test_words_follow_where_the_attention_points():
    tokenizer = Pieces([" Hello", " there", "."])
    # Each token attends to its own stretch of 50 frames (1 s); the end of
    # text attends just after the last.
    frames = 200
    weights = np.full((2, 4, frames), -10.0)
    for row, (start, end) in enumerate([(0, 50), (50, 100), (100, 110), (110, 200)]):
        weights[:, row, start:end] = 10.0
    words = Alignment([0, 1, 2], weights, tokenizer).words()
    assert [word.text for word in words] == ["Hello", "there."]
    assert words[0].start == pytest.approx(0.0, abs=0.1)
    assert words[0].end == pytest.approx(1.0, abs=0.1)
    # "there." ends where its period starts, not at the end of text.
    assert words[1].start == pytest.approx(1.0, abs=0.1)
    assert words[1].end == pytest.approx(2.0, abs=0.1)


def test_no_words_without_tokens():
    assert Alignment([], np.zeros((1, 1, 10)), Pieces([])).words() == []


def test_alignment_is_only_of_the_decode_that_wrote_the_text():
    harvest = word_timing._Harvest([(0, 0)])
    tokenizer = Pieces([" a", " b"])
    assert word_timing.alignment(harvest, [0, 1], 100, tokenizer) is None
    # A best-of decode keeps no rows; a different text isn't this one.
    harvest.runs = [([0, 1, 100], [])]
    assert word_timing.alignment(harvest, [1, 0], 100, tokenizer) is None
    harvest.runs = [(None, [])]
    assert word_timing.alignment(harvest, [0, 1], 100, tokenizer) is None
