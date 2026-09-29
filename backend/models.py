"""
Pydantic models for request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

from .services.commands import default_transforms
from .utils.capture_chords import (
    default_command_chord,
    default_push_to_talk_chord,
    default_toggle_to_talk_chord,
)


class TranscriptionRequest(BaseModel):
    """Request model for audio transcription."""

    language: Optional[str] = Field(None, pattern="^(en|zh|ja|ko|de|fr|ru|pt|es|it)$")
    model: Optional[str] = Field(None, pattern="^(base|small|medium|large|turbo)$")


class TranscriptionResponse(BaseModel):
    """Response model for transcription."""

    text: str
    duration: float


class RefinementFlagsModel(BaseModel):
    """Boolean toggles that drive the refinement prompt builder."""

    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True
    punctuation_style: str = Field(default="standard", pattern="^(standard|casual|learned)$")
    capitalize_first: bool = True
    # The writing style whose habits, examples and rules were used.
    style: Optional[str] = None


class RefinementReviewModel(BaseModel):
    """Why a capture's cleanup is flagged for the user to check."""

    outcome: Literal["review", "reject"]
    added: List[str] = []
    missing: List[str] = []
    reasons: List[str] = []


class CaptureResponse(BaseModel):
    """Response model for a capture."""

    id: str
    audio_path: str
    source: str
    language: Optional[str] = None
    duration_ms: Optional[int] = None
    transcript_raw: str
    transcript_refined: Optional[str] = None
    stt_model: Optional[str] = None
    llm_model: Optional[str] = None
    refinement_flags: Optional[RefinementFlagsModel] = None
    refinement_review: Optional[RefinementReviewModel] = None
    app_bundle_id: Optional[str] = None
    app_name: Optional[str] = None
    # Command captures (docs/plans/COMMAND_MODE.md).
    command_selection: Optional[str] = None
    command_instruction: Optional[str] = None
    command_transform: Optional[str] = None
    # The writing style the capture was cleaned up with.
    style_id: Optional[str] = None
    # The recording was deleted once its transcript was saved.
    audio_deleted: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class CaptureListResponse(BaseModel):
    """Response model for paginated capture list."""

    items: List[CaptureResponse]
    total: int


class CaptureAppCount(BaseModel):
    """One app in the Captures app list: how many captures went to it.

    ``style_id`` is the style its dictation uses; ``confirmed`` is False while
    that is only the default because the user hasn't chosen one.
    """

    app_bundle_id: str
    app_name: Optional[str] = None
    count: int
    last_captured_at: Optional[datetime] = None
    style_id: Optional[str] = None
    confirmed: bool = False
    # Until confirmed: the style most apps of its App Store category use.
    suggested_style_id: Optional[str] = None


class CaptureAppsResponse(BaseModel):
    """``GET /captures/apps``: capture counts per app, most first.

    ``unknown_count`` is the captures with no app recorded: uploads, and
    dictation from before the target app was saved.
    """

    total: int
    unknown_count: int
    apps: List[CaptureAppCount]


class UsageDay(BaseModel):
    """Words dictated on one local day."""

    date: str
    words: int


class UsageTotals(BaseModel):
    """One period's dictation, for all apps or one.

    ``pace_wpm`` is the median pace of captures of 2 s and longer (None when
    there are none). ``time_saved_ms`` is the typing time the words would
    have taken, less the time spent speaking them.
    """

    words: int = 0
    captures: int = 0
    speaking_ms: int = 0
    pace_wpm: int | None = None
    time_saved_ms: int = 0
    # Captures with a saved correction: a lower bound on those that needed a fix.
    fixed_captures: int = 0
    weekdays_dictated: int = 0
    weekdays_in_period: int = 0
    weekend_days: list[UsageDay] = Field(default_factory=list)
    hours_dictated: int = 0


class UsagePoint(BaseModel):
    """One point of the words chart: an hour, a day or a week (``start``, local).

    ``words`` is None for an hour still to come today. The previous period's
    matching point is None for All time, which has nothing to compare with.
    """

    start: str
    words: int | None = None
    previous_start: str | None = None
    previous_words: int | None = None


class UsageApp(BaseModel):
    """One app's share of the period, for "Where you dictate". None is no app recorded."""

    app_bundle_id: str | None = None
    words: int
    captures: int


