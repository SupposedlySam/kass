"""
Usage stats for the Captures summary card and the Insights tab.

Everything is counted from the captures table with two queries: one sums
words, captures, speaking time and fixes per local hour and app, and one
reads each capture's length and raw word count for the medians. Command
captures are left out, since they rewrite a selection rather than dictate.
Captures history retention deleted count from their ``RetiredCapture`` rows
(docs/plans/HISTORY_RETENTION.md), so deleting history never lowers a total.

Days and hours are the Mac's local time. ``created_at`` is naive UTC, and
SQLite's ``localtime`` modifier converts it with the same zone rules as the
rest of the Mac, daylight saving included.
"""

import statistics
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from sqlalchemy import case, exists, func, literal_column
from sqlalchemy.orm import Session

from ..database import Capture as DBCapture, CaptureFeedback, RetiredCapture
from ..models import (
    UsageApp,
    UsageDay,
    UsageLengths,
    UsagePoint,
    UsageStatsResponse,
    UsageTotals,
)

Period = Literal["today", "7d", "30d", "all"]
PERIODS: tuple[Period, ...] = ("today", "7d", "30d", "all")

# Typing speed that time saved is measured against.
TYPING_WPM = 40
# Shorter captures are mostly the start and stop of the recording, so their pace is noise.
MIN_PACE_MS = 2000
# "How long you talk" bins: under 3 s, 3-6 s, 6-10 s, 10-20 s, 20-40 s, 40 s and up.
LENGTH_BIN_EDGES_S = (3, 6, 10, 20, 40)

_DAYS: dict[str, int] = {"today": 1, "7d": 7, "30d": 30}
_WORDS_FN = "vb_word_count"


@dataclass(frozen=True)
class AppScope:
    """Which captures the stats count: every app's, one app's, or those with no app."""

    bundle_id: str | None = None
    unknown: bool = False

    def matches(self, bundle_id: str | None) -> bool:
        if self.unknown:
            return bundle_id is None
        return self.bundle_id is None or bundle_id == self.bundle_id


ALL_APPS = AppScope()


@dataclass
class _Slot:
    """One local hour of one app's dictation."""

    day: date
    hour: int
    app: str | None
    captures: int
    words: int
    speaking_ms: int
    fixed: int


@dataclass
class _Recording:
    """One capture's length and raw word count, for the medians."""

    day: date
    app: str | None
    duration_ms: int
    raw_words: int


@dataclass
class _Window:
    start: date
    end: date  # inclusive
    slots: list[_Slot] = field(default_factory=list)
    recordings: list[_Recording] = field(default_factory=list)


def _word_count(text: str | None) -> int:
    # Words as the Captures inspector counts them: runs of non-space.
    return len(text.split()) if text else 0


def _register_word_count(db: Session) -> None:
    """Lets SQL count words, so transcripts never leave SQLite."""
    driver = db.connection().connection.dbapi_connection
    driver.create_function(_WORDS_FN, 1, _word_count, deterministic=True)


def _utc(day: date) -> datetime:
    """Local midnight at the start of ``day``, as the naive UTC the table stores."""
    return datetime.combine(day, time()).astimezone(UTC).replace(tzinfo=None)


def _dictation(db: Session):
    return db.query(DBCapture).filter(DBCapture.source != "command")


def _retired(db: Session):
    # A capture still in the table was never deleted; count it once, from there.
    return db.query(RetiredCapture).filter(
        RetiredCapture.source != "command",
        ~exists().where(DBCapture.id == RetiredCapture.capture_id),
    )


def _first_day(db: Session) -> date | None:
    firsts = [
        _dictation(db).with_entities(func.min(func.datetime(DBCapture.created_at, "localtime"))).scalar(),
        _retired(db).with_entities(func.min(func.datetime(RetiredCapture.created_at, "localtime"))).scalar(),
    ]
    firsts = [first for first in firsts if first]
    return datetime.fromisoformat(min(firsts)).date() if firsts else None


def _slots(grouped) -> list[_Slot]:
    return [
        _Slot(
            day=date.fromisoformat(slot[:10]),
            hour=int(slot[11:13]),
            app=app,
            captures=count,
            words=int(words or 0),
            speaking_ms=int(speaking or 0),
            fixed=int(fixes or 0),
        )
        for slot, app, count, words, speaking, fixes in grouped
    ]


def _recordings(rows) -> list[_Recording]:
    return [
        _Recording(day=date.fromisoformat(day), app=app, duration_ms=duration, raw_words=raw)
        for day, app, duration, raw in rows
    ]


