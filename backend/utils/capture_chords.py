"""Platform defaults for capture hotkey chords."""

from __future__ import annotations

import sys

MAC_PUSH_TO_TALK = ["MetaRight", "AltGr"]
MAC_TOGGLE_TO_TALK = ["MetaRight", "AltGr", "Space"]
# Command Mode (docs/plans/COMMAND_MODE.md): shares no chord with dictation.
MAC_COMMAND = ["MetaRight", "ShiftRight"]
# Read Aloud (docs/plans/READ_ALOUD.md): shares no chord with dictation or Command Mode.
MAC_SPEAK = ["AltGr", "ShiftRight"]
NON_MAC_PUSH_TO_TALK = ["ControlRight", "ShiftRight"]
NON_MAC_TOGGLE_TO_TALK = ["ControlRight", "ShiftRight", "Space"]


def default_push_to_talk_chord() -> list[str]:
    if sys.platform == "darwin":
        return MAC_PUSH_TO_TALK.copy()
    return NON_MAC_PUSH_TO_TALK.copy()


def default_toggle_to_talk_chord() -> list[str]:
    if sys.platform == "darwin":
        return MAC_TOGGLE_TO_TALK.copy()
    return NON_MAC_TOGGLE_TO_TALK.copy()


def default_command_chord() -> list[str]:
    return MAC_COMMAND.copy()


def default_speak_chord() -> list[str]:
    return MAC_SPEAK.copy()