class UsageLengths(BaseModel):
    """How long dictations run: counts per length bin, and the quartiles."""

    bin_edges_s: list[int]
    counts: list[int]
    p25_ms: int | None = None
    median_ms: int | None = None
    p75_ms: int | None = None


class UsageStatsResponse(BaseModel):
    """``GET /captures/stats``: one period's dictation, for the Captures card and Insights.

    Dates are the Mac's local days. ``current`` and everything after it follow
    the app filter; ``all_apps`` and ``apps`` are always every app's, for
    comparison. ``heatmap`` is words by local weekday (Monday first) and hour.
    """

    period: Literal["today", "7d", "30d", "all"]
    bucket: Literal["hour", "day", "week"]
    start: str
    end: str
    previous_start: str | None = None
    previous_end: str | None = None
    typing_wpm: int
    current: UsageTotals
    previous: UsageTotals | None = None
    all_apps: UsageTotals
    series: list[UsagePoint]
    apps: list[UsageApp]
    heatmap: list[list[int]]
    lengths: UsageLengths


class CaptureCreateResponse(CaptureResponse):
    """
    Response model for ``POST /captures``.

    Adds ``auto_refine`` and ``allow_auto_paste`` — the server-side settings
    captured at the moment the capture was created. The client reads these to
    decide whether to chain a refinement request and whether to fire the
    synthetic-paste pipeline, so it doesn't need a synced local copy of the
    capture_settings table across sibling Tauri webviews.
    """

    auto_refine: bool
    allow_auto_paste: bool


class CaptureRefineRequest(BaseModel):
    """Request to refine a capture's transcript via the LLM."""

    flags: Optional[RefinementFlagsModel] = None
    model_size: Optional[str] = Field(default=None, pattern="^(0\\.6B|1\\.7B|4B)$")


class CaptureRetranscribeRequest(BaseModel):
    """Request to re-run STT on a capture's audio with a different model."""

    model: Optional[str] = Field(None, pattern="^(base|small|medium|large|turbo)$")
    language: Optional[str] = Field(None, pattern="^(en|zh|ja|ko|de|fr|ru|pt|es|it)$")


class Transform(BaseModel):
    """A saved Command Mode instruction, run by saying its name."""

    id: Optional[str] = None
    name: str
    instruction: str


# The history retention choices in days; 0 keeps captures forever.
HistoryRetentionDays = Literal[0, 7, 30, 90, 365]


class RetentionPreviewResponse(BaseModel):
    """How many captures a retention of ``days`` would delete now."""

    days: HistoryRetentionDays
    expiring: int


class RetentionStatusResponse(BaseModel):
    """Whether the app should ask before history retention first deletes anything."""

    days: HistoryRetentionDays
    confirmed: bool
    # Captures the current window would delete once confirmed.
    expiring: int


class CaptureSettingsResponse(BaseModel):
    """Server-persisted defaults for the capture / refine flow."""

    stt_model: str = Field(default="turbo", pattern="^(base|small|medium|large|turbo)$")
    language: str = Field(default="auto")
    auto_refine: bool = True
    llm_model: str = Field(default="0.6B", pattern="^(0\\.6B|1\\.7B|4B)$")
    smart_cleanup: bool = True
    self_correction: bool = True
    preserve_technical: bool = True
    punctuation_style: str = Field(default="standard", pattern="^(standard|casual|learned)$")
    allow_auto_paste: bool = True
    live_text: bool = False
    voice_edits: bool = True
    sound_cues: bool = True
    sound_cue_volume: float = Field(default=0.5, ge=0, le=1)
    input_device_id: Optional[str] = Field(
        default=None, description="Configured audio input deviceId (None means default microphone)"
    )
    hotkey_enabled: bool = False
    chord_push_to_talk_keys: List[str] = Field(
        default_factory=default_push_to_talk_chord
    )
    chord_toggle_to_talk_keys: List[str] = Field(
        default_factory=default_toggle_to_talk_chord
    )
    chord_command_keys: List[str] = Field(default_factory=default_command_chord)
    command_transforms: List[Transform] = Field(default_factory=default_transforms)
    # Days of capture history to keep; 0 keeps it forever.
    history_retention_days: HistoryRetentionDays = 30
    # Set by saving history_retention_days; the sweep deletes nothing until then.
    history_retention_confirmed: bool = False
    onboarding_completed: bool = False
    # Delete each recording once its transcript is saved.
    discard_audio: bool = False

    class Config:
        from_attributes = True


