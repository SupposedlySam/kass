"""Data recorded against Kass's old bundle id moves to the new one."""

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.database.migrations import _rename_own_bundle_id
from backend.services.styles import KASS_BUNDLE

OLD = "sh.voicebox.app"
TABLES = {"captures", "app_styles", "dictionary_entries"}


def _engine():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE captures (id VARCHAR PRIMARY KEY, app_bundle_id VARCHAR)"))
        conn.execute(text("CREATE TABLE app_styles (bundle_id VARCHAR PRIMARY KEY, style_id VARCHAR)"))
        conn.execute(
            text(
                "CREATE TABLE dictionary_entries (id VARCHAR PRIMARY KEY, scope VARCHAR, scope_id VARCHAR,"
                " key VARCHAR, UNIQUE (scope, scope_id, key))"
            )
        )
    return engine


@pytest.mark.parametrize("old", ["sh.voicebox.app", "com.mrgnhnt.voicebox", "com.mrgnhnt.herga"])
def test_old_bundle_id_becomes_the_new_one_and_other_apps_stay(old):
    engine = _engine()
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO captures VALUES ('a', '{old}'), ('b', 'com.apple.Notes')"))
        conn.execute(text(f"INSERT INTO app_styles VALUES ('{old}', 'chat')"))
        conn.execute(text(f"INSERT INTO dictionary_entries VALUES ('d', 'app', '{old}', 'kass')"))
    for _ in range(2):
        _rename_own_bundle_id(engine, inspect(engine), TABLES)
    with engine.connect() as conn:
        assert dict(conn.execute(text("SELECT id, app_bundle_id FROM captures")).all()) == {
            "a": KASS_BUNDLE,
            "b": "com.apple.Notes",
        }
        assert conn.execute(text("SELECT bundle_id, style_id FROM app_styles")).all() == [(KASS_BUNDLE, "chat")]
        assert conn.execute(text("SELECT scope_id FROM dictionary_entries")).all() == [(KASS_BUNDLE,)]


def test_a_row_already_under_the_new_id_wins():
    engine = _engine()
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO app_styles VALUES ('{OLD}', 'chat'), ('{KASS_BUNDLE}', 'personal')"))
        conn.execute(
            text(
                f"INSERT INTO dictionary_entries VALUES ('old', 'app', '{OLD}', 'k'), ('new', 'app', '{KASS_BUNDLE}', 'k')"
            )
        )
    _rename_own_bundle_id(engine, inspect(engine), TABLES)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT bundle_id, style_id FROM app_styles")).all() == [(KASS_BUNDLE, "personal")]
        assert conn.execute(text("SELECT id FROM dictionary_entries")).all() == [("new",)]


def test_the_old_database_file_is_carried_over_once(tmp_path):
    from backend.database.session import _rename_old_db

    (tmp_path / "voicebox.db").write_text("db")
    (tmp_path / "voicebox.db-wal").write_text("wal")
    _rename_old_db(tmp_path / "kass.db")
    assert (tmp_path / "kass.db").read_text() == "db"
    assert (tmp_path / "kass.db-wal").read_text() == "wal"
    assert not (tmp_path / "voicebox.db").exists()

    (tmp_path / "voicebox.db").write_text("stale")
    _rename_old_db(tmp_path / "kass.db")
    assert (tmp_path / "kass.db").read_text() == "db"


def test_the_herga_database_file_wins_over_an_older_voicebox_one(tmp_path):
    from backend.database.session import _rename_old_db

    (tmp_path / "herga.db").write_text("herga")
    (tmp_path / "voicebox.db").write_text("voicebox")
    _rename_old_db(tmp_path / "kass.db")
    assert (tmp_path / "kass.db").read_text() == "herga"
    assert not (tmp_path / "herga.db").exists()
