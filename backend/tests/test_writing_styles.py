"""Per-app writing styles: presets, migration, assignment, and what each style learns."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import config
from backend.database import get_db
from backend.database import session as database_session
from backend.database.models import AppStyle, Base, Capture, CaptureFeedback, CaptureSettings, WritingStyle
from backend.models import CaptureSettingsResponse
from backend.services import correction_notes, personal_examples, styles, writing_style
from backend.services.refinement import RefinementFlags, build_refinement_prompt, style_first_word

SLACK, MAIL = "com.tinyspeck.slackmacgap", "com.apple.mail"


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_data_dir", tmp_path)
    monkeypatch.setattr(writing_style, "_state", None)
    monkeypatch.setattr(correction_notes, "_state", None)
    monkeypatch.setattr(personal_examples, "_cache", None)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine)
    monkeypatch.setattr(database_session, "SessionLocal", make)
    return make


def seed(storage, **saved):
    with storage() as db:
        if saved:
            db.add(CaptureSettings(id=1, **saved))
            db.commit()
        styles.ensure_styles(db)


def correct(storage, capture_id, app, said, meant):
    with storage() as db:
        db.add(Capture(id=capture_id, audio_path="a.wav", transcript_raw=said, app_bundle_id=app))
        db.add(
            CaptureFeedback(
                capture_id=capture_id,
                target="refined",
                expected_text=meant,
                snapshot=json.dumps({"transcript_raw": said, "transcript_refined": said, "app_bundle_id": app}),
            )
        )
        db.commit()
    personal_examples.invalidate()


def test_presets_take_the_global_settings_into_work(storage):
    seed(storage, smart_cleanup=False, preserve_technical=False, punctuation_style="learned")
    snapshot = styles.snapshot()
    assert [s.name for s in snapshot.styles] == ["Chat", "Work", "Formal", "Code"]
    work = snapshot.default
    assert work.id == "work"
    # Dictation keeps working exactly as before until an app is assigned.
    assert (work.punctuation_style, work.capitalize_first, work.smart_cleanup, work.preserve_technical) == (
        "learned",
        True,
        False,
        False,
    )
    assert snapshot.for_app(SLACK) == work
    # Seeding again changes nothing.
    seed(storage)
    assert styles.snapshot().styles == snapshot.styles


def test_a_fresh_install_gets_the_presets(storage):
    seed(storage)
    chat = styles.snapshot().get("chat")
    assert (chat.punctuation_style, chat.capitalize_first, chat.smart_cleanup) == ("casual", False, False)
    assert styles.snapshot().default.punctuation_style == "standard"


def test_assigning_an_app_confirms_it_and_picks_its_flags(storage):
    seed(storage)
    with storage() as db:
        styles.assign_app(db, SLACK, "Slack", "chat")
    snapshot = styles.snapshot()
    assert snapshot.for_app(SLACK).id == "chat"
    assert snapshot.apps == {SLACK: "chat"}
    flags = styles.flags_for_app(SLACK, CaptureSettingsResponse(self_correction=False))
    assert flags == RefinementFlags(
        smart_cleanup=False,
        self_correction=False,
        preserve_technical=True,
        punctuation_style="casual",
        capitalize_first=False,
        style="chat",
    )


def test_styles_are_created_renamed_and_deleted(storage):
    seed(storage)
    with storage() as db:
        notes = styles.create_style(db, "  Notes   app ")
        assert notes.name == "Notes app"
        with pytest.raises(ValueError, match="already a style"):
            styles.create_style(db, "chat")
        styles.assign_app(db, MAIL, "Mail", notes.id)
        styles.update_style(db, notes.id, {"name": "Journal", "punctuation_style": "casual"})
        with pytest.raises(ValueError, match="default"):
            styles.delete_style(db, "work")
        assert styles.delete_style(db, notes.id)
    # Its app goes back to the default.
    assert styles.snapshot().for_app(MAIL).id == "work"
    with storage() as db:
        assert db.query(AppStyle).count() == 0
        styles.update_style(db, "chat", {"is_default": True})
        assert [row.id for row in db.query(WritingStyle).filter(WritingStyle.is_default)] == ["chat"]


def test_version_1_profiles_move_into_the_migrated_style(storage, tmp_path):
    (tmp_path / "writing-style.json").write_text(
        json.dumps(
            {
                "version": 1,
                "runs": 2,
                "last_run_at": "2026-09-21T21:38:19+00:00",
                "examples": [{"shown": "Hi. There.", "written": "hi, there", "created_at": "x"}],
                "recent_paragraphs": ["a"],
                "feedback_counts": {"boundary": {"period": 0, "comma": 3, "none": 0}},
                "hidden_examples": ["correction:gone"],
            }
        )
    )
    (tmp_path / "correction-notes.json").write_text(
        json.dumps({"version": 1, "notes": ["Write Voicebox as one word."], "considered_ids": ["c1"]})
    )
    seed(storage)
    assert writing_style.status("work")["runs"] == 2
    assert writing_style.status("chat")["runs"] == 0
    assert writing_style.hidden_examples() == ["correction:gone"]
    assert correction_notes.notes("work") == ["Write Voicebox as one word."]
    assert correction_notes.notes("chat") == []
    # Nothing is lost when the file is written back in version 2.
    writing_style.hide_example("correction:also-gone")
    saved = json.loads((tmp_path / "writing-style.json").read_text())
    assert saved["version"] == 2
    assert saved["styles"]["work"]["runs"] == 2
    assert saved["styles"]["work"]["examples"][0]["written"] == "hi, there"


def test_corrections_teach_only_their_apps_style_and_follow_the_app(storage):
    seed(storage)
    with storage() as db:
        styles.assign_app(db, SLACK, "Slack", "chat")
    correct(storage, "s", SLACK, "yeah so the build is broken", "yeah the build is broken")
    correct(storage, "m", MAIL, "hi priya the build is broken", "Hi Priya, the build is broken.")
    correct(storage, "u", None, "old one from before apps", "Old one from before apps.")
    assert [e["said"] for e in personal_examples.all_examples("chat")] == ["yeah so the build is broken"]
    assert {e["said"] for e in personal_examples.all_examples("work")} == {
        "hi priya the build is broken",
        "old one from before apps",
    }
    assert personal_examples.all_examples("chat")[0]["app_bundle_id"] == SLACK
    # Moving Mail to Formal moves its corrections with it.
    with storage() as db:
        styles.assign_app(db, MAIL, "Mail", "formal")
    assert [e["said"] for e in personal_examples.all_examples("formal")] == ["hi priya the build is broken"]
    assert [e["said"] for e in personal_examples.all_examples("work")] == ["old one from before apps"]


def test_learned_habits_are_counted_per_style(storage):
    seed(storage)
    with storage() as db:
        styles.assign_app(db, SLACK, "Slack", "chat")
    for index in range(3):
        with storage() as db:
            db.add(Capture(id=f"s{index}", audio_path="a.wav", transcript_raw="x", app_bundle_id=SLACK))
            db.add(
                CaptureFeedback(
                    capture_id=f"s{index}",
                    target="refined",
                    expected_text="it works, ship it",
                    snapshot=json.dumps(
                        {"transcript_raw": "x", "transcript_refined": "It works. Ship it.", "app_bundle_id": SLACK}
                    ),
                )
            )
            db.commit()
    with storage() as db:
        writing_style.refresh_feedback(db)
    assert "boundary_comma" in writing_style.status("chat")["habits"]
    assert writing_style.status("work")["habits"] == []
    chat = RefinementFlags(punctuation_style="learned", style="chat")
    work = RefinementFlags(punctuation_style="learned", style="work")
    assert "Join related thoughts with commas" in build_refinement_prompt(chat)
    assert "Join related thoughts with commas" not in build_refinement_prompt(work)
    assert writing_style.apply_learned("It works. Ship it.", "chat") == "it works, ship it"
    assert writing_style.apply_learned("It works. Ship it.", "work") == "It works. Ship it."


def test_flags_keep_old_snapshots_equal():
    assert RefinementFlags().to_dict() == {"smart_cleanup": True, "self_correction": True, "preserve_technical": True}
    flags = RefinementFlags(capitalize_first=False, style="chat")
    assert flags.to_dict()["capitalize_first"] is False
    assert RefinementFlags.from_dict(flags.to_dict()) == flags
    assert RefinementFlags.from_dict({"smart_cleanup": True}) == RefinementFlags()


def test_first_word_follows_the_style():
    lowercase = RefinementFlags(capitalize_first=False)
    assert style_first_word("So I looked at the build.", lowercase) == "so I looked at the build."
    assert style_first_word("I looked at the build.", lowercase) == "I looked at the build."
    assert style_first_word("API keys go here.", lowercase) == "API keys go here."
    assert style_first_word("Priya, the build is broken.", lowercase, frozenset({"Priya"})) == (
        "Priya, the build is broken."
    )
    assert style_first_word("So I looked.", RefinementFlags()) == "So I looked."


def test_style_endpoints(storage):
    from backend.routes.styles import router

    seed(storage)
    with storage() as db:
        db.add(Capture(id="w", audio_path="a.wav", transcript_raw="hi", app_bundle_id="net.whatsapp.WhatsApp",
                       app_name="WhatsApp"))
        db.commit()

    def override():
        with storage() as db:
            yield db

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override
    client = TestClient(app)

    listing = client.get("/writing-styles").json()
    assert [s["id"] for s in listing["styles"]] == ["chat", "work", "formal", "code"]
    assert listing["apps"] == [
        {"bundle_id": "net.whatsapp.WhatsApp", "name": "WhatsApp", "style_id": "work", "confirmed": False, "count": 1}
    ]
    listing = client.put("/writing-styles/apps/net.whatsapp.WhatsApp", json={"style_id": "chat"}).json()
    assert listing["apps"][0]["style_id"] == "chat"
    assert listing["apps"][0]["confirmed"] is True
    assert client.put("/writing-styles/apps/x", json={"style_id": "missing"}).status_code == 404

    created = client.post("/writing-styles", json={"name": "Journal"}).json()
    assert client.patch(f"/writing-styles/{created['id']}", json={"capitalize_first": False}).json()[
        "capitalize_first"
    ] is False
    assert client.delete("/writing-styles/work").status_code == 400
    assert client.delete(f"/writing-styles/{created['id']}").status_code == 204
