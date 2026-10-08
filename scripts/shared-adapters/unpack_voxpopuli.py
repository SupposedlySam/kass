#!/usr/bin/env python3
"""Unpack VoxPopuli English into WAV files for voice_data.py.

    uv run --with pyarrow --with soundfile --with numpy \
        python scripts/shared-adapters/unpack_voxpopuli.py

Downloads the validation and test splits of VoxPopuli English (CC0, Wang et
al. 2021; European Parliament speeches, about 1.9 GB) and writes each
utterance as 16 kHz WAV with build/shared-adapters/voice-data/source.jsonl
listing them: id, speaker, reference text and audio path. Runs in its own
environment because the app's venv has no Parquet reader.

Parliament speakers talk into microphones at their own pace, closer to
dictation than audiobooks, and unlike the audiobook readers Kass mixes in
as people talking in the background (voice_training/sounds.py). Training on
audiobook speakers taught the adapter to follow audiobook speech, so it
wrote down the background talker instead of the user. See
docs/plans/SHARED_ADAPTERS.md.
"""

import io
import json
import urllib.request
import wave
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import soundfile

ROOT = Path(__file__).resolve().parents[2]
DOWNLOADS = ROOT / "build" / "shared-adapters" / "voxpopuli"
OUT = ROOT / "build" / "shared-adapters" / "voice-data"
URL = "https://huggingface.co/datasets/facebook/voxpopuli/resolve/main/en/{split}-00000-of-00001.parquet"
SPLITS = ("validation", "test")


def download(split):
    path = DOWNLOADS / f"{split}.parquet"
    if not path.is_file():
        DOWNLOADS.mkdir(parents=True, exist_ok=True)
        print(f"downloading {split}", flush=True)
        urllib.request.urlretrieve(URL.format(split=split), path.with_suffix(".part"))
        path.with_suffix(".part").rename(path)
    return path


def main():
    (OUT / "source").mkdir(parents=True, exist_ok=True)
    rows = []
    for split in SPLITS:
        table = pq.ParquetFile(download(split))
        for group in range(table.num_row_groups):
            columns = ["audio_id", "audio", "normalized_text", "speaker_id"]
            for item in table.read_row_group(group, columns=columns).to_pylist():
                y, rate = soundfile.read(io.BytesIO(item["audio"]["bytes"]), dtype="float32")
                if rate != 16000 or y.ndim != 1:
                    continue
                path = OUT / "source" / f"{item['audio_id']}.wav"
                with wave.open(str(path), "wb") as out:
                    out.setnchannels(1)
                    out.setsampwidth(2)
                    out.setframerate(16000)
                    out.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
                rows.append(
                    {
                        "id": item["audio_id"],
                        # Utterances with no speaker id only ever train.
                        "speaker": item["speaker_id"],
                        "reference": item["normalized_text"],
                        "audio": str(path),
                    }
                )
    (OUT / "source.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    print(f"{len(rows)} utterances from {len({row['speaker'] for row in rows})} speakers")


if __name__ == "__main__":
    main()
