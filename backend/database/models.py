"""ORM model definitions for the voicebox SQLite database."""

from datetime import datetime
import uuid

from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Boolean, JSON, Float
from sqlalchemy.ext.declarative import declarative_base

from ..services.commands import default_transforms
from ..utils.capture_chords import (
    default_command_chord,
    default_push_to_talk_chord,
    default_toggle_to_talk_chord,
)

Base = declarative_base()


class CaptureSettings(Base):
    """Singleton row holding user defaults for the capture/refine flow.

    Kept server-side so every window, CLI client, and API consumer reads the
    same preferences. The ``id`` column is always 1.
    """

    __tablename__ = "capture_settings"

    id = Column(Integer, primary_key=True, default=1)
    stt_model = Column(String, nullable=False, default="turbo")
    language = Column(String, nullable=False, default="auto")
    auto_refine = Column(Boolean, nullable=False, default=True)
    llm_model = Column(String, nullable=False, default="0.6B")
    smart_cleanup = Column(Boolean, nullable=False, default=True)
    self_correction = Column(Boolean, nullable=False, default=True)
    preserve_technical = Column(Boolean, nullable=False, default=True)
    punctuation_style = Column(String, nullable=False, default="standard")
    allow_auto_paste = Column(Boolean, nullable=False, default=True)
    # Type cleaned text into the app while cleanup is still writing it
    # (docs/plans/STREAMING_INSERTION.md). Off until checked in more apps.
    live_text = Column(Boolean, nullable=False, default=False)
    # Chimes when dictation starts, stops or fails, played by the desktop app.
    sound_cues = Column(Boolean, nullable=False, default=True)
    sound_cue_volume = Column(Float, nullable=False, default=0.5)
    # Configured audio input deviceId (None means system default microphone)
    input_device_id = Column(String, nullable=True, default=None)
    # Default OFF — opting in is what triggers the macOS Input Monitoring TCC
    # prompt. We deliberately don't spawn the global keyboard tap until the
    # user flips this on so a fresh-install user doesn't see a scary
    # "Voicebox would like to receive keystrokes from any application" dialog
    # before they've even opened the Captures tab.
    hotkey_enabled = Column(Boolean, nullable=False, default=False)
    # Lists of keytap key names (e.g. "MetaRight", "ControlRight"). Right-hand
    # modifiers by default so they don't collide with left-hand shortcuts.
    chord_push_to_talk_keys = Column(
        JSON, nullable=False, default=default_push_to_talk_chord
    )
    chord_toggle_to_talk_keys = Column(
        JSON, nullable=False, default=default_toggle_to_talk_chord
    )
    # Command Mode (docs/plans/COMMAND_MODE.md): its chord (empty = off) and
    # the saved transforms ({id, name, instruction}). It rewrites on the
    # cleanup model, llm_model.
    chord_command_keys = Column(JSON, nullable=False, default=default_command_chord)
    command_transforms = Column(JSON, nullable=False, default=default_transforms)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Capture(Base):
    """A single voice input capture (dictation, recording, or uploaded file).

    Stores the original audio alongside the raw transcript and, optionally, a
    refined version produced by the LLM. Refinement flags are serialized as
    JSON so we can reproduce the prompt that generated the refined text.
    """

    __tablename__ = "captures"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    audio_path = Column(String, nullable=False)
    source = Column(String, nullable=False, default="file")  # dictation | recording | file | command
    language = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    transcript_raw = Column(Text, nullable=False, default="")
    transcript_refined = Column(Text, nullable=True)
    stt_model = Column(String, nullable=True)
    llm_model = Column(String, nullable=True)
    refinement_flags = Column(Text, nullable=True)  # JSON blob
    # JSON: what the content check found when cleanup may have added or lost content.
    refinement_review = Column(Text, nullable=True)
    # The app that had focus when dictation started (None for uploads and
    # for dictation inside Voicebox itself).
    app_bundle_id = Column(String, nullable=True)
    app_name = Column(String, nullable=True)
    # Command captures: the text that was selected, the instruction that ran
    # (a transform's, when one was named) and that transform's name.
    # transcript_raw is what was said, transcript_refined the rewrite.
    command_selection = Column(Text, nullable=True)
    command_instruction = Column(Text, nullable=True)
    command_transform = Column(String, nullable=True)
    # The writing style the capture was cleaned up with (docs/plans/PER_APP_STYLE.md).
    style_id = Column(String, nullable=True)
    # The app's App Store category (LSApplicationCategoryType), which suggests
    # a style for a new app.
    app_category = Column(String, nullable=True)
    # The style this capture's corrections teach, when the user left them
    # behind as its app moved to another style. None follows the app.
    teaches_style_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class WritingStyle(Base):
    """A named writing style that apps are assigned to (docs/plans/PER_APP_STYLE.md).

    Its calibration, habits, examples and rules live in the writing style and
    correction notes files, keyed by ``id``.
    """

    __tablename__ = "writing_styles"

    id = Column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    name = Column(String, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    # The style of every app the user hasn't assigned. Exactly one row.
    is_default = Column(Boolean, nullable=False, default=False)
    punctuation_style = Column(String, nullable=False, default="standard")
    capitalize_first = Column(Boolean, nullable=False, default=True)
    smart_cleanup = Column(Boolean, nullable=False, default=True)
    preserve_technical = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AppStyle(Base):
    """The style the user chose for an app. An app without a row uses the default and is "new"."""

    __tablename__ = "app_styles"

    bundle_id = Column(String, primary_key=True)
    app_name = Column(String, nullable=True)
    style_id = Column(String, ForeignKey("writing_styles.id"), nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CaptureFeedback(Base):
    """Immutable correction paired with the model output observed by the user."""

    __tablename__ = "capture_feedback"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    capture_id = Column(String, ForeignKey("captures.id"), nullable=False, index=True)
    target = Column(String, nullable=False)
    expected_text = Column(Text, nullable=False)
    notes = Column(Text, nullable=False, default="")
    snapshot = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
