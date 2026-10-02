"""Read Aloud: sentences, validation, the speech endpoints and their settings."""

import io

import numpy as np
import pytest
import soundfile as sf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import backend.backends as backends
from backend.backends import get_all_model_configs, get_model_config
from backend.database import get_db
from backend.database.migrations import run_migrations
from backend.database.models import Base
from backend.services import speech
from backend.services.commands import MAX_SELECTION_CHARS
from backend.services.settings import get_capture_settings, update_capture_settings


class FakeKokoro:
    """Kokoro without the model: a beep whose length follows the text."""

    def __init__(self, cached=True):
        self.cached = cached
        self.calls = []

    def is_cached(self):
        return self.cached

    async def synthesize(self, text, voice, speed):
        self.calls.append((text, voice, speed))
        return np.sin(np.linspace(0, 440, 240 * len(text), dtype=np.float32)) * 0.1


@pytest.fixture
def kokoro(monkeypatch):
    fake = FakeKokoro()
    monkeypatch.setattr(backends, "get_speech_backend", lambda: fake)
    return fake


@pytest.fixture
def storage():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


@pytest.fixture
def client(storage):
    from backend.routes.speech import router

    app = FastAPI()
    app.include_router(router)

    def db():
        with storage() as session:
            yield session

    app.dependency_overrides[get_db] = db
    return TestClient(app)


# -- sentences ---------------------------------------------------------------


def test_text_is_read_a_sentence_at_a_time():
    assert speech.split_sentences("The plan is ready. We ship it today! Any questions? Great") == [
        "The plan is ready.",
        "We ship it today!",
        "Any questions?",
        "Great",
    ]


def test_a_sentence_ends_after_closing_quotes_and_brackets():
    assert speech.split_sentences('She said "no." Then we left (quietly.) The end came.') == [
        'She said "no."',
        "Then we left (quietly.)",
        "The end came.",
    ]


def test_line_breaks_end_a_piece_and_extra_whitespace_goes():
    assert speech.split_sentences("Title of the note\n\n  First   point here\nSecond point here") == [
        "Title of the note",
        "First point here",
        "Second point here",
    ]


def test_short_pieces_join_the_next_so_the_voice_does_not_pause_after_each():
    assert speech.split_sentences("Hi. 1. Let's begin the meeting now.") == ["Hi. 1. Let's begin the meeting now."]


def test_a_long_sentence_is_split_at_commas_then_spaces():
    clause = "this clause keeps going for a while"
    sentence = ", ".join([clause] * 20) + "."
    pieces = speech.split_sentences(sentence)
    assert len(pieces) > 1
    assert all(len(piece) <= speech.MAX_SENTENCE_CHARS for piece in pieces)
    assert " ".join(pieces).replace(" ,", ",") == sentence
    assert all(piece.endswith(",") for piece in pieces[:-1])

    words = " ".join(["word"] * 200)
    assert all(len(piece) <= speech.MAX_SENTENCE_CHARS for piece in speech.split_sentences(words))


# -- validation --------------------------------------------------------------


def test_empty_or_too_long_text_is_refused_with_what_to_do():
    with pytest.raises(ValueError, match="Select text to read aloud first"):
        speech.validate_text("   \n")
    with pytest.raises(ValueError, match="up to 16,000 characters"):
        speech.validate_text("a" * (MAX_SELECTION_CHARS + 1))
    assert speech.validate_text("  hello  ") == "hello"


def test_only_kokoros_voices_are_accepted():
    assert speech.validate_voice("bm_george") == "bm_george"
    with pytest.raises(ValueError, match="Unknown voice"):
        speech.validate_voice("zz_nobody")
    assert speech.DEFAULT_VOICE in speech.VOICES


# -- endpoints ---------------------------------------------------------------


def test_sentences_come_back_for_the_app_to_fetch_one_by_one(client, kokoro):
    response = client.post("/speech/sentences", json={"text": "One sentence here. And another one."})
    assert response.status_code == 200
    assert response.json() == {"sentences": ["One sentence here.", "And another one."]}


def test_a_piece_is_spoken_as_16_bit_wav_in_the_saved_voice_and_speed(client, kokoro, storage):
    with storage() as db:
        update_capture_settings(db, {"speak_voice": "bf_emma", "speak_speed": 1.25})
    response = client.post("/speech", json={"text": "Read this aloud."})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    samples, rate = sf.read(io.BytesIO(response.content))
    info = sf.info(io.BytesIO(response.content))
    assert (rate, info.subtype, info.channels) == (24_000, "PCM_16", 1)
    assert len(samples) > 0
    assert kokoro.calls == [("Read this aloud.", "bf_emma", 1.25)]


def test_a_request_can_name_its_own_voice_and_speed(client, kokoro):
    assert client.post("/speech", json={"text": "Hi there.", "voice": "am_adam", "speed": 0.8}).status_code == 200
    assert kokoro.calls == [("Hi there.", "am_adam", 0.8)]
    assert client.post("/speech", json={"text": "Hi there.", "voice": "zz_nobody"}).status_code == 400


def test_without_the_model_both_endpoints_say_to_download_it(client, kokoro):
    kokoro.cached = False
    for path in ("/speech/sentences", "/speech"):
        response = client.post(path, json={"text": "Read this aloud."})
        assert response.status_code == 400
        assert response.json()["detail"] == "Download Kokoro in Models to use Read Aloud"
    assert kokoro.calls == []


def test_nothing_selected_is_reported_before_anything_is_synthesized(client, kokoro):
    response = client.post("/speech", json={"text": "  "})
    assert response.json()["detail"] == "Select text to read aloud first"
    assert kokoro.calls == []


def test_the_voices_are_listed_with_their_accent_and_gender(client):
    body = client.get("/speech/voices").json()
    assert body["default"] == "af_heart"
    assert len(body["voices"]) == len(speech.VOICES)
    assert {"id": "bm_george", "name": "George", "accent": "british", "gender": "male"} in body["voices"]
    assert {"id": "af_heart", "name": "Heart", "accent": "american", "gender": "female"} in body["voices"]


# -- settings and models -----------------------------------------------------


def test_read_aloud_defaults_to_its_own_chord_heart_and_normal_speed(storage):
    with storage() as db:
        saved = get_capture_settings(db)
        assert saved.chord_speak_keys == ["AltGr", "ShiftRight"]
        assert (saved.speak_voice, saved.speak_speed) == ("af_heart", 1.0)
        for other in (saved.chord_push_to_talk_keys, saved.chord_command_keys):
            assert set(saved.chord_speak_keys) != set(other)


def test_an_unknown_voice_is_not_saved(storage):
    with storage() as db, pytest.raises(ValueError, match="Unknown voice"):
        update_capture_settings(db, {"speak_voice": "zz_nobody"})


def test_upgrading_adds_read_alouds_settings(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE capture_settings (id INTEGER PRIMARY KEY, stt_model VARCHAR)"))
        connection.execute(text("INSERT INTO capture_settings (id, stt_model) VALUES (1, 'turbo')"))
    run_migrations(engine)
    run_migrations(engine)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT chord_speak_keys, speak_voice, speak_speed FROM capture_settings")).one()
    assert tuple(row) == ('["AltGr", "ShiftRight"]', "af_heart", 1.0)


def test_kokoro_is_a_model_the_models_tab_lists():
    config = get_model_config("kokoro-82m")
    assert config is not None
    assert (config.engine, config.hf_repo_id) == ("kokoro", "mlx-community/Kokoro-82M-bf16")
    assert config in get_all_model_configs()
    assert backends._backend_for_config(config) is backends.get_speech_backend()
