"""Run GPU work only while nobody is using the Mac (docs/plans/SHARED_ADAPTERS.md).

Training holds the GPU: it slows dictation, and macOS stops a GPU job that
keeps the screen waiting ("Impacting Interactivity"). Like Kass's own
training, the shared-adapter scripts wait for two minutes without keyboard
or mouse input before each chunk of work.
"""

import re
import subprocess
import time

IDLE_SECONDS = 120


def idle_seconds() -> float:
    """Seconds since the last keyboard or mouse input."""
    output = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True).stdout
    match = re.search(r'"HIDIdleTime" = (\d+)', output)
    return int(match.group(1)) / 1e9 if match else 0


def wait_for_idle() -> None:
    while (idle := idle_seconds()) < IDLE_SECONDS:
        time.sleep(IDLE_SECONDS - idle + 1)


def interrupted(error: Exception) -> bool:
    """Whether macOS stopped the GPU job to keep the Mac responsive."""
    return "Impacting Interactivity" in str(error)
