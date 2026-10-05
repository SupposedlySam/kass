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


def to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    """16-bit PCM WAV, which NSSound plays directly."""
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


async def speak(text: str, voice: str, speed: float) -> bytes:
    """One piece of a reading, as WAV."""
    from ..backends import get_speech_backend
    from ..backends.kokoro_backend import SAMPLE_RATE

    text = validate_text(text)
    voice = validate_voice(voice)
    ensure_model_ready()
    samples = await get_speech_backend().synthesize(
        pronounce_letters(text), voice, min(max(speed, MIN_SPEED), MAX_SPEED)
    )
    return to_wav(samples, SAMPLE_RATE)
