"""Background sounds for voice training: other people talking, and rooms.

A one-time download, started from Settings, of two openly licensed corpora:

- LibriSpeech test-clean (CC BY 4.0, Panayotov et al. 2015), 40 speakers
  reading aloud: the people talking behind the user.
- DEMAND (CC BY-SA 3.0, Thiemann et al. 2013) restaurant, office and living
  room recordings: the rooms.

About 0.6 GB is downloaded; Kass keeps about 350 MB, decoded to 16 kHz, in
``voice-training/sounds``. Nothing is sent anywhere.
"""

import io
import json
import logging
import shutil
import tarfile
import threading
import time
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

from . import root

logger = logging.getLogger(__name__)

VERSION = 1
LIBRISPEECH = [
    "https://www.openslr.org/resources/12/test-clean.tar.gz",
    "https://us.openslr.org/resources/12/test-clean.tar.gz",
]
DEMAND = {
    name: f"https://zenodo.org/records/1227121/files/{name}_16k.zip?download=1"
    for name in ("PRESTO", "OOFFICE", "DLIVING")
}
UTTERANCES_PER_SPEAKER = 30
DOWNLOAD_BYTES = 630_000_000  # test-clean plus three DEMAND rooms, for progress
CREDITS = [
    "LibriSpeech test-clean, CC BY 4.0 (Panayotov, Chen, Povey, Khudanpur 2015)",
    "DEMAND, CC BY-SA 3.0 (Thiemann, Ito, Vincent 2013)",
]

_lock = threading.Lock()
_progress: dict = {"state": None, "fraction": 0.0, "error": None}
_thread: threading.Thread | None = None


def _dir() -> Path:
    return root() / "sounds"


def ready() -> bool:
    try:
        info = json.loads((_dir() / "sounds.json").read_text())
        return info.get("version") == VERSION and (_dir() / "talk.npz").is_file() and (_dir() / "noise.npz").is_file()
    except (OSError, ValueError):
        return False


def status() -> dict:
    with _lock:
        if _thread and _thread.is_alive():
            return {"state": "downloading", "fraction": round(_progress["fraction"], 3), "error": None}
        if ready():
            return {"state": "ready", "fraction": 1.0, "error": None}
        return {"state": "failed" if _progress["error"] else "missing", "fraction": 0.0, "error": _progress["error"]}


def start() -> dict:
    """Begin the download in the background, unless it's done or running."""
    global _thread
    with _lock:
        if not (_thread and _thread.is_alive()) and not ready():
            _progress.update(state="downloading", fraction=0.0, error=None)
            _thread = threading.Thread(target=_download, daemon=True, name="voice-sounds")
            _thread.start()
    return status()


ATTEMPTS = 5


def _fetch(urls: list[str], target: Path, advance) -> None:
    """Download to ``target``, resuming after a dropped connection.

    Each attempt asks for the bytes it doesn't have yet; mirrors are tried in
    turn. Raises when every attempt fails or the file ends short.
    """
    error = None
    for attempt in range(ATTEMPTS):
        url = urls[attempt % len(urls)]
        have = target.stat().st_size if target.exists() else 0
        headers = {"User-Agent": "Kass"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response:
                if have and response.status != 206:
                    have = 0  # the server ignored the range: start over
                total = have + int(response.headers.get("Content-Length") or 0)
                with target.open("ab" if have else "wb") as out:
                    while chunk := response.read(1 << 20):
                        out.write(chunk)
                        advance(len(chunk))
            if not total or target.stat().st_size >= total:
                return
            error = OSError("the download ended early")
        except OSError as failure:
            error = failure
        logger.warning("Voice-training download interrupted (attempt %d): %s", attempt + 1, error)
        time.sleep(min(30, 2**attempt))
    raise error


def _decode(data: bytes) -> np.ndarray:
    import soundfile

    audio, rate = soundfile.read(io.BytesIO(data), dtype="int16", always_2d=False)
    if audio.ndim == 2:
        audio = audio.mean(axis=1).astype(np.int16)
    if rate != 16000:
        raise ValueError(f"Expected 16 kHz audio, got {rate}")
    return audio


def _download() -> None:
    staging = root() / "sounds.partial"
    try:
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir(parents=True)
        done = [0]

        def advance(count):
            done[0] += count
            _progress["fraction"] = min(0.99, done[0] / DOWNLOAD_BYTES)

        talk, speakers, per_speaker = [], [], defaultdict(int)
        speech = staging / "test-clean.tar.gz"
        _fetch(LIBRISPEECH, speech, advance)
        with tarfile.open(speech, mode="r|gz") as archive:
            for member in archive:
                if not member.name.endswith(".flac"):
                    continue
                speaker = member.name.split("/")[-3]
                if per_speaker[speaker] >= UTTERANCES_PER_SPEAKER:
                    continue
                per_speaker[speaker] += 1
                talk.append(_decode(archive.extractfile(member).read()))
                speakers.append(int(speaker))
        speech.unlink()
        np.savez(staging / "talk.npz", *talk, speakers=np.array(speakers))

        beds = {}
        for name, url in DEMAND.items():
            target = staging / f"{name}.zip"
            _fetch([url], target, advance)
            with zipfile.ZipFile(target) as archive:
                member = next(item for item in archive.namelist() if item.endswith("ch01.wav"))
                beds[name] = _decode(archive.read(member))
            target.unlink()
        np.savez(staging / "noise.npz", **beds)
        (staging / "sounds.json").write_text(
            json.dumps(
                {
                    "version": VERSION,
                    "talkers": len(per_speaker),
                    "utterances": len(talk),
                    "rooms": list(beds),
                    "credits": CREDITS,
                },
                indent=2,
            )
        )
        shutil.rmtree(_dir(), ignore_errors=True)
        staging.replace(_dir())
        _progress.update(state="ready", fraction=1.0, error=None)
    except Exception as error:
        logger.exception("Downloading the voice-training sounds failed")
        shutil.rmtree(staging, ignore_errors=True)
        _progress.update(state="failed", error=f"The download failed: {error}. Check the connection and try again.")


def load() -> tuple[list[np.ndarray], list[np.ndarray]]:
    """(talk utterances, room recordings) as float32 at 16 kHz."""
    with np.load(_dir() / "talk.npz") as archive:
        talk = [archive[key].astype(np.float32) / 32768 for key in archive.files if key != "speakers"]
    with np.load(_dir() / "noise.npz") as archive:
        beds = [archive[key].astype(np.float32) / 32768 for key in archive.files]
    return talk, beds
