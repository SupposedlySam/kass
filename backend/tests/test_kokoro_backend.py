"""Downloaded models load from their cached folder, so loading never reaches the network."""

import sys
import types
from pathlib import Path

import pytest

from backend.backends import base, kokoro_backend
from backend.backends.kokoro_backend import KOKORO_REPO, KokoroBackend


@pytest.fixture
def hub(monkeypatch, tmp_path):
    """snapshot_download that records how it was called, and a cache to say what's downloaded."""
    calls = []
    cached = set()

    def snapshot_download(repo_id, local_files_only=False, **kwargs):
        calls.append((repo_id, local_files_only))
        return str(tmp_path / "hub" / f"models--{repo_id.replace('/', '--')}" / "snapshots" / "abc")

    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "snapshot_download", snapshot_download)
    monkeypatch.setattr(base, "is_model_cached", lambda repo, **kwargs: repo in cached)
    return calls, cached, tmp_path


def test_a_downloaded_model_is_its_cached_folder_without_asking_the_hub(hub):
    calls, cached, tmp_path = hub
    cached.add("openai/whisper-large-v3-turbo")
    path = base.local_model_path("openai/whisper-large-v3-turbo")
    assert path == tmp_path / "hub" / "models--openai--whisper-large-v3-turbo" / "snapshots" / "abc"
    # A Path, whose parts keep the repo name mlx-audio reads the model type from.
    assert isinstance(path, Path)
    assert calls == [("openai/whisper-large-v3-turbo", True)]


def test_a_model_not_downloaded_yet_is_left_to_the_library_to_fetch(hub):
    calls, _, _ = hub
    assert base.local_model_path("mlx-community/Qwen3-0.6B-4bit") == "mlx-community/Qwen3-0.6B-4bit"
    assert calls == []


def test_a_local_path_is_used_as_it_is(hub, tmp_path):
    calls, _, _ = hub
    assert base.local_model_path(str(tmp_path)) == str(tmp_path)
    assert calls == []


def test_kokoro_loads_from_its_folder_and_reads_voices_from_kass_repo(hub, monkeypatch):
    calls, cached, tmp_path = hub
    cached.add(KOKORO_REPO)
    loaded = []
    utils = types.ModuleType("mlx_audio.tts.utils")
    utils.load_model = lambda path: loaded.append(path) or types.SimpleNamespace(repo_id=None)
    monkeypatch.setitem(sys.modules, "mlx_audio.tts.utils", utils)
    monkeypatch.setattr(kokoro_backend, "model_load_progress", lambda name, cached: _Nothing())
    backend = KokoroBackend()
    backend._ensure_loaded_sync()
    assert loaded == [tmp_path / "hub" / "models--mlx-community--Kokoro-82M-bf16" / "snapshots" / "abc"]
    assert calls == [(KOKORO_REPO, True)]
    # Not mlx-audio's default (prince-canuma/Kokoro-82M), which it would fetch voices from.
    assert backend.model.repo_id == KOKORO_REPO


class _Nothing:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False
