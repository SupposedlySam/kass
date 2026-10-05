"""How something was said: pitch, loudness, pace and drawn-out words."""

import asyncio

import numpy as np
import pytest

from backend.backends.word_timing import Word
from backend.services import prosody
from backend.services.prosody import (
    Baseline,
    Expression,
    Frames,
    PitchTrack,
    measure,
    semitones,
    stretch_word,
    syllables,
)


def tone(hz, seconds, rate, amplitude=8000):
    t = np.arange(int(seconds * rate)) / rate
    # A voice-like tone: the fundamental and a strong second harmonic.
    wave = np.sin(2 * np.pi * hz * t) + 0.6 * np.sin(4 * np.pi * hz * t)
    return (amplitude * wave / 1.6).astype("<i2")


@pytest.mark.parametrize("rate", [16000, 48000])
@pytest.mark.parametrize("hz", [110.0, 220.0])
def test_pitch_track_follows_a_tone_fed_in_chunks(rate, hz):
    track = PitchTrack(rate)
    audio = tone(hz, 1.0, rate)
    for start in range(0, len(audio), rate // 10):
        track.feed(audio[start : start + rate // 10])
    frames = track.frames()
    # One frame per 10 ms once its window has arrived.
    assert 95 <= len(frames.hz) <= 100
    voiced = frames.hz[~np.isnan(frames.hz)]
    assert len(voiced) > 0.9 * len(frames.hz)
    assert np.median(voiced) == pytest.approx(hz, rel=0.01)


def test_silence_is_unvoiced():
    track = PitchTrack(16000)
    track.feed(np.zeros(16000, dtype="<i2"))
    frames = track.frames()
    assert np.isnan(frames.hz).all()
    assert (frames.db < prosody.SILENCE_DB).all()


def test_semitones_fold_octave_slips_and_drop_short_runs():
    hz = np.full(20, 200.0)
    hz[10] = 400.0  # one frame an octave up
    hz[[3, 15]] = np.nan
    hz[16:18] = np.nan
    st = semitones(hz)
    # 200 Hz is 12 semitones above 100 Hz.
    assert np.nanmax(np.abs(st - 12)) < 1e-9
    # Frames 18–19 are a 2-frame run, too short to keep.
    assert np.isnan(st[18:]).all()
    assert np.isnan(st[3])


def test_a_whole_run_high_above_the_norm_is_kept():
    hz = np.concatenate([np.full(10, 200.0), [np.nan], np.full(10, 450.0)])
    st = semitones(hz)
    assert st[-1] == pytest.approx(12 * np.log2(4.5))


@pytest.mark.parametrize(
    ("word", "count"), [("way", 1), ("five", 1), ("table", 2), ("really", 2), ("away.", 2), ("hmm", 1)]
)
def test_syllables(word, count):
    assert syllables(word) == count


@pytest.mark.parametrize(
    ("word", "letters", "written"),
    [("way", 3, "wayyy"), ("five", 3, "fiiive"), ("So,", 4, "Soooo,"), ("long", 3, "looong"), ("hmm", 3, "hmm")],
)
def test_stretch_word_draws_out_the_last_vowel(word, letters, written):
    assert stretch_word(word, letters) == written


def statement(level, span=4.0, loudness=-20.0, text="A statement."):
    return dict(text=text, level=level, span=span, loudness=loudness)


def test_baseline_needs_enough_statements():
    assert Baseline.of([statement(5.0)] * 19) is None
    # Questions don't count toward a speaker's statements.
    assert Baseline.of([statement(5.0)] * 19 + [statement(5.0, text="Really?")]) is None
    baseline = Baseline.of([statement(5.0 + i % 3) for i in range(20)])
    assert baseline.level[0] == 6.0
    assert baseline.energy(baseline.level[0], baseline.span[0], baseline.loudness[0]) == 0.0
    assert baseline.energy(
        baseline.level[0] + 3 * baseline.level[1], baseline.span[0], baseline.loudness[0]
    ) == pytest.approx(1.0)


TEXT = "That was really far away from the old house."
TIMES = [0.0, 0.2, 0.4, 0.6, 1.3, 1.6, 1.8, 2.0, 2.3, 3.0]


def far_said(louder=6.0):
    """3 s of voice at 150 Hz with a break every fifth frame, except a
    steady half second in "far", which is also louder."""
    hz = np.full(300, 150.0)
    hz[np.arange(300) % 5 == 4] = np.nan
    hz[70:120] = 150.0
    db = np.full(300, -20.0)
    db[60:130] += louder
    words = [Word(text, start, end) for text, start, end in zip(TEXT.split(), TIMES, TIMES[1:], strict=False)]
    return Frames(hz, db), words


def test_a_long_loud_steady_word_is_drawn_out():
    frames, words = far_said()
    measured = measure(frames, words, None)
    assert measured["version"] == 1
    assert measured["pace"] == pytest.approx(0.16, abs=0.01)
    (sentence,) = measured["sentences"]
    assert sentence["text"] == TEXT
    assert sentence["level"] == pytest.approx(12 * np.log2(1.5), abs=0.01)
    assert sentence["energy"] is None
    (stretched,) = measured["stretched"]
    assert stretched["word"] == "far"
    assert stretched["index"] == 3
    assert stretched["written"] == "faaar"


def test_a_long_word_said_no_louder_is_not():
    frames, words = far_said(louder=0.0)
    assert measure(frames, words, None)["stretched"] == []


def test_an_initialism_is_never_drawn_out():
    frames, words = far_said()
    words[3] = Word("UI", words[3].start, words[3].end)
    assert measure(frames, words, None)["stretched"] == []


def test_energy_is_against_the_baseline():
    frames, words = far_said()
    baseline = Baseline((0.0, 1.0), (0.0, 1.0), (-20.0, 1.0))
    (sentence,) = measure(frames, words, baseline)["sentences"]
    assert sentence["energy"] == pytest.approx(
        baseline.energy(sentence["level"], sentence["span"], sentence["loudness"]), abs=0.01
    )


class Said:
    def __init__(self, *words):
        self._words = [Word(*word) for word in words]

    def words(self):
        return self._words


@pytest.mark.asyncio
async def test_words_overlapped_by_a_forced_cut_are_kept_once():
    expression = Expression(16000)
    expression.phrase(Said(("a", 0.0, 1.0), ("b", 1.0, 2.0)), 0, released=False)
    # The next phrase repeats the last half second, then goes on.
    expression.phrase(Said(("b", 0.0, 0.5), ("c", 0.6, 1.0)), 24000, released=True)
    expression.phrase(None, 48000, released=True)
    words = await expression.words()
    assert [(word.text, word.start, word.end) for word in words] == [
        ("a", 0.0, 1.0),
        ("b", 1.0, 2.0),
        ("c", 2.1, 2.5),
    ]


@pytest.mark.asyncio
async def test_a_failed_track_measures_nothing(monkeypatch):
    expression = Expression(16000)

    def broken(pcm):
        raise ValueError("bad audio")

    monkeypatch.setattr(expression.track, "feed", broken)
    expression.feed(np.zeros(160, dtype="<i2"))
    assert expression.failed
    expression.phrase(Said(("a", 0.0, 1.0)), 0, released=True)
    assert await expression.measure(None) is None


@pytest.mark.asyncio
async def test_measuring_never_raises(monkeypatch):
    def broken():
        raise RuntimeError("no database")

    monkeypatch.setattr(prosody, "load_baseline", broken)
    await prosody.measure_and_save("capture", Expression(16000))
    await asyncio.sleep(0)
