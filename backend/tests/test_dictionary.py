"""Dictionaries: scopes, what a dictation's merged dictionary does, and the API (docs/plans/DICTIONARIES.md)."""

import statistics
import time
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import get_db, session as database_session
from backend.database.models import Base
from backend.services import dictionary, phrase_seams, styles
from backend.services.correction_rules import MAX_TEXT
from backend.services.dictionary import Entry

SLACK, ZED = "com.tinyspeck.slackmacgap", "dev.zed.Zed"
COMMON = {"mark", "slack", "open", "source", "voice", "box"}
START = datetime(2026, 9, 1)


@pytest.fixture(autouse=True)
def common_words(monkeypatch):
    # The real check reads Whisper's vocabulary and the system word list.
    monkeypatch.setattr(phrase_seams, "_common_word", lambda word: word.casefold() in COMMON)


def entry(scope, written, spoken=None, scope_id=None, minutes=0):
    return Entry(
        f"{scope}-{written}-{spoken}", scope, scope_id, None, written, spoken, START + timedelta(minutes=minutes)
    )


def merged(*entries, bundle_id=ZED, style_id="code"):
    return dictionary.build(dictionary.resolve(entries, bundle_id, style_id))


def test_the_most_specific_scope_wins_for_the_same_word_said():
    resolved = dictionary.resolve(
        [
            entry("global", "VoiceBox", "voice box"),
            entry("style", "Voice Box", "voice box", "code"),
            entry("app", "Voicebox", "Voice  Box", ZED),
            entry("app", "Other", "voice box", SLACK),
            entry("style", "Nope", "nope", "chat"),
        ],
        ZED,
        "code",
    )

    assert [(e.scope, e.written, overridden) for e, overridden in resolved] == [
        ("app", "Voicebox", False),
        ("style", "Voice Box", True),
        ("global", "VoiceBox", True),
    ]
    assert merged(*[e for e, _ in resolved]).apply("open voice box now") == "open Voicebox now"


def test_terms_come_most_specific_first_and_newest_first_within_a_scope():
    found = merged(
        entry("global", "Kubernetes", minutes=5),
        entry("global", "Tailscale", minutes=9),
        entry("app", "Zed", scope_id=ZED),
        entry("app", "Voicebox", "voice box", ZED),
        entry("style", "mrgnhnt96", scope_id="code"),
    )

    assert found.terms == ("Zed", "mrgnhnt96", "Tailscale", "Kubernetes", "Voicebox")
    assert found.names == {"Zed", "Tailscale", "Kubernetes", "Voicebox"}


def test_replacements_match_whole_words_in_any_case_and_spacing():
    found = merged(entry("global", "Voicebox", "voice box"), entry("global", "Morgan@example.com", "my work email"))

    assert found.apply("Voice box, voice-box and VOICE BOX.") == "Voicebox, Voicebox and Voicebox."
    assert found.apply("Send it to my work email.") == "Send it to Morgan@example.com."
    # Inside other words, nothing changes.
    assert found.apply("Two voice boxes, a voice boxer.") == "Two voice boxes, a voice boxer."


def test_the_longest_spoken_phrase_wins_where_two_overlap():
    found = merged(entry("global", "Voicebox", "voice box"), entry("global", "Voicebox app", "voice box app"))

    assert found.apply("the voice box app") == "the Voicebox app"


def test_terms_get_their_own_capitals_unless_they_are_common_words():
    found = merged(
        entry("global", "Kubernetes"),
        entry("global", "mrgnhnt96"),
        entry("global", "Mark"),
        entry("global", "Open Source"),
    )

    assert found.apply("kubernetes for MRGNHNT96") == "Kubernetes for mrgnhnt96"
    # "Mark" is a common word: "mark this" is the verb.
    assert found.apply("mark this open source") == "mark this open source"
    # It still counts as a name, so dictation keeps it capitalized mid-sentence.
    assert "Mark" in found.names


def test_an_empty_dictionary_leaves_text_alone():
    assert dictionary.EMPTY.apply("anything at all") == "anything at all"
    assert merged().terms == ()


def test_terms_fill_the_prompt_budget_in_order():
    count = len  # one token per character, for the test

    fit, dropped = dictionary.fit_terms(["aaaa", "bbbbbbbbbb", "cc", "dd"], count, budget=19)

    # 1 for the final period, then each term plus its separator: 5 + 11 = 17; "cc" needs 3 more.
    assert fit == ["aaaa", "bbbbbbbbbb"]
    # A later, smaller term never jumps ahead of one that didn't fit.
    assert dropped == ["cc", "dd"]
    assert dictionary.prompt(fit) == "aaaa, bbbbbbbbbb."
    assert dictionary.prompt([]) == ""


def test_span_covers_the_longest_match():
    found = merged(entry("global", "Voicebox app", "the voice box app"), entry("global", "Visual Studio Code"))
    assert found.span == 4


