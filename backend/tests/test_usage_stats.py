"""Usage stats for the Captures card and Insights: local days, deltas, pace, time saved, apps."""

import time
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.database.models import Base, Capture, CaptureFeedback
from backend.services.usage_stats import TYPING_WPM, AppScope, usage_stats

# Monday, Sep 28 2026, 10:00 in Denver (MDT, UTC-6).
NOW = datetime(2026, 9, 28, 10, 0)


@pytest.fixture(autouse=True)
def denver(monkeypatch):
    """The Mac's zone, as SQLite's localtime and Python both read it."""
    monkeypatch.setenv("TZ", "America/Denver")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def add(db, utc, words=10, raw=None, duration_ms=6000, app="com.apple.mail", source="dictation", fixed=False):
    """A capture at naive UTC ``utc`` whose refined text has ``words`` words."""
    capture = Capture(
        audio_path="captures/x.wav",
        source=source,
        transcript_raw=" ".join(["um"] * (raw if raw is not None else words)),
        transcript_refined=" ".join(["word"] * words),
        duration_ms=duration_ms,
        app_bundle_id=app,
        app_name=app,
        created_at=utc,
    )
    db.add(capture)
    db.commit()
    if fixed:
        db.add(CaptureFeedback(capture_id=capture.id, target="refined", expected_text="x", snapshot="{}"))
        db.commit()
    return capture


def point(stats, start):
    return next(p for p in stats.series if p.start == start)


def test_groups_by_local_day_and_hour(db):
    # 03:30 UTC on the 28th is 21:30 on Sunday the 27th in Denver.
    add(db, datetime(2026, 9, 28, 3, 30), words=5)
    # 06:30 UTC is 00:30 on Monday the 28th.
    add(db, datetime(2026, 9, 28, 6, 30), words=7)

    week = usage_stats(db, "7d", now=NOW)
    assert point(week, "2026-09-27").words == 5
    assert point(week, "2026-09-28").words == 7
    assert week.heatmap[6][21] == 5  # Sunday, 9p
    assert week.heatmap[0][0] == 7  # Monday, 12a

    today = usage_stats(db, "today", now=NOW)
    assert today.current.words == 7
    assert today.previous.words == 5
    assert point(today, "2026-09-28T00:00").words == 7
    assert point(today, "2026-09-28T00:00").previous_words == 0
    assert point(today, "2026-09-28T21:00").previous_words == 5
    # Hours still to come today have no value yet.
    assert point(today, "2026-09-28T10:00").words == 0
    assert point(today, "2026-09-28T11:00").words is None


def test_local_days_follow_daylight_saving(db):
    # Denver leaves daylight saving on Nov 1 2026: 06:30 UTC on Nov 2 is 23:30
    # on Nov 1 (MST, UTC-7), where the summer offset would have said Nov 2.
    add(db, datetime(2026, 11, 2, 6, 30), words=4)

    stats = usage_stats(db, "7d", now=datetime(2026, 11, 3, 12, 0))

    assert point(stats, "2026-11-01").words == 4
    assert stats.heatmap[6][23] == 4


def test_compares_with_the_equal_period_before(db):
    add(db, datetime(2026, 9, 23, 16, 0), words=30)  # this week
    add(db, datetime(2026, 9, 24, 16, 0), words=30)
    add(db, datetime(2026, 9, 16, 16, 0), words=40)  # the week before
    add(db, datetime(2026, 9, 14, 16, 0), words=1000)  # before that

    stats = usage_stats(db, "7d", now=NOW)

    assert (stats.start, stats.end) == ("2026-09-22", "2026-09-28")
    assert (stats.previous_start, stats.previous_end) == ("2026-09-15", "2026-09-21")
    assert stats.current.words == 60
    assert stats.previous.words == 40
    wed = point(stats, "2026-09-23")
    assert (wed.previous_start, wed.previous_words) == ("2026-09-16", 40)


def test_all_time_is_weekly_with_nothing_to_compare(db):
    add(db, datetime(2026, 9, 9, 16, 0), words=3)  # Wednesday of the week of Sep 7
    add(db, datetime(2026, 9, 28, 16, 0), words=5)

    stats = usage_stats(db, "all", now=NOW)

    assert stats.bucket == "week"
    assert stats.previous is None
    assert [(p.start, p.words) for p in stats.series] == [
        ("2026-09-07", 3),
        ("2026-09-14", 0),
        ("2026-09-21", 0),
        ("2026-09-28", 5),
    ]
    assert stats.current.weekdays_in_period == 14  # Sep 9 through Sep 28


