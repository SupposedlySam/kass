"""Data recorded against Herga's old bundle id moves to the new one."""

import pytest
from sqlalchemy import create_engine, inspect, text

from backend.database.migrations import _rename_own_bundle_id
from backend.services.styles import HERGA_BUNDLE

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


@pytest.mark.parametrize("old", ["sh.voicebox.app", "com.mrgnhnt.voicebox"])
def test_old_bundle_id_becomes_the_new_one_and_other_apps_stay(old):
    engine = _engine()
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO captures VALUES ('a', '{old}'), ('b', 'com.apple.Notes')"))
        conn.execute(text(f"INSERT INTO app_styles VALUES ('{old}', 'chat')"))
        conn.execute(text(f"INSERT INTO dictionary_entries VALUES ('d', 'app', '{old}', 'herga')"))
    for _ in range(2):
        _rename_own_bundle_id(engine, inspect(engine), TABLES)
    with engine.connect() as conn:
        assert dict(conn.execute(text("SELECT id, app_bundle_id FROM captures")).all()) == {
            "a": HERGA_BUNDLE,
            "b": "com.apple.Notes",
        }
        assert conn.execute(text("SELECT bundle_id, style_id FROM app_styles")).all() == [(HERGA_BUNDLE, "chat")]
        assert conn.execute(text("SELECT scope_id FROM dictionary_entries")).all() == [(HERGA_BUNDLE,)]


def test_a_row_already_under_the_new_id_wins():
    engine = _engine()
    with engine.begin() as conn:
        conn.execute(text(f"INSERT INTO app_styles VALUES ('{OLD}', 'chat'), ('{HERGA_BUNDLE}', 'personal')"))
        conn.execute(
            text(
                f"INSERT INTO dictionary_entries VALUES ('old', 'app', '{OLD}', 'k'), ('new', 'app', '{HERGA_BUNDLE}', 'k')"
            )
        )
    _rename_own_bundle_id(engine, inspect(engine), TABLES)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT bundle_id, style_id FROM app_styles")).all() == [(HERGA_BUNDLE, "personal")]
        assert conn.execute(text("SELECT id FROM dictionary_entries")).all() == [("new",)]


def test_the_old_database_file_is_carried_over_once(tmp_path):
    from backend.database.session import _rename_old_db

    (tmp_path / "voicebox.db").write_text("db")
    (tmp_path / "voicebox.db-wal").write_text("wal")
    _rename_old_db(tmp_path / "herga.db")
    assert (tmp_path / "herga.db").read_text() == "db"
    assert (tmp_path / "herga.db-wal").read_text() == "wal"
    assert not (tmp_path / "voicebox.db").exists()

    (tmp_path / "voicebox.db").write_text("stale")
    _rename_old_db(tmp_path / "herga.db")
    assert (tmp_path / "herga.db").read_text() == "db"
