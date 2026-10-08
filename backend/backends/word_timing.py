"""When each word was said, from the decode Whisper already runs.

mlx-audio's ``word_timestamps=True`` runs the encoder and decoder a second time
(about 280 ms a phrase). The decoder computes the same cross-attention on the
first pass and throws it away (``Inference.logits``). ``harvest`` keeps the
alignment heads' rows of it as each token is decoded, which costs no measurable
time, and ``Alignment.words`` turns them into word times on the CPU the way
mlx-audio's ``find_alignment`` does: normalize, median filter, then dynamic
time warping (docs/plans/EXPRESSIVE_DICTATION.md).

Only the MLX worker thread decodes, so the active harvest is a thread-local.
"""

from __future__ import annotations

import contextlib
import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# Whisper's encoder outputs one frame per 20 ms.
FRAME_SECONDS = 0.02
# Width of the median filter over frames (mlx-audio's medfilt_width).
MEDIAN_WIDTH = 7
# Languages whose words aren't split by spaces; no timings for them.
UNSPACED = frozenset({"zh", "ja", "th", "lo", "my", "yue"})
# Punctuation that ends the word before it, even after a space.
CLOSING = frozenset(".,!?;:)]}\"'\u201d\u2019\u2026%-")

_active = threading.local()
_installed = False


@dataclass(frozen=True)
class Word:
    """A word as Whisper wrote it, punctuation attached, and when it was said."""

    text: str
    start: float
    end: float


def alignment_heads(model_dir: str | Path) -> list[tuple[int, int]] | None:
    """The model's alignment heads (layer, head), from its generation config."""
    try:
        heads = json.loads((Path(model_dir) / "generation_config.json").read_text()).get("alignment_heads")
    except (OSError, ValueError):
        return None
    if not heads or not all(isinstance(pair, list) and len(pair) == 2 for pair in heads):
        return None
    return [(int(layer), int(head)) for layer, head in heads]


class _Harvest:
    def __init__(self, heads):
        self.heads = heads
        # One entry per decode: (tokens, rows); fallback decodes come first.
        self.runs: list[tuple[list[int] | None, list]] = []
        self.rows: list | None = None


def _install() -> None:
    """Wrap mlx-audio's decoder step and decode run to keep the attention rows.

    Without an active harvest both do exactly what they did.
    """
    global _installed
    if _installed:
        return
    import mlx.core as mx
    from mlx_audio.stt.models.whisper import decoding

    def logits(self, tokens, audio_features):
        logits, self.kv_cache, cross_qk = self.model.decoder(tokens, audio_features, kv_cache=self.kv_cache)
        harvest = getattr(_active, "harvest", None)
        if harvest is not None and harvest.rows is not None:
            if tokens.shape[0] == 1:
                # The last position predicts the next token: (heads, frames).
                row = mx.stack([cross_qk[layer][0, head, -1] for layer, head in harvest.heads])
                # Evaluated with the step, so the full attention can be freed.
                mx.async_eval(row)
                harvest.rows.append(row)
            else:
                # Several candidates per step (best-of sampling): no single row.
                harvest.rows = None
        return logits.astype(mx.float32)

    run = decoding.DecodingTask.run

    def run_harvested(self, mel):
        harvest = getattr(_active, "harvest", None)
        if harvest is None:
            return run(self, mel)
        harvest.rows = []
        try:
            results = run(self, mel)
        finally:
            rows, harvest.rows = harvest.rows, None
        tokens = list(results[0].tokens) if len(results) == 1 and rows is not None else None
        harvest.runs.append((tokens, rows or []))
        return results

    decoding.Inference.logits = logits
    decoding.DecodingTask.run = run_harvested
    _installed = True


@contextlib.contextmanager
def harvest(heads):
    """Keep the alignment heads' attention for decodes run inside the block.

    Yields the harvest for ``alignment``. Call on the MLX worker thread.
    """
    _install()
    collected = _Harvest(heads)
    _active.harvest = collected
    try:
        yield collected
    finally:
        _active.harvest = None


@dataclass
class Alignment:
    """A phrase's text tokens and the attention that places them in the audio."""

    tokens: list[int]
    # (heads, tokens + 1, frames): one row per text token, then end of text.
    weights: np.ndarray
    tokenizer: object

    def words(self) -> list[Word]:
        """Each word and when it was said, in seconds from the phrase's start.

        CPU only (numpy), a few milliseconds; safe on any thread.
        """
        if len(self.tokens) == 0 or self.weights.shape[-1] < 2:
            return []
        weights = _softmax(self.weights.astype(np.float32))
        mean = weights.mean(axis=-2, keepdims=True)
        std = weights.std(axis=-2, keepdims=True)
        weights = (weights - mean) / np.maximum(std, 1e-9)
        matrix = median_filter(weights, MEDIAN_WIDTH).mean(axis=0)
        # The last row predicted the end of text; it places the last word's end.
        text_indices, time_indices = dtw(-matrix)
        jumps = np.concatenate([[True], np.diff(text_indices) != 0])
        jump_times = time_indices[jumps] * FRAME_SECONDS
        last_time = float(time_indices[-1] * FRAME_SECONDS)
        spans = []
        for text, first, spoken in split_words(_decode_each(self.tokenizer, self.tokens)):
            if first >= len(jump_times):
                break
            # A word ends where its punctuation starts: a pause after "events." isn't the word.
            end = float(jump_times[spoken + 1]) if spoken + 1 < len(jump_times) else last_time
            spans.append([text, float(jump_times[first]), end])
        return trim_long_starts(spans)