def test_a_large_dictionary_stays_under_five_milliseconds():
    entries = [entry("global", f"Term{i}x", f"spoken phrase {i}", minutes=i) for i in range(250)]
    entries += [entry("global", f"Product{i}q", minutes=i) for i in range(250)]
    found = merged(*entries)
    text = ("say spoken phrase 42 and product7q with term3x then more words. " * 100)[:MAX_TEXT]
    found.apply(text)  # compiles once

    timings = []
    for _ in range(25):
        started = time.perf_counter()
        found.apply(text)
        timings.append((time.perf_counter() - started) * 1000)

    assert statistics.median(timings) <= 5
    assert "Term42x" in found.apply("spoken phrase 42")


# -- storage and API -----------------------------------------------------------


@pytest.fixture
def storage(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    make = sessionmaker(bind=engine)
    monkeypatch.setattr(database_session, "SessionLocal", make)
    with make() as db:
        styles.ensure_styles(db)
    return make


@pytest.fixture
def client(storage):
    from backend.routes.dictionary import router

    app = FastAPI()
    app.include_router(router)

    def db():
        with storage() as session:
            yield session

    app.dependency_overrides[get_db] = db
    return TestClient(app)


def test_the_api_adds_lists_and_rejects_the_same_word_twice(client):
    added = client.post("/dictionary", json={"scope": "global", "written": "  Voicebox ", "spoken": "voice  box"})
    assert added.status_code == 200
    assert added.json() | {"id": "x", "created_at": None} == {
        "id": "x",
        "scope": "global",
        "scope_id": None,
        "app_name": None,
        "written": "Voicebox",
        "spoken": "voice box",
        "created_at": None,
    }

    duplicate = client.post("/dictionary", json={"scope": "global", "written": "VoiceBox", "spoken": "Voice Box"})
    assert duplicate.status_code == 409

    # The same word said is fine in another scope.
    in_app = client.post(
        "/dictionary",
        json={"scope": "app", "scope_id": ZED, "app_name": "Zed", "written": "voicebox", "spoken": "voice box"},
    )
    assert in_app.status_code == 200
    assert [e["scope"] for e in client.get("/dictionary").json()["entries"]] == ["app", "global"]


def test_the_api_rejects_empty_words_and_unknown_styles(client):
    assert client.post("/dictionary", json={"scope": "global", "written": "   "}).status_code == 400
    assert client.post("/dictionary", json={"scope": "style", "scope_id": "nope", "written": "Zed"}).status_code == 400
    assert client.post("/dictionary", json={"scope": "app", "written": "Zed"}).status_code == 400
    assert client.post("/dictionary", json={"scope": "global", "written": "x" * 201}).status_code == 400


def test_editing_and_deleting_change_what_dictation_uses(client):
    added = client.post("/dictionary", json={"scope": "global", "written": "Kubernetes"}).json()
    assert dictionary.for_app(ZED).terms == ("Kubernetes",)

    edited = client.patch(f"/dictionary/{added['id']}", json={"written": "k8s", "spoken": "kates"})
    assert edited.json()["spoken"] == "kates"
    assert dictionary.for_app(ZED).apply("run kates") == "run k8s"

    assert client.delete(f"/dictionary/{added['id']}").json() == {"deleted": True}
    assert dictionary.for_app(ZED).terms == ()
    assert client.delete(f"/dictionary/{added['id']}").status_code == 404


def test_an_app_gets_its_styles_entries_and_resolved_shows_overrides(client, storage):
    with storage() as db:
        code = styles.create_style(db, "Code")
        styles.assign_app(db, ZED, "Zed", code.id)
    client.post("/dictionary", json={"scope": "global", "written": "VoiceBox", "spoken": "voice box"})
    client.post("/dictionary", json={"scope": "style", "scope_id": code.id, "written": "mrgnhnt96"})
    client.post("/dictionary", json={"scope": "app", "scope_id": ZED, "written": "Voicebox", "spoken": "voice box"})

    resolved = client.get("/dictionary/resolved", params={"bundle_id": ZED}).json()

    assert [(e["scope"], e["written"], e["overridden"]) for e in resolved["entries"]] == [
        ("app", "Voicebox", False),
        ("style", "mrgnhnt96", False),
        ("global", "VoiceBox", True),
    ]
    assert resolved["prompt_terms"] == ["mrgnhnt96", "Voicebox"]
    assert resolved["dropped_terms"] == []
    # Slack is in the default style: only the global entry.
    assert dictionary.for_app(SLACK).apply("voice box") == "VoiceBox"


def test_deleting_a_style_moves_its_entries_to_the_default(storage):
    with storage() as db:
        code = styles.create_style(db, "Code")
        default = styles.default_id()
        dictionary.add_entry(db, "style", code.id, "Kubernetes")
        dictionary.add_entry(db, "style", code.id, "Zed")
        dictionary.add_entry(db, "style", default, "zed")
        styles.delete_style(db, code.id)

        moved = dictionary.list_entries(db)

    assert sorted((e.scope_id == default, e.written) for e in moved) == [(True, "Kubernetes"), (True, "zed")]