def _load(db: Session, start: date, end: date) -> tuple[list[_Slot], list[_Recording]]:
    """Every app's dictation from ``start`` to ``end``, local days inclusive."""
    _register_word_count(db)
    local = func.strftime("%Y-%m-%d %H", DBCapture.created_at, "localtime").label("slot")
    delivered = func.coalesce(func.nullif(func.trim(DBCapture.transcript_refined), ""), DBCapture.transcript_raw)
    fixed = case((exists().where(CaptureFeedback.capture_id == DBCapture.id), 1), else_=0)
    in_window = _dictation(db).filter(
        DBCapture.created_at >= _utc(start),
        DBCapture.created_at < _utc(end + timedelta(days=1)),
    )
    grouped = (
        in_window.with_entities(
            local,
            DBCapture.app_bundle_id,
            func.count(DBCapture.id),
            func.sum(getattr(func, _WORDS_FN)(delivered)),
            func.sum(func.coalesce(DBCapture.duration_ms, 0)),
            func.sum(fixed),
        )
        .group_by(literal_column("slot"), DBCapture.app_bundle_id)
        .all()
    )
    slots = _slots(grouped)
    lengths = in_window.with_entities(
        func.date(DBCapture.created_at, "localtime"),
        DBCapture.app_bundle_id,
        DBCapture.duration_ms,
        getattr(func, _WORDS_FN)(DBCapture.transcript_raw),
    ).filter(DBCapture.duration_ms > 0)
    recordings = _recordings(lengths.all())
    retired_slots, retired_recordings = _load_retired(db, start, end)
    return slots + retired_slots, recordings + retired_recordings


def _load_retired(db: Session, start: date, end: date) -> tuple[list[_Slot], list[_Recording]]:
    """``_load`` for captures history retention deleted. A slot may repeat one
    from ``_load``; everything that reads slots adds them up."""
    local = func.strftime("%Y-%m-%d %H", RetiredCapture.created_at, "localtime").label("slot")
    in_window = _retired(db).filter(
        RetiredCapture.created_at >= _utc(start),
        RetiredCapture.created_at < _utc(end + timedelta(days=1)),
    )
    grouped = (
        in_window.with_entities(
            local,
            RetiredCapture.app_bundle_id,
            func.count(RetiredCapture.capture_id),
            func.sum(RetiredCapture.words),
            func.sum(func.coalesce(RetiredCapture.duration_ms, 0)),
            func.sum(case((RetiredCapture.fixed, 1), else_=0)),
        )
        .group_by(literal_column("slot"), RetiredCapture.app_bundle_id)
        .all()
    )
    slots = _slots(grouped)
    lengths = in_window.with_entities(
        func.date(RetiredCapture.created_at, "localtime"),
        RetiredCapture.app_bundle_id,
        RetiredCapture.duration_ms,
        RetiredCapture.raw_words,
    ).filter(RetiredCapture.duration_ms > 0)
    recordings = _recordings(lengths.all())
    return slots, recordings


def _days(start: date, end: date) -> Iterable[date]:
    for offset in range((end - start).days + 1):
        yield start + timedelta(days=offset)


def _totals(window: _Window, scope: AppScope) -> UsageTotals:
    slots = [s for s in window.slots if scope.matches(s.app)]
    words = sum(s.words for s in slots)
    speaking_ms = sum(s.speaking_ms for s in slots)
    paces = [
        r.raw_words / (r.duration_ms / 60_000)
        for r in window.recordings
        if scope.matches(r.app) and r.duration_ms >= MIN_PACE_MS and r.raw_words
    ]
    by_day: dict[date, int] = defaultdict(int)
    for s in slots:
        by_day[s.day] += s.words
    # Every slot holds at least one capture, so these are the days dictated on.
    dictated = sorted(by_day)
    return UsageTotals(
        words=words,
        captures=sum(s.captures for s in slots),
        speaking_ms=speaking_ms,
        pace_wpm=round(statistics.median(paces)) if paces else None,
        time_saved_ms=max(0, round(words / TYPING_WPM * 60_000) - speaking_ms),
        fixed_captures=sum(s.fixed for s in slots),
        weekdays_dictated=sum(1 for d in dictated if d.weekday() < 5),
        weekdays_in_period=sum(1 for d in _days(window.start, window.end) if d.weekday() < 5),
        weekend_days=[UsageDay(date=d.isoformat(), words=by_day[d]) for d in dictated if d.weekday() >= 5],
        hours_dictated=len({(s.day, s.hour) for s in slots if s.captures}),
    )


def _sum_by(slots: Iterable[_Slot], key: Callable[[_Slot], object]) -> dict:
    sums: dict = defaultdict(int)
    for s in slots:
        sums[key(s)] += s.words
    return sums


