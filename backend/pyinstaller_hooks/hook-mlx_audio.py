"""mlx-audio, whole (data, native libraries, submodules), without its TTS models.

Kass uses mlx-audio's Whisper only. Its TTS models need packages Kass doesn't
install (sentencepiece and more), so collecting them only printed a warning
on every build.
"""

from PyInstaller.utils.hooks import collect_all

_TTS_MODELS = "mlx_audio.tts.models."


def _wanted(name: str) -> bool:
    return not name.startswith(_TTS_MODELS)


datas, binaries, hiddenimports = collect_all("mlx_audio", filter_submodules=_wanted)
