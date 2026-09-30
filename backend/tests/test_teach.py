"""Teaching a writing style by replying to conversations (docs/plans/TEACH_BY_REPLYING.md)."""

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend import config
from backend.database import get_db
from backend.database.models import Base, Capture
from backend.routes import writing_style as routes
from backend.services import llm as llm_service, styles, teach, writing_style

GOOD_TURN = (
    "MESSAGE: nice. can you post the release notes too?\nTELL: Post notes? -> Yes, Thursday | Who else? → Tag Jess"
)


class _Model:
    def __init__(self, output=GOOD_TURN):
        self.output = output
        self.calls = []

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return self.output


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "_data_dir", tmp_path)
    monkeypatch.setattr(writing_style, "_state", None)
    monkeypatch.setattr(teach, "_sessions", {})
    teach._refresh_teaching()
    yield
    styles.teach_in_herga(None, 0)


@pytest.fixture
def api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)
    model = _Model()
    monkeypatch.setattr(llm_service, "get_llm_model", lambda: model)

    async def refine(said, flags, **options):
        return ("With examples: " if options.get("use_personal_examples", True) else "Plain: ") + said, "0.6B"

    monkeypatch.setattr(routes, "refine_transcript", refine)
    monkeypatch.setattr(routes, "check_refinement", lambda said, refined, flags: (refined, None))
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: session()
    return TestClient(app), session, model


def _dictate(session, raw, refined, after, app=styles.HERGA_BUNDLE):
    with session() as db:
        db.add(
            Capture(
                audio_path="a.wav",
                source="dictation",
                transcript_raw=raw,
                transcript_refined=refined,
                app_bundle_id=app,
                created_at=after + timedelta(seconds=1),
            )
        )
        db.commit()


def test_kinds_come_from_the_styles_apps_by_bundle_then_category():
    apps = [("com.tinyspeck.slackmacgap", None), ("com.example.editor", "public.app-category.developer-tools")]
    assert teach.kinds_for_apps(apps) == ["team_chat", "coding_agent"]
    assert teach.kinds_for_apps([]) == []


def test_every_kind_has_openers():
    assert all(len(teach.seeds_of(kind.id)) >= 3 for kind in teach.KINDS)


def test_a_turn_is_parsed_into_the_message_and_what_to_answer():
    message, note = teach.parse_turn(GOOD_TURN)
    assert message == "nice. can you post the release notes too?"
    assert note["answers"] == [
        {"ask": "Post notes?", "answer": "Yes, Thursday"},
        {"ask": "Who else?", "answer": "Tag Jess"},
    ]
    assert note["facts"] is None
    message, note = teach.parse_turn("<think>hmm</think>MESSAGE: Hi,\n\nSure thing.\nTELL: Tuesday works.")
    assert (message, note["facts"], note["answers"]) == ("Hi,\n\nSure thing.", "Tuesday works.", [])
    assert teach.parse_turn("Sure! Here's a message.") is None
    assert teach.parse_turn("MESSAGE: \nTELL: x") is None


def test_chips_describe_what_a_reply_shows():
    codes = lambda chips: [(c["code"], c["value"]) for c in chips]  # noqa: E731
    chat = teach.reply_chips("yep will do, tag jess so support's in the loop", "yep no wait will do", "team_chat", [])
    assert codes(chat)[:4] == [
        ("correction_resolved", None),
        ("no_greeting", None),
        ("lowercase_start", None),
        ("no_final_period", None),
    ]
    email = teach.reply_chips("Hi Priya,\n\nTuesday morning works.\n\nThanks!", None, "email", [])
    assert codes(email) == [("greeting", "Hi Priya,"), ("sign_off", "Thanks!")]
    agent = teach.reply_chips("keep them\nclear capitalize_first too", None, "coding_agent", ["Herga"])
    assert ("kept_exact", "capitalize_first") in codes(agent)
    assert ("line_per_thought", None) in codes(agent)


def test_a_style_without_its_own_kinds_starts_with_chat_email_and_a_text():
    session = teach.start("personal", [], [])
    assert [c.kind for c in session.conversations] == list(teach.FALLBACK_KINDS)
    # Three different openers, each with the facts for the answer.
    assert len({c.seeds_used[0] for c in session.conversations}) == 3
    assert all(c.note for c in session.conversations)


