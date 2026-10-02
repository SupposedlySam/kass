"""mlx-audio, whole (data, native libraries, submodules), with Kokoro as its only TTS model.

Kass uses mlx-audio's Whisper and, for Read Aloud, Kokoro. The other TTS
models need packages Kass doesn't install (sentencepiece and more), so
collecting them only printed a warning on every build. Kokoro itself needs
just the shared models.base and models.interpolate.
"""

from PyInstaller.utils.hooks import collect_all

_MODELS = "mlx_audio.tts.models."
_KEPT_MODELS = {"kokoro", "base", "interpolate"}


def _wanted(name: str) -> bool:
    if not name.startswith(_MODELS):
        return True
    return name[len(_MODELS) :].split(".")[0] in _KEPT_MODELS


datas, binaries, hiddenimports = collect_all("mlx_audio", filter_submodules=_wanted)
