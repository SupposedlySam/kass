"""Read Aloud: speak a selection with Kokoro (docs/plans/READ_ALOUD.md).

The desktop app asks for the sentences of a selection, then for each one's
audio while the one before it plays.
"""

import io
import re

import numpy as np
import soundfile as sf

from .commands import MAX_SELECTION_CHARS

# Kokoro's English voices: "a" American, "b" British; "f" female, "m" male.
VOICES: dict[str, str] = {
    "af_heart": "Heart",
    "af_alloy": "Alloy",
    "af_aoede": "Aoede",
    "af_bella": "Bella",
    "af_jessica": "Jessica",
    "af_kore": "Kore",
    "af_nicole": "Nicole",
    "af_nova": "Nova",
    "af_river": "River",
    "af_sarah": "Sarah",
    "af_sky": "Sky",
    "am_adam": "Adam",
    "am_echo": "Echo",
    "am_eric": "Eric",
    "am_fenrir": "Fenrir",
    "am_liam": "Liam",
    "am_michael": "Michael",
    "am_onyx": "Onyx",
    "am_puck": "Puck",
    "am_santa": "Santa",
    "bf_alice": "Alice",
    "bf_emma": "Emma",
    "bf_isabella": "Isabella",
    "bf_lily": "Lily",
    "bm_daniel": "Daniel",
    "bm_fable": "Fable",
    "bm_george": "George",
    "bm_lewis": "Lewis",
}
DEFAULT_VOICE = "af_heart"
MIN_SPEED = 0.5
MAX_SPEED = 2.0

# A sentence ends at ., ! or ? before whitespace, keeping up to two closing
# quotes or brackets after it ('"no."', "(quietly.)"), or at a line break.
# Escaped for a character class: ] would end it.
_CLOSERS = "\"'”’)\\]"
_SENTENCE_END = re.compile(rf"(?<=[.!?…])\s+|(?<=[.!?…][{_CLOSERS}])\s+|(?<=[.!?…][{_CLOSERS}][{_CLOSERS}])\s+|\n+")
# One request should stay short so playback starts fast and dictation never
# waits long behind it on the MLX thread.
MAX_SENTENCE_CHARS = 300
# Shorter pieces ("Hi.", "1.") join the next one, so the voice doesn't pause after each.
MIN_SENTENCE_CHARS = 12


def _split_long(sentence: str) -> list[str]:
    """``sentence`` in pieces of at most MAX_SENTENCE_CHARS, at commas or semicolons, else at spaces."""
    if len(sentence) <= MAX_SENTENCE_CHARS:
        return [sentence]
    pieces: list[str] = []
    rest = sentence
    while len(rest) > MAX_SENTENCE_CHARS:
        window = rest[:MAX_SENTENCE_CHARS]
        cut = max(window.rfind(", "), window.rfind("; "), window.rfind(": "))
        if cut < MAX_SENTENCE_CHARS // 3:
            cut = window.rfind(" ")
        cut = cut + 1 if cut > 0 else MAX_SENTENCE_CHARS
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


# Where a list item can begin: a line's start, or straight after the end of
# the item before it, when the list arrived without line breaks (Electron
# apps' Accessibility text runs "Merge #2169.2. Merge main" together).
_ITEM_STARTS = r"(?:^|(?<=[.!?…:;)\"'”’])[ \t]*)"


def separate_list_items(text: str) -> str:
    """``text`` with each numbered item on its own line.

    Only a run that counts up from 1 is a list, so "version 0.7.3. Then"
    isn't split.
    """
    found: list[re.Match] = []
    pos = 0
    while True:
        item = re.compile(rf"{_ITEM_STARTS}({len(found) + 1})[.)][ \t]+(?=\S)", re.M).search(text, pos)
        if not item:
            break
        found.append(item)
        pos = item.end()
    if len(found) < 2:
        return text
    for item in reversed(found):
        start = item.start(1)
        if start > 0 and text[start - 1] != "\n":
            text = text[:start].rstrip(" \t") + "\n" + text[start:]
    return text