class CaptureSettingsUpdate(BaseModel):
    """Partial update for capture settings — every field is optional."""

    stt_model: Optional[str] = Field(default=None, pattern="^(base|small|medium|large|turbo)$")
    language: Optional[str] = None
    auto_refine: Optional[bool] = None
    llm_model: Optional[str] = Field(default=None, pattern="^(0\\.6B|1\\.7B|4B)$")
    smart_cleanup: Optional[bool] = None
    self_correction: Optional[bool] = None
    preserve_technical: Optional[bool] = None
    punctuation_style: Optional[str] = Field(default=None, pattern="^(standard|casual|learned)$")
    allow_auto_paste: Optional[bool] = None
    live_text: Optional[bool] = None
    voice_edits: Optional[bool] = None
    sound_cues: Optional[bool] = None
    sound_cue_volume: Optional[float] = Field(default=None, ge=0, le=1)
    input_device_id: Optional[str] = Field(
        default=None, description="Configured audio input deviceId (None means default microphone)"
    )
    hotkey_enabled: Optional[bool] = None
    chord_push_to_talk_keys: Optional[List[str]] = Field(default=None, min_length=1, max_length=6)
    chord_toggle_to_talk_keys: Optional[List[str]] = Field(default=None, min_length=1, max_length=6)
    # Empty turns Command Mode's chord off.
    chord_command_keys: Optional[List[str]] = Field(default=None, max_length=6)
    command_transforms: Optional[List[Transform]] = None
    history_retention_days: Optional[HistoryRetentionDays] = None
    onboarding_completed: Optional[bool] = None
    discard_audio: Optional[bool] = None


class CommandRunRequest(BaseModel):
    """``POST /commands/run``: rewrite a selection without a recording.

    With ``capture_id``, the instruction is that capture's transcript (a
    command recording saved through the batch upload).
    """

    selection: str
    instruction: Optional[str] = None
    capture_id: Optional[str] = None
    app_bundle_id: Optional[str] = None
    app_name: Optional[str] = None


class LLMGenerateRequest(BaseModel):
    """Request model for LLM text generation."""

    prompt: str = Field(..., min_length=1, max_length=50000)
    system: Optional[str] = Field(None, max_length=4000)
    model_size: Optional[str] = Field(default="0.6B", pattern="^(0\\.6B|1\\.7B|4B)$")
    max_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    # Few-shot (user, assistant) pairs prepended as real chat turns.
    # Used by the refinement service to pin tricky rules (imperatives
    # staying imperatives, technical-term punctuation) that small models
    # lose when the examples live inline in the system prompt.
    examples: Optional[List[List[str]]] = Field(default=None, max_length=8)


class LLMGenerateResponse(BaseModel):
    """Response model for LLM text generation."""

    text: str
    model_size: str


class ModelReadiness(BaseModel):
    """Per-model entry in the dictation readiness checklist.

    ``model_name`` is the canonical id used by ``POST /models/download`` so the
    frontend can wire a one-click "Download" button without a second lookup.
    ``size`` is the user's chosen variant (e.g. "turbo", "0.6B"); ``display_name``
    is what the checklist row should show ("Whisper Turbo").
    """

    ready: bool
    model_name: str
    display_name: str
    size: str
    size_mb: Optional[int] = None


class CaptureReadinessResponse(BaseModel):
    """Backend gates that must be green before the global hotkey will fire.

    The frontend combines this with its own TCC permission checks (input
    monitoring, accessibility) into the full dictation readiness checklist.
    Hotkey-enabled is the user's intent toggle and lives outside this struct.
    """

    stt: ModelReadiness
    llm: ModelReadiness


class HealthResponse(BaseModel):
    """Response model for health check."""

    status: str
    model_loaded: bool  # Whether a Whisper model is loaded
    model_downloaded: Optional[bool] = None  # Whether the configured Whisper model is cached
    model_size: Optional[str] = None  # Loaded Whisper model size
    gpu_available: bool
    gpu_type: Optional[str] = None  # "Metal (Apple Silicon via MLX)", "MPS (Apple Silicon)", or None
    backend_type: Optional[str] = None  # Always "mlx"
    version: Optional[str] = None
    started_at: Optional[float] = None  # Server process start, Unix seconds
    pid: Optional[int] = None
    peak_memory_mb: Optional[int] = None  # Peak resident memory of the server process


class DirectoryCheck(BaseModel):
    """Health status for a single directory."""

    path: str
    exists: bool
    writable: bool
    error: Optional[str] = None


