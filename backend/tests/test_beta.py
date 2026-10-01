"""Beta features run only while the app has the beta channel on."""

import pytest

from backend import beta, config


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_data_dir", tmp_path)
    monkeypatch.setattr(beta, "BETA_FEATURES", frozenset({"new_thing"}))
    return tmp_path


def test_off_without_the_channel_file(data_dir):
    assert not beta.enabled("new_thing")


def test_on_for_the_beta_channel(data_dir):
    (data_dir / beta.CHANNEL_FILE).write_text("beta")
    assert beta.enabled("new_thing")


def test_follows_the_setting_without_a_restart(data_dir):
    channel = data_dir / beta.CHANNEL_FILE
    channel.write_text("beta")
    assert beta.enabled("new_thing")
    channel.unlink()
    assert not beta.enabled("new_thing")


def test_a_feature_not_in_the_list_is_an_error(data_dir):
    with pytest.raises(ValueError, match="isn't in BETA_FEATURES"):
        beta.enabled("gone_public")
