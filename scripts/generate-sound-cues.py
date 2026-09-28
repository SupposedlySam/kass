#!/usr/bin/env python3
"""Generate the dictation sound cues bundled with the desktop app.

Writes start.wav, stop.wav and error.wav (16-bit mono, 44.1 kHz) into
tauri/src-tauri/sounds/, where `sound_cues.rs` embeds them. Standard library
only; rerun after changing a cue and commit the WAVs:

    python3 scripts/generate-sound-cues.py [output-dir]
"""

import math
import struct
import sys
import wave
from pathlib import Path

RATE = 44100
OUT_DIR = Path(__file__).resolve().parents[1] / "tauri" / "src-tauri" / "sounds"


def tone(freqs, seconds, volume=0.35, harmonic=0.15):
    """A chord of sine tones with a 5 ms attack and a soft exponential decay."""
    samples = []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        envelope = min(1, t / 0.005) * math.exp(-t * 9)
        s = sum(
            math.sin(2 * math.pi * f * t) + harmonic * math.sin(4 * math.pi * f * t)
            for f in freqs
        ) / len(freqs)
        samples.append(s * envelope * volume)
    return samples


def sequence(*parts, gap=0.0):
    samples = []
    for part in parts:
        samples += part + [0.0] * int(RATE * gap)
    return samples


def save(path, samples):
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(
            b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples)
        )


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT_DIR
    out.mkdir(parents=True, exist_ok=True)
    save(out / "start.wav", tone([523.25, 659.25, 783.99], 0.22))  # C major blip
    save(out / "stop.wav", tone([392.0, 493.88, 587.33], 0.22))  # G major blip
    save(out / "error.wav", sequence(tone([330], 0.1), tone([262], 0.18), gap=0.02))
    print(f"wrote start.wav, stop.wav, error.wav to {out}")


if __name__ == "__main__":
    main()
