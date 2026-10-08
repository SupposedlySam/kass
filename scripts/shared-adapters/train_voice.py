#!/usr/bin/env python3
"""Train and score the shared voice adapter on public speech.

    backend/venv/bin/python scripts/shared-adapters/voice_data.py
    backend/venv/bin/python scripts/shared-adapters/train_voice.py --updates 2000
    backend/venv/bin/python scripts/shared-adapters/train_voice.py --score
    backend/venv/bin/python scripts/shared-adapters/train_voice.py --score --mine

Trains with Kass's own voice trainer (voice_training/train.py): the speaker's
take mixed with other people talking and rooms, the same mixes and settings
personal training uses, in rounds of about five minutes that each continue
from the last. A round runs only while the Mac is idle (idle.py), and one
that macOS stops is run again. Writes build/shared-adapters/voice-turbo/.

--score transcribes the test speakers' takes clean, with talk at -6 and 0 dB
and in a room, with plain turbo and the adapter (voice_training/gate.py).
--mine scores the test takes in this Mac's own voice bank instead, against
the voice model it uses now too; they stay on this Mac. Needs the background sounds from Settings › Transcription.
See docs/plans/SHARED_ADAPTERS.md.
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

os.environ["HF_HUB_OFFLINE"] = "1"
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from idle import interrupted, wait_for_idle  # noqa: E402

DATA = ROOT / "build" / "shared-adapters" / "voice-data"
OUT = ROOT / "build" / "shared-adapters" / "voice-turbo"
ROUNDS = ROOT / "build" / "shared-adapters" / "voice-rounds"
# A copy of the adapter after every round: more training isn't always better
# on real dictation (docs/plans/SHARED_ADAPTERS.md).
SNAPSHOTS = ROOT / "build" / "shared-adapters" / "voice-snapshots"
KASS = Path.home() / "Library" / "Application Support" / "com.mrgnhnt.kass"
ROUND_SECONDS = 300
ROUND_UPDATES = 80


def use_sounds():
    """Point Kass's data folder at a scratch one that holds only the downloaded sounds."""
    from backend import config

    sounds = KASS / "voice-training" / "sounds"
    if not (sounds / "talk.npz").is_file():
        raise SystemExit("Download the background sounds first: Settings › Transcription › Voice training.")
    scratch = Path(tempfile.mkdtemp(prefix="kass-voice-"))
    (scratch / "voice-training").mkdir()
    (scratch / "voice-training" / "sounds").symlink_to(sounds)
    config.set_data_dir(scratch)


def voice_plan(takes, resume=None, production=None):
    from backend.backends import WHISPER_HF_REPOS

    return {
        "voice": {
            "repo": WHISPER_HF_REPOS["turbo"],
            "takes": takes,
            "room": [],
            "language": "en",
            "resume": resume,
            "production": production,
            "corrections": [],
            "train_seconds": ROUND_SECONDS,
            "max_updates": ROUND_UPDATES,
        }
    }


def train(updates):
    from backend.services.voice_training import train as voice_training

    use_sounds()
    takes = json.loads((DATA / "takes.json").read_text())
    ROUNDS.mkdir(parents=True, exist_ok=True)
    done = json.loads((OUT / "progress.json").read_text())["updates"] if (OUT / "progress.json").is_file() else 0
    while done < updates:
        wait_for_idle()
        directory = Path(tempfile.mkdtemp(dir=ROUNDS))
        resume = str(OUT) if (OUT / "adapter.safetensors").is_file() else None
        try:
            report = voice_training.train(voice_plan(takes, resume), directory)
        except RuntimeError as error:
            if not interrupted(error):
                raise
            print(f"interrupted by macOS at {done} updates; running the round again", flush=True)
            shutil.rmtree(directory)
            continue
        # The round's adapter becomes the one the next round continues from.
        OUT.mkdir(parents=True, exist_ok=True)
        for item in (directory / "voice").iterdir():
            shutil.copy2(item, OUT / item.name)
        shutil.rmtree(directory)
        done += report["updates"]
        (OUT / "progress.json").write_text(json.dumps({"updates": done, "last_round": report}, indent=2))
        shutil.copytree(OUT, SNAPSHOTS / str(done), dirs_exist_ok=True)
        print(f"{done}/{updates} updates, loss {report['loss_first']} → {report['loss_last']}", flush=True)


def score(mine, out, adapter=None):
    from backend import config
    from backend.services.voice_training import train as voice_training

    production = None
    if mine:
        from backend.services.voice_training import bank

        config.set_data_dir(KASS)
        takes = [dict(take, hash=hashlib.sha256(Path(take["audio"]).read_bytes()).hexdigest()) for take in bank.takes()]
        # The same test takes personal training scores, against the voice
        # model this Mac uses now as well as plain turbo.
        voice_training.EVAL_TAKES = 40
        state = json.loads((KASS / "model-improvement" / "state.json").read_text())
        production = state["active"].get("voice", {}).get("path")
    else:
        use_sounds()
        takes = json.loads((DATA / "takes.json").read_text())
        voice_training.EVAL_TAKES = 120
    wait_for_idle()
    directory = Path(tempfile.mkdtemp(prefix="kass-voice-score-"))
    (directory / "voice").symlink_to(Path(adapter).resolve() if adapter else OUT)
    result = voice_training.evaluate(voice_plan(takes, production=production), directory)
    metrics = result["metrics"]
    print(json.dumps({key: value for key, value in metrics.items() if key != "rows"}, indent=2))
    if out:
        # publish.py checks these are the weights it ships.
        weights = (Path(adapter) if adapter else OUT) / "adapter.safetensors"
        result["adapter_sha256"] = hashlib.sha256(weights.read_bytes()).hexdigest()
        Path(out).write_text(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--updates", type=int, default=2000, help="Total updates to train to")
    parser.add_argument("--score", action="store_true")
    parser.add_argument("--mine", action="store_true", help="Score on this Mac's own test takes")
    parser.add_argument("--out", help="With --score, write every transcript to this JSON file")
    parser.add_argument("--adapter", help="With --score, the adapter to score (default the trained one)")
    args = parser.parse_args()
    if args.score:
        score(args.mine, args.out, args.adapter)
    else:
        train(args.updates)


if __name__ == "__main__":
    main()