class FilesystemHealthResponse(BaseModel):
    """Response model for filesystem health check."""

    healthy: bool
    disk_free_mb: Optional[float] = None
    disk_total_mb: Optional[float] = None
    directories: List[DirectoryCheck]


class ModelStatus(BaseModel):
    """Response model for model status."""

    model_name: str
    display_name: str
    hf_repo_id: Optional[str] = None  # HuggingFace repository ID
    downloaded: bool
    downloading: bool = False  # True if download is in progress
    size_mb: Optional[float] = None
    loaded: bool = False


class ModelStatusListResponse(BaseModel):
    """Response model for model status list."""

    models: List[ModelStatus]


class ModelDownloadRequest(BaseModel):
    """Request model for triggering model download."""

    model_name: str


class ModelMigrateRequest(BaseModel):
    """Request model for migrating models to a new directory."""

    destination: str


class ActiveDownloadTask(BaseModel):
    """Response model for active download task."""

    model_name: str
    status: str
    started_at: datetime
    error: Optional[str] = None
    progress: Optional[float] = None  # 0-100 percentage
    current: Optional[int] = None  # bytes downloaded
    total: Optional[int] = None  # total bytes
    filename: Optional[str] = None  # current file being downloaded


class ActiveTasksResponse(BaseModel):
    """Response model for active tasks."""

    downloads: List[ActiveDownloadTask]


CaptureFeedbackSource = Literal["manual", "voice_fix", "redictation"]


class CaptureFeedbackCreate(BaseModel):
    target: Literal["raw", "refined"]
    expected_text: str = Field(max_length=100000)
    notes: str = Field(default="", max_length=5000)
    snapshot: CaptureResponse
    # See CaptureFeedback.source (docs/plans/CORRECTION_LEARNING.md).
    source: CaptureFeedbackSource = "manual"


class WritingStyleStatus(BaseModel):
    """What Kass has learned about how the user punctuates."""

    ready: bool
    runs: int
    last_run_at: Optional[str] = None
    example_count: int
    habits: List[str]


class PersonalExample(BaseModel):
    """One "when I say this, I mean this" example cleanup learns from."""

    id: str
    source: Literal["correction", "calibration"]
    said: str
    meant: str
    created_at: Optional[str] = None
    # The app a correction was made in.
    app_bundle_id: Optional[str] = None
    app_name: Optional[str] = None


class WritingStyleModel(BaseModel):
    """A named writing style and its settings (docs/plans/PER_APP_STYLE.md)."""

    id: str
    name: str
    position: int
    is_default: bool
    punctuation_style: str
    preserve_technical: bool
    # How the user says they write in this style's apps.
    description: str = ""


class StyledApp(BaseModel):
    """An app on the Writing style page: the style it uses and whether the user chose it.

    ``corrections`` counts its captures whose corrections teach that style;
    ``suggested_style_id`` is set until the user chooses.
    """

    bundle_id: str
    name: Optional[str] = None
    style_id: str
    confirmed: bool
    count: int = 0
    corrections: int = 0
    suggested_style_id: Optional[str] = None


class WritingStylesResponse(BaseModel):
    styles: List[WritingStyleModel]
    apps: List[StyledApp]
    max_styles: int
    # Memory each style's cached prompt takes in the cleanup model, estimated.
    cache_mb_per_style: Optional[int] = None


class WritingStyleCreate(BaseModel):
    name: str = Field(..., max_length=80)


class WritingStyleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=80)
    punctuation_style: Optional[str] = Field(default=None, pattern="^(standard|casual|learned)$")
    preserve_technical: Optional[bool] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    # Only true is meaningful: another style becomes the default by being made it.
    is_default: Optional[bool] = None


class AppStyleAssign(BaseModel):
    style_id: str
    app_name: Optional[str] = Field(default=None, max_length=255)
    # The app's corrections: "bring" them to the new style, or "leave" them teaching the current one.
    corrections: Literal["bring", "leave"] = "bring"


class AppToConfirm(BaseModel):
    bundle_id: str = Field(min_length=1, max_length=255)
    app_name: Optional[str] = Field(default=None, max_length=255)


class AppsConfirm(BaseModel):
    """New apps to keep in the style they already use."""

    apps: list[AppToConfirm] = Field(max_length=500)


class CorrectionNote(BaseModel):
    """One rule summarized from the user's older examples."""

    id: str
    text: str


