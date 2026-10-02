"""Mix other people's speech and room noise under the user's voice.

All audio is mono float32 at 16 kHz. Levels are relative to the user's
speech: a talker "6 dB below" is 6 dB quieter than the user's active speech.
Training mixes are random (``training_mix``); evaluation mixes are fixed per
take and condition (``condition_mix``) so every model hears the same audio.
"""

import hashlib

import numpy as np

RATE = 16000
# Share of training examples left clean. More clean examples keep clean-take
# accuracy; 0.35 is what the second training round tested.
CLEAN_SHARE = 0.35
CONDITIONS = ("clean", "talk6", "talk0", "noise5")


def active_rms(y: np.ndarray) -> float:
    """RMS of the loudest 40% of 32 ms frames: the level while someone speaks."""
    frames = y[: len(y) // 512 * 512].reshape(-1, 512)
    if not len(frames):
        return float(np.sqrt(np.mean(y**2) + 1e-12))
    energy = (frames**2).mean(axis=1)
    return float(np.sqrt(energy[energy >= np.percentile(energy, 60)].mean() + 1e-12))


def _talker(rng, talk: list[np.ndarray], n: int, cover: float) -> tuple[np.ndarray, float]:
    """One person talking over ``cover`` of a clip, utterances joined by short pauses."""
    parts, total = [], 0
    while total < n:
        utterance = talk[rng.integers(len(talk))]
        gap = np.zeros(int(RATE * rng.uniform(0.05, 0.5)), np.float32)
        parts += [utterance, gap]
        total += len(utterance) + len(gap)
    speech = np.concatenate(parts)
    start = rng.integers(0, len(speech) - n + 1)
    speech = speech[start : start + n]
    span = int(n * cover)
    begin = rng.integers(0, n - span + 1)
    out = np.zeros(n, np.float32)
    out[begin : begin + span] = speech[begin : begin + span]
    return out, active_rms(speech)


def _colored(rng, n: int) -> np.ndarray:
    white = rng.standard_normal(n).astype(np.float32)
    spectrum = np.fft.rfft(white) / (np.arange(n // 2 + 1) + 1) ** rng.uniform(0, 1)
    return np.fft.irfft(spectrum, n).astype(np.float32)


def _noise(rng, beds: list[np.ndarray], n: int) -> tuple[np.ndarray, float]:
    usable = [bed for bed in beds if len(bed) > n]
    if not usable or rng.random() < 0.2:
        out = _colored(rng, n)
    else:
        bed = usable[rng.integers(len(usable))]
        start = rng.integers(0, len(bed) - n)
        out = bed[start : start + n].copy()
    return out, float(np.sqrt(np.mean(out**2) + 1e-12))


def _add(y, other, other_rms, user_rms, below_db):
    return y + other * (user_rms / max(other_rms, 1e-6)) * 10 ** (-below_db / 20)


def _finish(y: np.ndarray) -> np.ndarray:
    peak = float(np.abs(y).max()) if len(y) else 0.0
    return (y * (0.99 / peak) if peak > 0.99 else y).astype(np.float32)


def training_mix(rng, y, talk, beds, clean_share=CLEAN_SHARE) -> np.ndarray:
    """A random training example: clean, someone talking, noise, or both."""
    n, user = len(y), active_rms(y)
    roll = rng.random()
    rest = 1 - clean_share
    out = y.astype(np.float32)
    if roll < clean_share:
        pass
    elif roll < clean_share + 0.5 * rest:
        other, level = _talker(rng, talk, n, rng.uniform(0.5, 1.0))
        out = _add(out, other, level, user, rng.uniform(-3, 18))
        if rng.random() < 0.25:
            other, level = _talker(rng, talk, n, rng.uniform(0.5, 1.0))
            out = _add(out, other, level, user, rng.uniform(3, 20))
    elif roll < clean_share + 0.88 * rest:
        other, level = _noise(rng, beds, n)
        out = _add(out, other, level, user, rng.uniform(-3, 20))
    else:
        other, level = _talker(rng, talk, n, rng.uniform(0.5, 1.0))
        out = _add(out, other, level, user, rng.uniform(3, 18))
        other, level = _noise(rng, beds, n)
        out = _add(out, other, level, user, rng.uniform(5, 20))
    return _finish(out * 10 ** (rng.uniform(-6, 6) / 20))


def condition_mix(take_id: str, condition: str, y, talk, beds) -> np.ndarray:
    """The same mix of one take every time: for comparing models fairly."""
    if condition == "clean":
        return y.astype(np.float32)
    seed = int(hashlib.sha256(f"{take_id}:{condition}".encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    n, user = len(y), active_rms(y)
    if condition.startswith("talk"):
        other, level = _talker(rng, talk, n, 1.0)
    else:
        other, level = _noise(rng, beds, n)
    below = float(condition.removeprefix("talk").removeprefix("noise"))
    return _finish(_add(y.astype(np.float32), other, level, user, below))
