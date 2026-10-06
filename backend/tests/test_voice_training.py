"""Voice training: the voice bank, mixing, the acceptance gate, adapter merging,
and promotion, undo and loading through the model-improvement manager."""

import json
import wave
from datetime import datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend import config
from backend.database.models import Base, Capture, CaptureFeedback
from backend.services.model_improvement import manager
from backend.services.voice_training import bank, gate, lora, mixing


def write_wav(path, seconds=3.0, rate=48000):
    t = np.arange(int(seconds * rate)) / rate
    pcm = (0.2 * np.sin(2 * np.pi * 220 * t) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_data_dir", tmp_path)
    monkeypatch.setattr(config, "get_data_dir", lambda: tmp_path)
    return tmp_path


@pytest.fixture
def db(data_dir):
    engine = create_engine(f"sqlite:///{data_dir}/db.sqlite")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        yield session


def add_capture(db, data_dir, capture_id, text="Commit and push.", minutes=0, seconds=3.0, source="dictation"):
    path = data_dir / f"{capture_id}.wav"
    write_wav(path, seconds)
    db.add(
        Capture(
            id=capture_id,
            audio_path=str(path),
            source=source,
            transcript_raw=text,
            created_at=datetime(2026, 10, 1, 12) + timedelta(minutes=minutes),
        )
    )
    db.commit()


def fake_analysis(kind):
    """Stand in for Silero: "clean", "noisy" or "silent" for every take."""

    def analyze(y):
        probabilities = np.zeros(len(y) // 512, np.float32)
        if kind == "silent":
            return {"voiced": 0.0, "probabilities": probabilities}
        floor = -70.0 if kind == "clean" else -40.0
        return {
            "voiced": 1.5,
            "floor": floor,
            "snr": 40.0 if kind == "clean" else 8.0,
            "end": 2.5,
            "probabilities": probabilities,
        }

    return analyze


SETTINGS = SimpleNamespace(discard_audio=False)


def test_bank_keeps_clean_takes_and_room_noise_from_noisy_ones(db, data_dir, monkeypatch):
    add_capture(db, data_dir, "clean-1", minutes=1)
    add_capture(db, data_dir, "command-1", minutes=2, source="command")
    add_capture(db, data_dir, "long-1", minutes=3, seconds=40)
    monkeypatch.setattr(bank, "analyze", fake_analysis("clean"))
    summary = bank.scan(db, SETTINGS)
    assert summary["takes"] == 1
    [take] = bank.takes()
    assert take["id"] == "clean-1"
    assert take["text"] == "Commit and push."
    assert take["end"] == pytest.approx(2.5)
    assert len(bank.read_wav(take["audio"])) == 3 * 16000

    add_capture(db, data_dir, "noisy-1", minutes=4)
    monkeypatch.setattr(bank, "analyze", fake_analysis("noisy"))
    assert bank.scan(db, SETTINGS)["takes"] == 1  # earlier captures aren't scanned again
    assert len(bank.room_paths()) == 1


def test_bank_labels_take_the_users_fix_but_not_a_redictation(db, data_dir, monkeypatch):
    add_capture(db, data_dir, "take-1", text="We installed a lot.")
    add_capture(db, data_dir, "take-2", text="Command push.", minutes=1)
    for capture_id, expected, source in (
        ("take-1", "Reinstall the app.", "manual"),
        ("take-2", "Commit.", "redictation"),
    ):
        db.add(
            CaptureFeedback(capture_id=capture_id, target="raw", expected_text=expected, snapshot="{}", source=source)
        )
    db.commit()
    monkeypatch.setattr(bank, "analyze", fake_analysis("clean"))
    bank.scan(db, SETTINGS)
    labels = {take["id"]: take["text"] for take in bank.takes()}
    assert labels == {"take-1": "Reinstall the app.", "take-2": "Command push."}


def test_bank_forgets_deleted_captures_and_empties_for_discard_audio(db, data_dir, monkeypatch):
    add_capture(db, data_dir, "take-1")
    add_capture(db, data_dir, "take-2", minutes=1)
    monkeypatch.setattr(bank, "analyze", fake_analysis("clean"))
    bank.scan(db, SETTINGS)
    bank.forget("take-1")
    assert [take["id"] for take in bank.takes()] == ["take-2"]
    assert not (data_dir / "voice-training" / "bank" / "take-1.wav").exists()
    bank.scan(db, SimpleNamespace(discard_audio=True))
    assert bank.takes() == []
    assert not (data_dir / "voice-training" / "bank").exists()


def test_bank_keeps_only_the_newest_two_hours(db, data_dir, monkeypatch):
    monkeypatch.setattr(bank, "BANK_SECONDS", 7.0)
    for minute in range(4):
        add_capture(db, data_dir, f"take-{minute}", minutes=minute)
    monkeypatch.setattr(bank, "analyze", fake_analysis("clean"))
    bank.scan(db, SETTINGS)
    assert [take["id"] for take in bank.takes()] == ["take-2", "take-3"]


def test_split_is_stable_and_mostly_training():
    splits = [bank.split(f"capture-{i}") for i in range(2000)]
    assert splits == [bank.split(f"capture-{i}") for i in range(2000)]
    assert 0.11 < splits.count("test") / len(splits) < 0.19


def test_condition_mixes_are_repeatable_and_at_the_stated_level():
    rng = np.random.default_rng(0)
    voice = (0.1 * rng.standard_normal(16000 * 3)).astype(np.float32)
    talk = [(0.3 * rng.standard_normal(16000 * 2)).astype(np.float32) for _ in range(3)]
    beds = [(0.05 * rng.standard_normal(16000 * 10)).astype(np.float32)]
    first = mixing.condition_mix("take", "talk6", voice, talk, beds)
    assert np.array_equal(first, mixing.condition_mix("take", "talk6", voice, talk, beds))
    assert not np.array_equal(first, mixing.condition_mix("other", "talk6", voice, talk, beds))
    other = first - voice
    ratio = 20 * np.log10(mixing.active_rms(voice) / mixing.active_rms(other))
    assert ratio == pytest.approx(6, abs=1.5)
    assert np.array_equal(mixing.condition_mix("take", "clean", voice, talk, beds), voice)
    for _ in range(20):
        mixed = mixing.training_mix(rng, voice, talk, beds)
        assert mixed.shape == voice.shape
        assert np.isfinite(mixed).all()
        assert np.abs(mixed).max() <= 0.99 + 1e-6


def gate_rows(candidate_noisy="Commit and push.", candidate_clean="Commit and push.", takes=12, production=False):
    rows = []
    for i in range(takes):
        for condition in mixing.CONDITIONS:
            noisy = condition != "clean"
            row = {
                "id": f"take-{i}",
                "condition": condition,
                "expected": "Commit and push.",
                "base": "Come here and push." if noisy else "Commit and push.",
                "candidate": candidate_noisy if noisy else candidate_clean,
                "base_seconds": 0.5,
                "candidate_seconds": 0.5,
                "base_memory": 1024**3,
                "candidate_memory": 1024**3,
            }
            if production:
                row |= {"production": row["candidate"], "production_seconds": 0.5, "production_memory": 1024**3}
            rows.append(row)
    return rows


def test_gate_accepts_fewer_mistakes_in_noise_with_clean_takes_unchanged():
    result = gate.score_voice(gate_rows())
    assert result["passed"], result["reasons"]
    assert result["base"]["noisy"] > result["candidate"]["noisy"] == 0


def test_gate_rejects_worse_clean_takes_and_too_few_takes():
    assert "Clean takes got worse" in gate.score_voice(gate_rows(candidate_clean="Come here."))["reasons"]
    assert not gate.score_voice(gate_rows(takes=5))["passed"]


def test_gate_compares_with_the_model_in_use_not_plain_turbo():
    # The model in use already gets the noisy takes right; matching it isn't enough.
    result = gate.score_voice(gate_rows(production=True))
    assert not result["passed"]
    assert result["reasons"] == ["It didn't make clearly fewer mistakes with background talk and noise"]


def test_gate_rejects_worse_corrected_takes():
    rows = gate_rows()
    rows.append(
        {
            "id": "fix",
            "condition": "correction",
            "expected": "Reinstall the app.",
            "base": "Reinstall the app.",
            "candidate": "We installed a lot.",
            "base_seconds": 0.5,
            "candidate_seconds": 0.5,
            "base_memory": 1,
            "candidate_memory": 1,
        }
    )
    assert "Your corrected takes got worse" in gate.score_voice(rows)["reasons"]


def tiny_whisper():
    from mlx_audio.stt.models.whisper.whisper import Model, ModelDimensions

    dims = ModelDimensions(
        n_mels=8,
        n_audio_ctx=16,
        n_audio_state=16,
        n_audio_head=2,
        n_audio_layer=2,
        n_vocab=64,
        n_text_ctx=8,
        n_text_state=16,
        n_text_head=2,
        n_text_layer=2,
    )
    return Model(dims, dtype=__import__("mlx.core").core.float32)


def test_adapter_merges_into_the_same_outputs(tmp_path):
    import mlx.core as mx
    from mlx.utils import tree_map

    mx.random.seed(3)
    model = tiny_whisper()
    weights = model.parameters()
    lora.add(model)
    # Training would move the B matrices off zero; do it by hand.
    model.update(tree_map(lambda v: v, model.trainable_parameters()))
    for pair in [p for _, p in model.named_modules() if hasattr(p, "merged")]:
        pair.b = mx.random.normal(pair.b.shape) * 0.1
    mel, tokens = mx.random.normal((1, 32, 8)), mx.array([[1, 2, 3]])
    expected = model(mel, tokens)
    lora.save(model, tmp_path / "voice", {"model_size": "turbo"})

    fresh = tiny_whisper()
    fresh.update(weights)
    lora.apply(fresh, tmp_path / "voice")
    assert mx.allclose(fresh(mel, tokens), expected, atol=1e-4)
    assert not any(hasattr(p, "merged") for _, p in fresh.named_modules())


def test_a_float16_adapter_loads_for_training_in_float32(tmp_path):
    """The shared voice adapter ships in float16 (scripts/shared-adapters/publish.py)."""
    import mlx.core as mx
    from mlx.utils import tree_flatten

    model = tiny_whisper()
    lora.add(model)
    lora.save(model, tmp_path / "voice", {"model_size": "turbo"})
    path = str(tmp_path / "voice" / lora.ADAPTER_FILE)
    half = {name: value.astype(mx.float16) for name, value in mx.load(path).items()}
    mx.eval(half)
    mx.save_safetensors(path, half)
    fresh = tiny_whisper()
    lora.load_into(fresh, tmp_path / "voice")
    assert {value.dtype for _, value in tree_flatten(fresh.trainable_parameters())} == {mx.float32}


def test_adapter_for_a_different_model_is_refused(tmp_path):
    import mlx.core as mx

    model = tiny_whisper()
    lora.add(model)
    lora.save(model, tmp_path / "voice", {"model_size": "turbo"})
    mx.save_safetensors(str(tmp_path / "voice" / lora.ADAPTER_FILE), {"encoder.blocks.0.attn.query.a": mx.zeros((1,))})
    with pytest.raises(ValueError, match="doesn't match"):
        lora.apply(tiny_whisper(), tmp_path / "voice")


@pytest.fixture
def learning(data_dir, monkeypatch):
    engine = create_engine(f"sqlite:///{data_dir}/learning.sqlite")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(manager.database_session, "SessionLocal", sessionmaker(bind=engine))
    for name, value in (("_state", None), ("_root", None), ("_active", {}), ("_process", None), ("_thread", None)):
        monkeypatch.setattr(manager, name, value)
    monkeypatch.setattr(manager.correction_learning, "_state", {"rules": []})
    monkeypatch.setattr(manager, "_reload_speech", lambda: None)
    manager.initialize()
    return data_dir


def voice_candidate(data_dir, name):
    folder = data_dir / "model-improvement" / "runs" / name
    (folder / "voice").mkdir(parents=True)
    (folder / "voice" / lora.ADAPTER_FILE).write_bytes(f"weights {name}".encode())
    (folder / "voice" / lora.CONFIG_FILE).write_text(json.dumps({"model_size": "turbo"}))
    return folder


def voice_plan():
    return {
        "baseline_revision": manager._state["revision"],
        "pipeline": manager.pipeline_id(),
        "rules": [],
        "configured_stt": "turbo",
        "model_size": "0.6B",
    }


def test_passing_voice_adapter_is_used_for_turbo_and_can_be_undone(learning):
    folder = voice_candidate(learning, "first")
    manager._promote(voice_plan(), folder, {"voice": {"rows": gate_rows(), "training": {"updates": 5}}}, "fp-1")
    path = str(folder / "voice")
    assert manager.voice_adapter("turbo") == path
    assert manager.voice_adapter("large") is None
    assert manager._state["voice_resume"] == path
    status = manager.status()["voice"]
    assert status["active"] == "first"
    assert status["can_undo"]

    manager.rollback()
    assert manager.voice_adapter("turbo") is None
    assert manager._state["voice_resume"] is None
    assert "fp-1" in manager._state["blocked"]


def test_big_win_in_noise_may_cost_a_few_clean_words(learning):
    # Every noisy take fixed, two words off on clean takes: used.
    rows = gate_rows()
    for row in [r for r in rows if r["condition"] == "clean"][:2]:
        row["candidate"] = "Commit, push."
    first = voice_candidate(learning, "first")
    manager._promote(voice_plan(), first, {"voice": {"rows": rows}}, "fp")
    assert manager.voice_adapter("turbo") == str(first / "voice")


def test_small_win_in_noise_keeps_clean_takes_strict():
    # Noisy mistakes down 20% (not a big win): one clean word off is fine, two aren't.
    def rows(clean_misses):
        out = gate_rows(takes=20)
        for i, row in enumerate([r for r in out if r["condition"] != "clean"]):
            row["candidate"] = row["base"] if i % 5 else "Commit and push."
        for row in [r for r in out if r["condition"] == "clean"][:clean_misses]:
            row["candidate"] = "Commit, push."
        return out

    assert gate.score_voice(rows(1))["passed"]
    assert gate.score_voice(rows(2))["reasons"] == ["Clean takes got worse"]


def test_candidate_better_than_the_model_in_use_on_both_counts_is_used():
    # Plain turbo misses 80 noisy takes and no clean ones. The model in use (a
    # big win) misses 40 noisy and 4 clean. The candidate misses 32 noisy and 3
    # clean: a small win over the model in use, but better on both counts.
    rows = gate_rows(takes=40)
    noisy = [r for r in rows if r["condition"] != "clean"]
    clean = [r for r in rows if r["condition"] == "clean"]
    for i, row in enumerate(noisy):
        row["base"] = "Come here and push." if i < 80 else "Commit and push."
        row["production"] = "Come here and push." if i < 40 else "Commit and push."
        row["candidate"] = "Come here and push." if i < 32 else "Commit and push."
    for i, row in enumerate(clean):
        row["production"] = "Commit, push." if i < 4 else "Commit and push."
        row["candidate"] = "Commit, push." if i < 3 else "Commit and push."
    for row in rows:
        row |= {"production_seconds": 0.5, "production_memory": 1024**3}
    result = gate.score_voice(rows)
    assert result["passed"], result["reasons"]


def test_training_continues_from_a_candidate_on_its_way_but_not_from_a_bad_one(learning):
    # Better in noise, a few clean words off: not used, but the next run builds on it.
    on_its_way = gate_rows()
    for row in [r for r in on_its_way if r["condition"] != "clean"][::2]:
        row["candidate"] = row["base"]  # half the noisy takes still wrong
    clean = [r for r in on_its_way if r["condition"] == "clean"]
    clean[0]["candidate"] = "Commit, push."
    clean[1]["candidate"] = "Commit, push."
    first = voice_candidate(learning, "first")
    manager._promote(voice_plan(), first, {"voice": {"rows": on_its_way}}, "fp")
    assert manager._state["voice_resume"] == str(first / "voice")

    # Far worse on clean takes: training doesn't continue from it.
    second = voice_candidate(learning, "second")
    manager._promote(voice_plan(), second, {"voice": {"rows": gate_rows(candidate_clean="Come here.")}}, "fp-2")
    assert manager._state["voice_resume"] == str(first / "voice")

    # No better in noise: nothing to continue from either.
    third = voice_candidate(learning, "third")
    manager._promote(voice_plan(), third, {"voice": {"rows": gate_rows(candidate_noisy="Come here and push.")}}, "fp-3")
    assert manager._state["voice_resume"] == str(first / "voice")


def test_tampered_voice_adapter_is_dropped_on_restart(learning, monkeypatch):
    folder = voice_candidate(learning, "first")
    manager._promote(voice_plan(), folder, {"voice": {"rows": gate_rows()}}, "fp")
    (folder / "voice" / lora.ADAPTER_FILE).write_bytes(b"changed")
    monkeypatch.setattr(manager, "_state", None)
    manager.initialize()
    assert manager.voice_adapter("turbo") is None


def test_speech_backend_merges_the_active_adapter_and_reloads_when_it_changes(monkeypatch):
    from backend.backends import mlx_backend

    loads = []
    monkeypatch.setattr(mlx_backend.mlx_whisper_loader, "load_whisper", lambda repo: loads.append(repo) or object())
    monkeypatch.setattr(mlx_backend, "model_load_progress", lambda *a: __import__("contextlib").nullcontext())
    applied = []
    monkeypatch.setattr(lora, "apply", lambda model, path: applied.append(path))
    adapter = {"value": "/voice/one"}
    monkeypatch.setattr(mlx_backend, "_voice_adapter", lambda size: adapter["value"])
    backend = mlx_backend.MLXSTTBackend("turbo")
    monkeypatch.setattr(backend, "_is_model_cached", lambda size: True)
    backend._ensure_loaded_sync("turbo")
    backend._ensure_loaded_sync("turbo")
    assert applied == ["/voice/one"]
    assert len(loads) == 1
    adapter["value"] = None
    backend._ensure_loaded_sync("turbo")
    assert len(loads) == 2
    assert backend.adapter is None


def test_voice_trains_once_the_refinement_model_has_nothing_new(learning, monkeypatch):
    from backend.services import settings as settings_service, styles

    monkeypatch.setattr(manager.correction_learning, "run_job", lambda: None)
    monkeypatch.setattr(manager, "collect", lambda db, groups: [])
    monkeypatch.setattr(manager, "readiness", lambda samples: ({"audio_test": 0}, True))
    monkeypatch.setattr(manager, "_cached", lambda repo: "/cached")
    monkeypatch.setattr(
        settings_service,
        "get_capture_settings",
        lambda db: SimpleNamespace(llm_model="0.6B", stt_model="turbo", language="auto", discard_audio=False),
    )
    monkeypatch.setattr(styles, "load", lambda db: SimpleNamespace(styles=[]))
    monkeypatch.setattr(manager, "_scan_bank", lambda db, settings: {"train": 500, "test": 80})
    monkeypatch.setattr(manager, "_voice_plan", lambda *args: {"bank_digest": "bank", "resume": None})

    plan, refinement, ready = manager._prepare()
    assert ready
    assert plan["train_ready"]
    assert plan["voice"] is None

    manager._state["attempted"].append(refinement)
    plan, fingerprint, ready = manager._prepare()
    assert ready
    assert plan["voice"]
    assert not plan["train_ready"]
    assert fingerprint != refinement


def test_sound_download_resumes_after_a_dropped_connection(tmp_path, monkeypatch):
    import io
    import urllib.request

    from backend.services.voice_training import sounds

    payload = bytes(range(256)) * 40
    requests = []

    class Response(io.BytesIO):
        def __init__(self, body, status, length):
            super().__init__(body)
            self.status, self.headers = status, {"Content-Length": str(length)}

    def urlopen(request, timeout):
        start = int((request.get_header("Range") or "bytes=0-")[6:-1])
        requests.append(start)
        if start == 0:  # the connection drops halfway
            return Response(payload[: len(payload) // 2], 200, len(payload))
        return Response(payload[start:], 206, len(payload) - start)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sounds.time, "sleep", lambda seconds: None)
    target = tmp_path / "archive.tar.gz"
    sounds._fetch(["https://example.test/a"], target, lambda count: None)
    assert target.read_bytes() == payload
    assert requests == [0, len(payload) // 2]
