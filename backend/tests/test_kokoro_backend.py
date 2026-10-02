"""Kokoro loads from Kass's own cached repo and never reaches the network once downloaded."""

import sys
import types
from pathlib import Path

import pytest

from backend.backends import kokoro_backend
from backend.backends.kokoro_backend import KOKORO_REPO, KokoroBackend


@pytest.fixture
def hub(monkeypatch, tmp_path):
    calls = []

    def snapshot_download(repo_id, local_files_only=False, **kwargs):
        calls.append((repo_id, local_files_only))
        return str(tmp_path / "snapshot")

    import huggingface_hub

    monkeypatch.setattr(huggingface_hub, "snapshot_download", snapshot_download)
    loaded = []
    utils = types.ModuleType("mlx_audio.tts.utils")
    utils.load_model = lambda path: loaded.append(path) or types.SimpleNamespace(repo_id=None)
    monkeypatch.setitem(sys.modules, "mlx_audio.tts.utils", utils)
    monkeypatch.setattr(kokoro_backend, "model_load_progress", lambda name, cached: _Nothing())
    return calls, loaded, tmp_path


class _Nothing:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_a_downloaded_model_loads_from_its_folder_without_the_network(hub, monkeypatch):
    calls, loaded, tmp_path = hub
    monkeypatch.setattr(KokoroBackend, "is_cached", lambda self: True)
    backend = KokoroBackend()
    backend._ensure_loaded_sync()
    assert calls == [(KOKORO_REPO, True)]
    assert loaded == [Path(tmp_path / "snapshot")]


def test_voices_come_from_kass_own_repo(hub, monkeypatch):
    monkeypatch.setattr(KokoroBackend, "is_cached", lambda self: True)
    backend = KokoroBackend()
    backend._ensure_loaded_sync()
    # Not mlx-audio's default (prince-canuma/Kokoro-82M), which it would fetch voices from.
    assert backend.model.repo_id == KOKORO_REPO


def test_a_missing_model_is_downloaded_first(hub, monkeypatch):
    calls, _, _ = hub
    monkeypatch.setattr(KokoroBackend, "is_cached", lambda self: False)
    KokoroBackend()._ensure_loaded_sync()
    assert calls == [(KOKORO_REPO, False)]