def _series(period: Period, current: _Window, previous: _Window | None, scope: AppScope, now: datetime) -> list[UsagePoint]:
    """The words chart: hours for Today, days for 7 and 30 days, weeks for All time."""
    cur = [s for s in current.slots if scope.matches(s.app)]
    if period == "today":
        prev_day = previous.start if previous else None
        by_hour = _sum_by(cur, lambda s: s.hour)
        prev_by_hour = _sum_by((s for s in previous.slots if scope.matches(s.app)), lambda s: s.hour) if previous else {}
        return [
            UsagePoint(
                start=f"{current.start.isoformat()}T{hour:02d}:00",
                words=by_hour.get(hour, 0) if hour <= now.hour else None,
                previous_start=f"{prev_day.isoformat()}T{hour:02d}:00" if prev_day else None,
                previous_words=prev_by_hour.get(hour, 0) if previous else None,
            )
            for hour in range(24)
        ]
    if period == "all":
        by_week = _sum_by(cur, lambda s: s.day - timedelta(days=s.day.weekday()))
        week = current.start - timedelta(days=current.start.weekday())
        points = []
        while week <= current.end:
            points.append(UsagePoint(start=week.isoformat(), words=by_week.get(week, 0)))
            week += timedelta(days=7)
        return points
    by_day = _sum_by(cur, lambda s: s.day)
    prev_by_day = _sum_by((s for s in previous.slots if scope.matches(s.app)), lambda s: s.day) if previous else {}
    shift = (current.start - previous.start) if previous else None
    return [
        UsagePoint(
            start=day.isoformat(),
            words=by_day.get(day, 0),
            previous_start=(day - shift).isoformat() if shift else None,
            previous_words=prev_by_day.get(day - shift, 0) if shift else None,
        )
        for day in _days(current.start, current.end)
    ]


def _quantile(values: list[int], q: float) -> int | None:
    """Linear-interpolated quantile of sorted ``values``."""
    if not values:
        return None
    at = (len(values) - 1) * q
    low = int(at)
    high = min(low + 1, len(values) - 1)
    return round(values[low] + (values[high] - values[low]) * (at - low))


def _lengths(window: _Window, scope: AppScope) -> UsageLengths:
    durations = sorted(r.duration_ms for r in window.recordings if scope.matches(r.app))
    counts = [0] * (len(LENGTH_BIN_EDGES_S) + 1)
    for ms in durations:
        counts[sum(1 for edge in LENGTH_BIN_EDGES_S if ms >= edge * 1000)] += 1
    return UsageLengths(
        bin_edges_s=list(LENGTH_BIN_EDGES_S),
        counts=counts,
        p25_ms=_quantile(durations, 0.25),
        median_ms=_quantile(durations, 0.5),
        p75_ms=_quantile(durations, 0.75),
    )


def _heatmap(window: _Window, scope: AppScope) -> list[list[int]]:
    grid = [[0] * 24 for _ in range(7)]
    for s in window.slots:
        if scope.matches(s.app):
            grid[s.day.weekday()][s.hour] += s.words
    return grid


def _apps(window: _Window) -> list[UsageApp]:
    words: dict[str | None, int] = defaultdict(int)
    captures: dict[str | None, int] = defaultdict(int)
    for s in window.slots:
        words[s.app] += s.words
        captures[s.app] += s.captures
    apps = [UsageApp(app_bundle_id=app, words=words[app], captures=captures[app]) for app in words]
    # Unknown app last, like the app list.
    apps.sort(key=lambda a: (a.app_bundle_id is None, -a.words, -a.captures, a.app_bundle_id or ""))
    return apps


def _split(slots: list[_Slot], recordings: list[_Recording], window: _Window) -> _Window:
    window.slots = [s for s in slots if window.start <= s.day <= window.end]
    window.recordings = [r for r in recordings if window.start <= r.day <= window.end]
    return window


def usage_stats(
    db: Session,
    period: Period,
    scope: AppScope = ALL_APPS,
    now: datetime | None = None,
) -> UsageStatsResponse:
    """One period's dictation, through today: totals, the words chart, where,
    when and how long. ``now`` is local time (for tests). Every period but All
    time comes with the equal period before it."""
    now = now or datetime.now()
    today = now.date()
    if period == "all":
        start = min(_first_day(db) or today, today)
        current, previous = _Window(start, today), None
        load_from = start
    else:
        days = _DAYS[period]
        start = today - timedelta(days=days - 1)
        current = _Window(start, today)
        previous = _Window(start - timedelta(days=days), start - timedelta(days=1))
        load_from = previous.start

    slots, recordings = _load(db, load_from, today)
    _split(slots, recordings, current)
    if previous:
        _split(slots, recordings, previous)

    return UsageStatsResponse(
        period=period,
        bucket="hour" if period == "today" else "week" if period == "all" else "day",
        start=current.start.isoformat(),
        end=current.end.isoformat(),
        previous_start=previous.start.isoformat() if previous else None,
        previous_end=previous.end.isoformat() if previous else None,
        typing_wpm=TYPING_WPM,
        current=_totals(current, scope),
        previous=_totals(previous, scope) if previous else None,
        all_apps=_totals(current, ALL_APPS),
        series=_series(period, current, previous, scope, now),
        apps=_apps(current),
        heatmap=_heatmap(current, scope),
        lengths=_lengths(current, scope),
    )
