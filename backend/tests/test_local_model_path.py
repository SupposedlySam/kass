"""Downloaded models load from their cached folder, so loading never reaches the network."""

from pathlib import Path

import pytest

from backend.backends import base


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