def split_sentences(text: str) -> list[str]:
    """The pieces ``text`` is read in, in order: sentences, with long ones split and short ones joined."""
    sentences: list[str] = []
    for part in _SENTENCE_END.split(text):
        part = " ".join(part.split())
        if not part:
            continue
        if sentences and len(sentences[-1]) < MIN_SENTENCE_CHARS:
            part = f"{sentences.pop()} {part}"
        sentences.extend(_split_long(part))
    return sentences


# misaki reads a capital "A" that starts a sentence as the article ("uh or B?").
# One followed by punctuation, the end, or "or"/"and" can only be the letter,
# so it gets the letter's phonemes, in misaki's [word](/phonemes/) form.
_LETTER_A = re.compile(r"(?<![\w'’\[])A(?![\w'’\]])(?=\s*(?:[,.;:!?)…\"”]|$|(?:or|and|nor|versus|vs)\b))")
_LETTER_A_SAID = "[A](/ˈA/)"


def pronounce_letters(text: str) -> str:
    """``text`` with each lone letter "A" marked to be said "ay", never "uh"."""
    return _LETTER_A.sub(_LETTER_A_SAID, text)


def validate_text(text: str) -> str:
    """``text`` stripped, or a ValueError the app shows."""
    text = text.strip()
    if not text:
        raise ValueError("Select text to read aloud first")
    if len(text) > MAX_SELECTION_CHARS:
        raise ValueError(f"Read Aloud reads up to {MAX_SELECTION_CHARS:,} characters at a time")
    return text


def validate_voice(voice: str) -> str:
    if voice not in VOICES:
        raise ValueError(f"Unknown voice {voice}")
    return voice


def ensure_model_ready() -> None:
    """Fail clearly when Kokoro isn't downloaded, instead of fetching it mid-reading."""
    from ..backends import get_speech_backend

    if not get_speech_backend().is_cached():
        raise ValueError("Download Kokoro in Models to use Read Aloud")


# A piece that starts a numbered item ("2: Merge main", or "2. Merge main"
# read as written) is said as its number, a pause, then the item, after a
# pause of its own. Pieces play back to back, so without that the last item
# would run straight into the next one's number.
_NUMBERED_ITEM = re.compile(r"^(\d{1,3})[.:)]\s+(?=\S)")
PAUSE_BEFORE_ITEM_SECONDS = 0.35
PAUSE_AFTER_NUMBER_SECONDS = 0.15
# Quieter than this is the silence Kokoro puts around what it says.
_SILENT = 0.01


def _trimmed(samples: np.ndarray) -> np.ndarray:
    """``samples`` without the silence Kokoro leaves before and after the words."""
    loud = np.flatnonzero(np.abs(samples) >= _SILENT)
    return samples[loud[0] : loud[-1] + 1] if loud.size else samples[:0]


async def _synthesize(text: str, voice: str, speed: float) -> np.ndarray:
    from ..backends import get_speech_backend

    return np.asarray(await get_speech_backend().synthesize(pronounce_letters(text), voice, speed)).reshape(-1)


async def _synthesize_piece(text: str, voice: str, speed: float, sample_rate: int) -> np.ndarray:
    item = _NUMBERED_ITEM.match(text)
    if not item:
        return await _synthesize(text, voice, speed)
    number = _trimmed(await _synthesize(f"{item.group(1)}.", voice, speed))
    words = await _synthesize(text[item.end() :], voice, speed)

    def silence(seconds: float) -> np.ndarray:
        return np.zeros(int(seconds * sample_rate), dtype=words.dtype)

    return np.concatenate([silence(PAUSE_BEFORE_ITEM_SECONDS), number, silence(PAUSE_AFTER_NUMBER_SECONDS), words])


def to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    """16-bit PCM WAV, which NSSound plays directly."""
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


async def speak(text: str, voice: str, speed: float) -> bytes:
    """One piece of a reading, as WAV."""
    from ..backends.kokoro_backend import SAMPLE_RATE

    text = validate_text(text)
    voice = validate_voice(voice)
    ensure_model_ready()
    samples = await _synthesize_piece(text, voice, min(max(speed, MIN_SPEED), MAX_SPEED), SAMPLE_RATE)
    return to_wav(samples, SAMPLE_RATE)