def alignment(collected: _Harvest, text_tokens: list[int], num_frames: int, tokenizer) -> Alignment | None:
    """The alignment of the decode that produced ``text_tokens``, or None.

    ``num_frames`` counts mel frames of the audio (100 a second). Only a phrase
    decoded in one window has one: a longer one is decoded in several. Call on
    the MLX worker thread; it converts the kept rows to numpy (well under 1 ms).
    """
    if not collected.runs or not text_tokens:
        return None
    tokens, rows = collected.runs[-1]
    if tokens is None:
        return None
    eot = tokenizer.eot
    if [token for token in tokens if token < eot] != text_tokens:
        return None
    # Rows that predicted a text token, then the one that predicted the end.
    keep = [index for index, token in enumerate(tokens) if token < eot]
    if len(rows) > len(tokens):
        keep.append(len(tokens))
    if not keep or keep[-1] >= len(rows):
        return None
    import mlx.core as mx

    frames = max(1, min(rows[0].shape[-1], num_frames // 2))
    weights = np.array(mx.stack([rows[index][:, :frames] for index in keep], axis=1).astype(mx.float32))
    return Alignment(list(text_tokens), weights, tokenizer)


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max(axis=-1, keepdims=True)
    np.exp(x, out=x)
    return x / x.sum(axis=-1, keepdims=True)


def median_filter(x: np.ndarray, width: int) -> np.ndarray:
    """Median over the last axis in a window of ``width``, reflecting at the ends."""
    pad = width // 2
    if x.shape[-1] <= pad:
        return x
    padded = np.pad(x, [(0, 0)] * (x.ndim - 1) + [(pad, pad)], mode="reflect")
    return np.median(np.lib.stride_tricks.sliding_window_view(padded, width, axis=-1), axis=-1)


def dtw(cost: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The cheapest monotonic path through ``cost`` (tokens × frames).

    Same recurrence and tie-breaking as mlx-audio's numba ``dtw_cpu``, with
    each row solved in numpy: within a row, cost[j] = x[j] + min(a[j],
    cost[j-1]) is a running minimum once the row's cumulative sum is taken
    out. Returns (token indices, frame indices) along the path.
    """
    n, m = cost.shape
    total = np.full((n + 1, m + 1), np.inf)
    total[0, 0] = 0.0
    trace = np.zeros((n + 1, m + 1), dtype=np.int8)
    for i in range(1, n + 1):
        x = cost[i - 1].astype(np.float64)
        diagonal, up = total[i - 1, :-1], total[i - 1, 1:]
        best = np.minimum(diagonal, up)
        sums = np.cumsum(x)
        before = np.concatenate([[0.0], sums[:-1]])
        with np.errstate(invalid="ignore"):
            row = np.minimum.accumulate(best - before) + sums
        row[np.isnan(row)] = np.inf
        total[i, 1:] = row
        left = total[i, :-1]
        trace[i, 1:] = np.where((diagonal < up) & (diagonal < left), 0, np.where((up < diagonal) & (up < left), 1, 2))
    trace[0, :] = 2
    trace[:, 0] = 1
    i, j = n, m
    path = []
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        step = trace[i, j]
        if step == 0:
            i, j = i - 1, j - 1
        elif step == 1:
            i -= 1
        else:
            j -= 1
    path = np.array(path[::-1]).T
    return path[0], path[1]


def _decode_each(tokenizer, tokens: list[int]) -> list[str]:
    from .mlx_backend import vocabulary_decoder

    decode = vocabulary_decoder(tokenizer)
    if decode is not None:
        return list(decode([[token] for token in tokens]))
    return [tokenizer.decode([token]) for token in tokens]


def split_words(pieces: list[str]) -> list[tuple[str, int, int]]:
    """Group token texts into words: (word, first token, last spoken token).

    A piece starting with a space starts a word; punctuation stays with the
    word it follows, as Whisper writes it, and so does a hyphenated or dotted
    part ("V-O-V-A", "privacy.md"). A spaced symbol ("$" of "$19") starts one. The last spoken token is the word's last
    one with a letter or digit, before its trailing punctuation.
    """
    words: list[list] = []
    for index, piece in enumerate(pieces):
        spoken = any(c.isalnum() for c in piece)
        starts = piece[:1].isspace() and not set(piece.strip()) <= CLOSING
        if words and not starts:
            words[-1][0] += piece
            if spoken:
                words[-1][2] = index
        else:
            words.append([piece, index, index])
    return [(text.strip(), first, last) for text, first, last in words if text.strip()]


def trim_long_starts(spans: list[list]) -> list[Word]:
    """Words, with a start that reaches back into a pause brought forward.

    Attention can't tell a pause from the word after it, so the first word
    and a word after punctuation may start too early. Like mlx-audio's own
    timings, such a word is cut to twice the median word length (at most
    1.4 s), keeping its end.
    """
    durations = [end - start for _, start, end in spans if end > start]
    longest = 2 * min(0.7, float(np.median(durations))) if durations else 0.0
    words = []
    for index, (text, start, end) in enumerate(spans):
        after_pause = index == 0 or spans[index - 1][0][-1:] in ".!?,;:"
        if after_pause and longest and end - start > longest:
            start = end - longest
        words.append(Word(text, start, max(start, end)))
    return words
