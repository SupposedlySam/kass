#!/usr/bin/env python3
"""Public speech for the shared voice adapter, as voice-bank takes.

    uv run --with pyarrow --with soundfile --with numpy \
        python scripts/shared-adapters/unpack_voxpopuli.py
    backend/venv/bin/python scripts/shared-adapters/voice_data.py

Uses the VoxPopuli English utterances unpack_voxpopuli.py writes (CC0, European
Parliament speeches). Keeps up to 40 utterances per speaker, 1 to 28 seconds
long.

**Targets:** plain turbo's transcript of the clean audio, kept only when it
matches VoxPopuli's own transcript within 10% of words. The adapter learns
to write the same text with talk and noise behind the speaker, which is how
personal voice training labels a take, and turbo's transcripts carry the
capitals and punctuation the references lack.

**Split:** 15% of speakers are test speakers, never trained on; utterances
with no speaker id only train. Writes build/shared-adapters/voice-data/takes.json.
Transcribing waits for the Mac to be idle (idle.py). See
docs/plans/SHARED_ADAPTERS.md.
"""

import hashlib
import json
import os
import re
import sys
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from idle import interrupted, wait_for_idle  # noqa: E402

OUT = ROOT / "build" / "shared-adapters" / "voice-data"
PER_SPEAKER = 40
TEST_SHARE = 0.15


def utterances():
    """(speaker, id, reference text, 16 kHz float audio, WAV path) per kept utterance."""
    import soundfile

    counts = {}
    for line in (OUT / "source.jsonl").read_text().splitlines():
        item = json.loads(line)
        speaker = item["speaker"]
        if speaker is not None and counts.get(speaker, 0) >= PER_SPEAKER:
            continue
        y, rate = soundfile.read(item["audio"], dtype="float32")
        if rate != 16000 or not 1 <= len(y) / rate <= 28:
            continue
        counts[speaker] = counts.get(speaker, 0) + 1
        yield speaker, item["id"], item["reference"], y, Path(item["audio"])


def words(text):
    return re.findall(r"[a-z0-9']+", text.lower())


def word_errors(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def main():
    import mlx.core as mx

    from backend.backends import WHISPER_HF_REPOS, mlx_whisper_loader
    from backend.backends.base import local_model_path

    listing = OUT / "takes.json"
    takes = json.loads(listing.read_text()) if listing.is_file() else []
    done = {take["id"] for take in takes}
    rejected = set(json.loads((OUT / "rejected.json").read_text())) if (OUT / "rejected.json").is_file() else set()
    model = mlx_whisper_loader.load_whisper(local_model_path(WHISPER_HF_REPOS["turbo"], (".safetensors", ".npz")))
    for speaker, key, reference, y, path in utterances():
        if key in done or key in rejected:
            continue
        wait_for_idle()
        try:
            output = model.generate(mx.array(y), language="en")
        except RuntimeError as error:
            if not interrupted(error):
                raise
            continue  # picked up on the next run
        text = (output if isinstance(output, str) else output.text).strip()
        expected = words(reference)
        if not text or word_errors(words(text), expected) > 0.1 * len(expected):
            rejected.add(key)
            continue
        bucket = int(hashlib.sha256(speaker.encode()).hexdigest()[:8], 16) % 100 if speaker else 100
        takes.append(
            {
                "id": key,
                "speaker": speaker,
                "audio": str(path),
                "hash": hashlib.sha256(path.read_bytes()).hexdigest(),
                "text": text,
                "end": round(len(y) / 16000 / 0.02) * 0.02,
                "seconds": round(len(y) / 16000, 2),
                "created": len(takes),
                "split": "test" if bucket < TEST_SHARE * 100 else "train",
            }
        )
        if len(takes) % 50 == 0:
            listing.write_text(json.dumps(takes))
            (OUT / "rejected.json").write_text(json.dumps(sorted(rejected)))
            print(f"{len(takes)} takes, {len(rejected)} rejected", flush=True)
    listing.write_text(json.dumps(takes))
    (OUT / "rejected.json").write_text(json.dumps(sorted(rejected)))
    test = sum(take["split"] == "test" for take in takes)
    print(f"{len(takes) - test} training takes, {test} test takes, {len(rejected)} rejected")


if __name__ == "__main__":
    main()
