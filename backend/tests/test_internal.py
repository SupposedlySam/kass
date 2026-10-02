"""Internal features run only on builds installed from a checkout."""

import pytest

from backend import config, internal


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_data_dir", tmp_path)
    monkeypatch.setattr(internal, "INTERNAL_FEATURES", frozenset({"new_thing"}))
    return tmp_path


def test_off_without_the_marker_file(data_dir):
    assert not internal.enabled("new_thing")


def test_follows_the_marker_without_a_restart(data_dir):
    marker = data_dir / internal.MARKER_FILE
    marker.touch()
    assert internal.enabled("new_thing")
    marker.unlink()
    assert not internal.enabled("new_thing")


def test_a_feature_not_in_the_list_is_an_error(data_dir):
    with pytest.raises(ValueError, match="isn't in INTERNAL_FEATURES"):
        internal.enabled("moved_to_beta")