class CorrectionNotesStatus(BaseModel):
    """Rules cleanup follows from examples too old to show the model."""

    notes: List[CorrectionNote]
    pending: int
    last_run: Optional[str] = None
    outcome: str


TeachKind = Literal[
    "coding_agent",
    "design_feedback",
    "notes",
    "writeup",
    "team_chat",
    "issue_comment",
    "email",
    "text_message",
]


class TeachAnswer(BaseModel):
    ask: str
    answer: str


class TeachNote(BaseModel):
    """The facts for the user's next reply, so they only choose the words."""

    facts: Optional[str] = None
    answers: List[TeachAnswer] = []
    # A teaching trick to try, with an example when the opener has one.
    trick: Optional[Literal["change_of_mind", "long"]] = None
    example: Optional[str] = None


class TeachMessage(BaseModel):
    from_you: bool
    text: str


class TeachChip(BaseModel):
    """Something a reply showed about how the user writes; the app words ``code``."""

    code: str
    value: Optional[str] = None


class TeachConversation(BaseModel):
    id: str
    kind: TeachKind
    persona: str
    relation: str
    title: Optional[str] = None
    messages: List[TeachMessage]
    note: Optional[TeachNote] = None
    reply_count: int
    chips: List[TeachChip]
    wrapped: bool


class TeachSession(BaseModel):
    """A teach session (docs/plans/TEACH_BY_REPLYING.md)."""

    session_id: str
    style_id: str
    target: int
    replies: int
    # The kinds that match the style's apps.
    suggested_kinds: List[TeachKind]
    conversations: List[TeachConversation]


class TeachConversationCreate(BaseModel):
    kind: TeachKind


class TeachReplyRequest(BaseModel):
    written: str = Field(..., max_length=4000)


class TeachDictated(BaseModel):
    text: Optional[str] = None


class TeachFinishResult(BaseModel):
    status: WritingStyleStatus
    before: Optional[str] = None
    after: Optional[str] = None
    replies: int
    # Replies that were dictated, and so teach cleanup.
    dictated: int


class CaptureFeedbackResponse(BaseModel):
    id: str
    capture_id: str
    target: Literal["raw", "refined"]
    expected_text: str
    notes: str
    snapshot: CaptureResponse
    source: CaptureFeedbackSource
    created_at: datetime


class DictionaryPlace(BaseModel):
    """Where a dictionary entry applies: everywhere, a writing style, or an app."""

    scope: Literal["global", "style", "app"]
    scope_id: str | None = Field(default=None, max_length=255)
    app_name: str | None = Field(default=None, max_length=255)


class DictionaryEntryModel(BaseModel):
    """A word dictation should get right, in every place it applies (docs/plans/DICTIONARIES.md)."""

    id: str
    written: str
    spoken: str | None = None
    places: list[DictionaryPlace]
    created_at: datetime | None = None
    # Off: only fixed where spelled exactly, never swapped in for a word that sounds like it.
    match_sound: bool = True
    # "spoken_fix": added by itself when the user spelled the word aloud to fix it.
    source: Literal["user", "spoken_fix"] = "user"


class DictionaryResponse(BaseModel):
    entries: list[DictionaryEntryModel]


class DictionaryEntryCreate(BaseModel):
    written: str = Field(max_length=1000)
    spoken: str | None = Field(default=None, max_length=1000)
    places: list[DictionaryPlace] = Field(min_length=1, max_length=100)
    match_sound: bool = True


class DictionaryEntryUpdate(BaseModel):
    written: str | None = Field(default=None, max_length=1000)
    spoken: str | None = Field(default=None, max_length=1000)
    places: list[DictionaryPlace] | None = Field(default=None, min_length=1, max_length=100)
    match_sound: bool | None = None


class ResolvedDictionaryEntry(BaseModel):
    """One place an entry applies to an app from; ``id`` is the entry's."""

    id: str
    scope: Literal["global", "style", "app"]
    scope_id: str | None = None
    app_name: str | None = None
    written: str
    spoken: str | None = None
    created_at: datetime | None = None
    match_sound: bool = True
    # A more specific place has an entry for the same word said.
    overridden: bool = False


class ResolvedDictionaryResponse(BaseModel):
    """What one app's dictations use."""

    entries: list[ResolvedDictionaryEntry]
    # Terms Whisper is prompted with, and those that don't fit its prompt.
    prompt_terms: list[str]
    dropped_terms: list[str]