def test_counts_weekdays_and_weekend_days(db):
    add(db, datetime(2026, 9, 22, 16, 0))  # Tue
    add(db, datetime(2026, 9, 22, 18, 0))  # Tue again
    add(db, datetime(2026, 9, 25, 16, 0))  # Fri
    add(db, datetime(2026, 9, 27, 16, 0), words=12)  # Sun

    totals = usage_stats(db, "7d", now=NOW).current

    assert totals.weekdays_dictated == 2
    assert totals.weekdays_in_period == 5
    assert [(d.date, d.words) for d in totals.weekend_days] == [("2026-09-27", 12)]


def test_pace_is_the_median_of_raw_words_over_captures_of_two_seconds_and_up(db):
    add(db, datetime(2026, 9, 28, 14, 0), raw=10, duration_ms=6000)  # 100 wpm
    add(db, datetime(2026, 9, 28, 14, 1), raw=20, duration_ms=6000)  # 200 wpm
    add(db, datetime(2026, 9, 28, 14, 2), raw=30, duration_ms=6000)  # 300 wpm
    add(db, datetime(2026, 9, 28, 14, 3), raw=10, duration_ms=1000)  # 600 wpm, too short

    assert usage_stats(db, "today", now=NOW).current.pace_wpm == 200


def test_time_saved_is_typing_time_less_speaking_time(db):
    add(db, datetime(2026, 9, 28, 14, 0), words=80, raw=90, duration_ms=30_000)

    totals = usage_stats(db, "today", now=NOW).current

    typing_ms = 80 / TYPING_WPM * 60_000
    assert totals.time_saved_ms == typing_ms - 30_000
    assert totals.speaking_ms == 30_000


def test_filters_to_an_app_and_to_unknown(db):
    add(db, datetime(2026, 9, 28, 14, 0), words=10, app="com.apple.mail", fixed=True)
    add(db, datetime(2026, 9, 28, 14, 5), words=20, app="com.apple.mail")
    add(db, datetime(2026, 9, 28, 14, 10), words=30, app="com.tinyspeck.slackmacgap")
    add(db, datetime(2026, 9, 28, 14, 15), words=40, app=None)
    add(db, datetime(2026, 9, 28, 14, 20), words=500, source="command")

    everything = usage_stats(db, "today", now=NOW)
    mail = usage_stats(db, "today", AppScope(bundle_id="com.apple.mail"), now=NOW)
    unknown = usage_stats(db, "today", AppScope(unknown=True), now=NOW)

    assert everything.current.words == 100  # the command is left out
    assert (mail.current.words, mail.current.captures, mail.current.fixed_captures) == (30, 2, 1)
    assert unknown.current.words == 40
    # Every app's totals and shares stay beside the filtered ones.
    assert mail.all_apps.words == 100
    # Most words first, more captures breaking a tie, and no app last.
    assert [(a.app_bundle_id, a.words) for a in mail.apps] == [
        ("com.apple.mail", 30),
        ("com.tinyspeck.slackmacgap", 30),
        (None, 40),
    ]


def test_lengths_bin_and_quartiles(db):
    for seconds in (1, 4, 4, 8, 15, 25, 50):
        add(db, datetime(2026, 9, 28, 14, 0), duration_ms=seconds * 1000)

    lengths = usage_stats(db, "today", now=NOW).lengths

    assert lengths.counts == [1, 2, 1, 1, 1, 1]
    assert lengths.median_ms == 8000
    assert (lengths.p25_ms, lengths.p75_ms) == (4000, 20_000)


def test_empty_database(db):
    stats = usage_stats(db, "all", now=NOW)

    assert stats.current.words == 0
    assert stats.current.pace_wpm is None
    assert stats.lengths.median_ms is None
    assert [p.start for p in stats.series] == ["2026-09-28"]


def test_endpoint_checks_the_period(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.database import get_db
    from backend.routes.captures import router

    add(db, datetime.now(UTC).replace(tzinfo=None), words=9, app=None)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    assert client.get("/captures/stats", params={"period": "year"}).status_code == 400
    body = client.get("/captures/stats", params={"period": "today", "unknown_app": "true"}).json()
    assert body["current"]["words"] == 9
    assert body["typing_wpm"] == TYPING_WPM
