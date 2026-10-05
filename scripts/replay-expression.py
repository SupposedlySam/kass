#!/usr/bin/env python3
"""Measure how saved dictations were said, as phase 1 of expressive dictation does.

Run from the repository root with backend/venv/bin/python. Reads the Kass
database read-only and the captures' recordings; writes nothing to the data
directory. Each recording is recognized whole (one phrase), its voice tracked
in 100 ms chunks as it would arrive, and measured against a baseline from the
user's earlier dictations (docs/plans/EXPRESSIVE_DICTATION.md).

    backend/venv/bin/python scripts/replay-expression.py --since "2026-10-05 19:35"
    backend/venv/bin/python scripts/replay-expression.py ID [ID ...] --baseline 80
"""

import argparse
import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DATA = Path.home() / "Library/Application Support/com.mrgnhnt.kass"
# Whisper decodes 30 s at a time; a longer recording has no single alignment.
MAX_MS = 29000


async def measure_capture(data, audio_path, baseline, language):
    from backend.services import prosody
    from backend.services.transcribe import get_whisper_model

    with wave.open(str(data / audio_path)) as audio:
        rate = audio.getframerate()
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2")
    expression = prosody.Expression(rate)
    for start in range(0, len(samples), rate // 10):
        expression.feed(samples[start : start + rate // 10])
    alignments = []
    text = await get_whisper_model().transcribe_array(
        samples, rate, language, "turbo", check_speech=False, alignments=alignments
    )
    if alignments:
        expression.phrase(alignments[0], 0, released=True)
    return text.strip(), await expression.measure(baseline)


async def main(args):
    from backend import config
    from backend.services import prosody

    database = sqlite3.connect(f"file:{args.data / 'kass.db'}?mode=ro", uri=True)
    dictations = "audio_deleted = 0 and command_instruction is null and duration_ms between 1000 and ?"
    if args.ids:
        marks = ",".join("?" * len(args.ids))
        chosen = database.execute(
            f"select id, audio_path, created_at from captures where id in ({marks}) order by created_at",
            args.ids,
        ).fetchall()
    else:
        chosen = database.execute(
            f"select id, audio_path, created_at from captures where {dictations} and created_at >= ? "
            "order by created_at",
            (MAX_MS, args.since),
        ).fetchall()
    if not chosen:
        sys.exit("No captures matched.")
    earliest = min(row[2] for row in chosen)
    earlier = database.execute(
        f"select audio_path from captures where {dictations} and duration_ms >= 2000 and created_at < ? "
        "order by created_at desc limit ?",
        (MAX_MS, earliest, args.baseline),
    ).fetchall()

    with tempfile.TemporaryDirectory(prefix="kass-replay-") as directory:
        config.set_data_dir(directory)
        sentences = []
        for (audio_path,) in earlier:
            if (args.data / audio_path).exists():
                _, measured = await measure_capture(
                    args.data, audio_path, None, args.language
                )
                sentences += (measured or {}).get("sentences", [])
        baseline = prosody.Baseline.of(sentences)
        print(
            json.dumps(
                {
                    "baseline": baseline.__dict__ if baseline else None,
                    "from_sentences": len(sentences),
                }
            )
        )
        for capture_id, audio_path, _ in chosen:
            if not (args.data / audio_path).exists():
                continue
            text, measured = await measure_capture(
                args.data, audio_path, baseline, args.language
            )
            print(
                json.dumps({"id": capture_id, "text": text, "measured": measured}),
                flush=True,
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "ids", nargs="*", help="capture ids (default: every dictation since --since)"
    )
    parser.add_argument(
        "--since",
        default="1970-01-01",
        help="created_at lower bound, e.g. '2026-10-05 19:35'",
    )
    parser.add_argument(
        "--baseline",
        type=int,
        default=80,
        help="earlier dictations to take the baseline from",
    )
    parser.add_argument("--language", default="en")
    parser.add_argument("--data", type=Path, default=DATA)
    asyncio.run(main(parser.parse_args()))