def test_herga_dictation_follows_the_taught_style_only_while_teaching(monkeypatch):
    snapshot = styles.Snapshot(
        (
            styles.Style("personal", "Personal", 0, True, "standard", True),
            styles.Style("chat", "Chat", 1, False, "casual", True),
        )
    )
    session = teach.start("chat", [], [])
    assert snapshot.for_app(styles.HERGA_BUNDLE).id == "chat"
    assert snapshot.for_app("com.tinyspeck.slackmacgap").id == "personal"
    teach.discard(session.id)
    assert snapshot.for_app(styles.HERGA_BUNDLE).id == "personal"


@pytest.mark.asyncio
async def test_an_unusable_turn_falls_back_to_a_written_opener():
    session = teach.start("personal", ["team_chat"], [])
    conversation = session.conversations[0]
    teach.record_reply(session.id, conversation.id, "sounds good", None)
    await teach.next_turn(session.id, conversation.id, "0.6B", generate=_Model("Sure thing!").generate)
    assert conversation.messages[-1][1] in {s.message for s in teach.seeds_of("team_chat")}
    assert len(conversation.seeds_used) == 2
    assert conversation.note


def test_a_dictated_reply_teaches_and_a_typed_one_only_gets_chips(api):
    client, session, model = api
    started = client.post("/writing-style/teach").json()
    assert started["target"] == teach.TARGET_REPLIES
    first, second = started["conversations"][0], started["conversations"][1]
    turn = teach.conversation(teach.get(started["session_id"]), first["id"]).turn_started_at

    # Dictated in Herga's window this turn; another app's dictation doesn't count.
    _dictate(session, "yeah no wait yep still good for thursday", "Yeah, no wait, yep, still good for Thursday.", turn)
    _dictate(session, "unrelated", "Unrelated.", turn, app="com.apple.mail")
    base = f"/writing-style/teach/{started['session_id']}/conversations"
    assert client.get(f"{base}/{first['id']}/dictated").json() == {
        "text": "Yeah, no wait, yep, still good for Thursday."
    }
    replied = client.post(f"{base}/{first['id']}/replies", json={"written": "yep still good for thursday"}).json()
    conversation = next(c for c in replied["conversations"] if c["id"] == first["id"])
    assert conversation["reply_count"] == 1
    assert conversation["messages"][-1] == {"from_you": False, "text": "nice. can you post the release notes too?"}
    assert conversation["note"]["answers"][0] == {"ask": "Post notes?", "answer": "Yes, Thursday"}
    assert {"code": "correction_resolved", "value": None} in conversation["chips"]
    assert model.calls[-1]["prompt"].endswith("User: yep still good for thursday")

    client.post(f"{base}/{second['id']}/replies", json={"written": "Typed it instead."})
    result = client.post(f"/writing-style/teach/{started['session_id']}/finish").json()
    assert (result["replies"], result["dictated"]) == (2, 1)
    assert result["status"]["runs"] == 1
    # No dictation elsewhere yet: the longest reply dictated this run is the preview.
    assert result["before"] == "Plain: yeah no wait yep still good for thursday"
    assert writing_style.calibration_examples()[0]["said"] == "yeah no wait yep still good for thursday"
    assert styles.teaching_style() is None


def test_sessions_can_add_replace_wrap_and_expire(api):
    client, _, _ = api
    started = client.post("/writing-style/teach").json()
    base = f"/writing-style/teach/{started['session_id']}"
    added = client.post(f"{base}/conversations", json={"kind": "coding_agent"}).json()
    assert added["conversations"][-1]["kind"] == "coding_agent"
    assert client.post(f"{base}/conversations", json={"kind": "poem"}).status_code == 422
    newest = added["conversations"][-1]["id"]
    # Without replies, a new theme replaces the conversation in place.
    replaced = client.post(f"{base}/conversations/{newest}/new-theme").json()
    assert len(replaced["conversations"]) == 4
    assert replaced["conversations"][-1]["id"] != newest
    assert replaced["conversations"][-1]["kind"] == "coding_agent"
    wrapped = client.post(f"{base}/conversations/{replaced['conversations'][0]['id']}/wrap-up").json()
    assert wrapped["conversations"][0]["wrapped"] is True
    assert client.post(f"{base}/finish").status_code == 400
    client.delete(base)
    assert client.post(f"{base}/conversations", json={"kind": "email"}).status_code == 404
