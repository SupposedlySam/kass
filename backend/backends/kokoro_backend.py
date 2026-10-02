"""Kokoro text-to-speech on MLX, for Read Aloud (docs/plans/READ_ALOUD.md).

mlx-audio's Kokoro runs on the MLX worker thread, one sentence per job, so a
dictation started while Kass is reading waits at most one sentence.
"""

import logging

import numpy as np

from ..services.mlx_thread import clear_mlx_cache, run_on_mlx_thread
from .base import is_model_cached, local_model_path, model_load_progress

logger = logging.getLogger(__name__)

KOKORO_REPO = "mlx-community/Kokoro-82M-bf16"
KOKORO_MODEL_NAME = "kokoro-82m"
SAMPLE_RATE = 24_000


class KokoroBackend:
    """Loads Kokoro once and synthesizes speech with it."""

    model_size = "82M"

    def __init__(self):
        self.model = None
        self._current_model_size: str | None = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def is_cached(self) -> bool:
        return is_model_cached(KOKORO_REPO, weight_extensions=(".safetensors",))

    def _ensure_loaded_sync(self, model_size: str | None = None) -> None:
        if self.model is not None:
            return
        from mlx_audio.tts.utils import load_model

        with model_load_progress(KOKORO_MODEL_NAME, self.is_cached()):
            logger.info("Loading Kokoro via MLX...")
            # Its cached folder once downloaded, so loading never reaches the network.
            model = load_model(local_model_path(KOKORO_REPO, (".safetensors",)))
        # Kokoro's pipeline loads each voice from its repo_id, which otherwise
        # defaults to another repo and fetches the voice over the network. Ours
        # ships all of them.
        model.repo_id = KOKORO_REPO
        self.model = model
        self._current_model_size = self.model_size
        logger.info("Kokoro (MLX) loaded")

    async def load_model(self, model_size: str | None = None) -> None:
        await run_on_mlx_thread(self._ensure_loaded_sync, model_size)

    def unload_model(self) -> None:
        if self.model is None:
            return
        del self.model
        self.model = None
        self._current_model_size = None
        clear_mlx_cache()
        logger.info("Kokoro (MLX) unloaded")

    async def unload(self) -> None:
        await run_on_mlx_thread(self.unload_model)

    def _synthesize_sync(self, text: str, voice: str, speed: float) -> np.ndarray:
        self._ensure_loaded_sync()
        # Kokoro's voices are named by language: "a" American, "b" British English.
        chunks = [
            np.asarray(result.audio, dtype=np.float32)
            for result in self.model.generate(text=text, voice=voice, speed=speed, lang_code=voice[0])
        ]
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)

    async def synthesize(self, text: str, voice: str, speed: float) -> np.ndarray:
        """``text`` spoken in ``voice`` at ``speed``, as 24 kHz mono float32 samples."""
        return await run_on_mlx_thread(self._synthesize_sync, text, voice, speed)
