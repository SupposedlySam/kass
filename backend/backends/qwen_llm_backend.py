"""
Qwen3 LLM backend on mlx-lm (Apple Silicon, 4-bit community quants).

Shares the `LLMBackend` protocol and model-load progress plumbing with the
STT engine.
"""

import logging
import threading
import time
from contextvars import ContextVar
from typing import Callable, Optional

from . import LLMBackend, DEFAULT_LLM_MAX_TOKENS, DEFAULT_LLM_TEMPERATURE
from .base import (
    is_model_cached,
    model_load_progress,
)
from ..services.mlx_thread import run_on_mlx_thread, clear_mlx_cache

logger = logging.getLogger(__name__)

# Set around a generate call to receive the text generated so far after each
# token. Called on the MLX worker thread; it must be quick and thread-safe.
generation_listener: ContextVar[Optional[Callable[[str], None]]] = ContextVar("generation_listener", default=None)

# Set around a generate call to end it early: generation stops before the next
# token once the event is set, and returns the text so far. Streaming dictation
# sets it when a cleanup started while speaking is superseded at release, so
# the final cleanup doesn't wait for work it would throw away.
generation_stop: ContextVar[Optional[threading.Event]] = ContextVar("generation_stop", default=None)

# Set around a generate call whose output mostly copies text the caller has:
# a cleanup copies the transcript, and a cleanup of a transcript that grew
# repeats most of the previous cleanup. The value is that previous output, or
# "" for none. Generation then checks proposed continuations taken from it and
# from the prompt several tokens per model call (prompt lookup decoding).
# Proposals only decide how many tokens are checked at once; every token is
# still sampled from the model's own distribution, so the output is unchanged.
generation_hint: ContextVar[Optional[str]] = ContextVar("generation_hint", default=None)

# Set around a generate call to name the prompt it continues, such as a
# writing style's cleanup prompt. Each name keeps its own KV cache, so a
# dictation in one app never trims away another app's cached prompt
# (docs/plans/PER_APP_STYLE.md). Styles' prompts can share most of their
# tokens, so they need names; unnamed calls are told apart by their start.
prompt_cache_key: ContextVar[Optional[str]] = ContextVar("prompt_cache_key", default=None)

# Calls with the same system prompt share hundreds of tokens; calls with
# different ones (dictation cleanup, Command Mode) share only the chat
# template's first few. An unnamed call's cache is named by this many.
SAME_PROMPT_TOKENS = 64
# A cache not in use that holds more than this (from a long selection) isn't
# worth its memory.
KEPT_CACHE_TOKENS = 4096

# Off only to compare against plain decoding.
LOOKUP_DECODING = True
# Longest proposal checked in one model call. A call over a few dozen tokens
# costs about what one generated token does, so a good proposal saves most of
# the work and a wrong one wastes little.
LOOKUP_DRAFT_TOKENS = 24

# Prompts kept cached at once, least recently used out first: up to six
# writing styles' cleanup prompts (styles.MAX_STYLES), Command Mode's, and one
# for calibration previews and rule checks. A 2k-token prompt's cache is ~330
# MB on 4B (docs/plans/PER_APP_STYLE.md; ``kv_bytes_per_token``).
MAX_PROMPT_CACHES = 8
# mlx_lm's KVCache grows in steps of this many tokens.
KV_CACHE_STEP = 256


class _PromptCache:
    """A KV cache, the tokens it holds, its name, and the adapter they were computed with."""

    def __init__(self, cache, key: object, adapter: Optional[str]):
        self.cache = cache
        self.tokens: list[int] = []
        self.key = key
        self.adapter = adapter


def propose_draft(generated: list[int], sources: list[list[int]], limit: int, cursor: dict) -> list[int]:
    """Tokens likely to follow ``generated``: what followed its last few tokens in a source.

    The first source (the previous output) is proposed from its start before
    anything is generated. ``cursor`` remembers where each source last
    matched, so repeated words don't jump the proposal backwards.
    """
    if not generated:
        return list(sources[0][:limit]) if sources and sources[0] else []
    for size in (4, 3, 2, 1):
        if len(generated) < size:
            continue
        tail = generated[-size:]
        for index, source in enumerate(sources):
            last = len(source) - size
            start = cursor.get(index, 0)
            for position in [*range(start, last + 1), *range(0, min(start, last + 1))]:
                if source[position : position + size] == tail and position + size < len(source):
                    cursor[index] = position + size
                    return list(source[position + size : position + size + limit])
    return []


MLX_HF_REPOS = {
    "0.6B": "mlx-community/Qwen3-0.6B-4bit",
    "1.7B": "mlx-community/Qwen3-1.7B-4bit",
    "4B": "mlx-community/Qwen3-4B-4bit",
}


def _reuse_detokenizer(tokenizer) -> None:
    """Build mlx-lm's streaming detokenizer once and reset it for each call.

    mlx-lm builds a new one per generation, mapping all ~151k vocabulary
    entries (~75 ms) before the first token. Generation runs one call at a
    time on the MLX worker, so a single reset instance is safe to share.
    """
    shared = tokenizer._detokenizer_class(tokenizer)

    def reused(_wrapper):
        shared.reset()
        return shared

    tokenizer._detokenizer_class = reused


def _progress_name(model_size: str) -> str:
    return f"qwen3-{model_size.lower()}"


def _build_messages(
    prompt: str,
    system: Optional[str],
    examples: Optional[list[tuple[str, str]]] = None,
) -> list[dict]:
    messages: list[dict] = []
    if system:
        messages.append({"role": "system", "content": system})
    if examples:
        for user_text, assistant_text in examples:
            messages.append({"role": "user", "content": user_text})
            messages.append({"role": "assistant", "content": assistant_text})
    messages.append({"role": "user", "content": prompt})
    return messages


class MLXQwenLLMBackend:
    """Qwen3 LLM backend using mlx-lm (Apple Silicon)."""

    supports_adapters = True

    def __init__(self, model_size: str = "0.6B"):
        self.model = None
        self.tokenizer = None
        self.model_size = model_size
        self._current_model_size: Optional[str] = None
        # The adapter in effect, and the one loaded into the model. They differ
        # while a loaded adapter is switched off (``_set_adapter_enabled``).
        self._adapter_path: Optional[str] = None
        self._loaded_adapter: Optional[str] = None
        # KV caches of recent prompts, most recently used last. Refinement
        # repeats a ~2k-token system prompt and examples on every call;
        # reusing them keeps a warm 4B dictation cleanup well under a second,
        # and one per prompt keeps it that way across writing styles.
        self._prompt_caches: list[_PromptCache] = []
        # The cache the current (or last) call used, and the tokens it holds.
        self._entry: Optional[_PromptCache] = None
        self._cached_tokens: list[int] = []
        self._listener: Optional[Callable[[str], None]] = None
        self._stop: Optional[threading.Event] = None
        self._hint: Optional[str] = None
        self._cache_key: Optional[str] = None

    def is_loaded(self) -> bool:
        return self.model is not None

    def kv_bytes_per_token(self, model_size: str) -> Optional[int]:
        """What one cached token costs for ``model_size``: keys and values in
        every layer, in the model's 2-byte activations. None if not downloaded."""
        import json

        from huggingface_hub import try_to_load_from_cache

        path = try_to_load_from_cache(self._get_model_path(model_size), "config.json")
        if not isinstance(path, str):
            return None
        try:
            with open(path, encoding="utf-8") as file:
                config = json.load(file)
            head_dim = config.get("head_dim") or config["hidden_size"] // config["num_attention_heads"]
            return config["num_hidden_layers"] * config["num_key_value_heads"] * head_dim * 2 * 2
        except (OSError, ValueError, KeyError, TypeError, ZeroDivisionError):
            return None

    def prompt_tokens(self, system: str, examples: list[tuple[str, str]], model_size: str) -> Optional[int]:
        """How many tokens a prompt of ``system`` and ``examples`` takes, when
        ``model_size`` is loaded to count them. Called off the MLX thread; the
        tokenizer doesn't touch the GPU."""
        tokenizer = self.tokenizer
        if tokenizer is None or self._current_model_size != model_size:
            return None
        text = tokenizer.apply_chat_template(
            _build_messages("", system, examples), tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        return len(tokenizer.encode(text, add_special_tokens=False))

    def _get_model_path(self, model_size: str) -> str:
        if model_size not in MLX_HF_REPOS:
            raise ValueError(f"Unknown Qwen3 size: {model_size}")
        return MLX_HF_REPOS[model_size]

    def _is_model_cached(self, model_size: str) -> bool:
        return is_model_cached(
            self._get_model_path(model_size),
            weight_extensions=(".safetensors", ".bin", ".npz"),
        )

    def _ensure_loaded_sync(self, model_size: Optional[str]) -> None:
        """Load the model if the requested size isn't already resident.

        Runs on the MLX worker thread so it stays serialized with generation.
        """
        if model_size is None:
            model_size = self.model_size

        if self.model is not None and self._current_model_size == model_size:
            return

        if self.model is not None and self._current_model_size != model_size:
            self.unload_model()

        self._load_model_sync(model_size)

    async def load_model(self, model_size: Optional[str] = None) -> None:
        await run_on_mlx_thread(self._ensure_loaded_sync, model_size)

    async def unload(self) -> None:
        """Free the model, serialized onto the MLX worker thread."""
        await run_on_mlx_thread(self.unload_model)

    def _load_model_sync(self, model_size: str) -> None:
        from mlx_lm import load as mlx_load

        progress_model_name = _progress_name(model_size)
        is_cached = self._is_model_cached(model_size)
        repo = self._get_model_path(model_size)
        if self._adapter_path:
            import json
            from pathlib import Path

            adapter_config = json.loads((Path(self._adapter_path) / "adapter_config.json").read_text())
            # Adapters trained before the rename from Herga name it herga_base_path.
            repo = adapter_config.get("kass_base_path") or adapter_config["herga_base_path"]

        with model_load_progress(progress_model_name, is_cached):
            logger.info("Loading Qwen3 %s via MLX...", model_size)
            # Loads run with the process's default HF_HUB_OFFLINE state.
            # Forcing offline for cached models flips process-global state
            # and silently switches every concurrent download/load on other
            # threads to offline mode (issue #841).
            loaded = mlx_load(repo, adapter_path=self._adapter_path)

        # mlx_lm.load returns (model, tokenizer) by default and
        # (model, tokenizer, config) when return_config=True.
        self.model = loaded[0]
        self.tokenizer = loaded[1]
        _reuse_detokenizer(self.tokenizer)

        self._current_model_size = model_size
        self.model_size = model_size
        logger.info("Qwen3 %s (MLX) loaded successfully", model_size)

    def unload_model(self) -> None:
        if self.model is None:
            return
        del self.model
        del self.tokenizer
        self.model = None
        self.tokenizer = None
        self._current_model_size = None
        self._loaded_adapter = None
        self._prompt_caches = []
        self._entry = None
        self._cached_tokens = []
        clear_mlx_cache()
        logger.info("Qwen3 (MLX) unloaded")

    async def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = DEFAULT_LLM_MAX_TOKENS,
        temperature: float = DEFAULT_LLM_TEMPERATURE,
        model_size: Optional[str] = None,
        examples: Optional[list[tuple[str, str]]] = None,
        adapter_path: Optional[str] = None,
    ) -> str:
        listener = generation_listener.get()
        stop = generation_stop.get()
        hint = generation_hint.get()
        cache_key = prompt_cache_key.get()

        # Load-if-needed and inference run as one job on the MLX worker so a
        # concurrent unload or different-size load can't land between them.
        def _load_and_generate() -> str:
            self._ensure_ready_sync(model_size, adapter_path)
            self._listener = listener
            self._stop = stop
            self._hint = hint
            self._cache_key = cache_key
            try:
                return self._generate_sync(prompt, system, max_tokens, temperature, examples)
            finally:
                self._listener = None
                self._stop = None
                self._hint = None
                self._cache_key = None

        return await run_on_mlx_thread(_load_and_generate)

    async def prepare(self, model_size: Optional[str] = None, adapter_path: Optional[str] = None) -> None:
        """Load what a later ``generate`` with these arguments needs, without generating.

        A dictation loads its model and personal adapter while the user
        speaks rather than after release.
        """
        await run_on_mlx_thread(self._ensure_ready_sync, model_size, adapter_path)

    def _ensure_ready_sync(self, model_size: Optional[str], adapter_path: Optional[str]) -> None:
        size = model_size or self.model_size
        loaded = self.model is not None and self._current_model_size == size
        if loaded and self._loaded_adapter is not None and adapter_path in (None, self._loaded_adapter):
            # The personal adapter covers some writing styles and not others.
            # Switching it off and on, rather than reloading the model, keeps
            # app switches as fast as staying in one app.
            self._set_adapter_enabled(adapter_path is not None)
            self._adapter_path = adapter_path
            return
        if self._adapter_path != adapter_path or self._loaded_adapter != adapter_path:
            self.unload_model()
            self._adapter_path = adapter_path
        self._ensure_loaded_sync(model_size)
        self._loaded_adapter = adapter_path

    def _set_adapter_enabled(self, enabled: bool) -> None:
        """Scale the loaded LoRA layers to zero, or back.

        A LoRA layer adds ``scale * lora(x)`` to its base layer, so with the
        scale at zero it computes exactly what the base model does.
        """
        for _, module in self.model.named_modules():
            if hasattr(module, "lora_a") and hasattr(module, "scale"):
                if not hasattr(module, "kass_scale"):
                    module.kass_scale = module.scale
                module.scale = module.kass_scale if enabled else 0.0

    def _generate_sync(
        self,
        prompt: str,
        system: Optional[str],
        max_tokens: int,
        temperature: float,
        examples: Optional[list[tuple[str, str]]] = None,
    ) -> str:
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler

        messages = _build_messages(prompt, system, examples)
        chat_prompt = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )

        sampler = make_sampler(temp=temperature, top_p=0.9) if temperature > 0 else None
        started = time.monotonic()
        tokens = self.tokenizer.encode(chat_prompt, add_special_tokens=False)
        cache = self._reusable_cache(tokens)
        reused = len(self._cached_tokens)
        # Only the cache's own tokens are trustworthy; forget them until this
        # generation finishes in case it fails partway through.
        self._set_cached_tokens([])
        if self._hint is not None and LOOKUP_DECODING:
            return self._generate_lookup(tokens, reused, cache, sampler, max_tokens, self._hint, prompt, started)
        generated: list[int] = []
        text = ""
        for response in stream_generate(
            self.model,
            self.tokenizer,
            tokens[reused:],
            max_tokens=max_tokens,
            sampler=sampler,
            prompt_cache=cache,
        ):
            text += response.text
            generated.append(response.token)
            if self._listener is not None:
                try:
                    self._listener(text)
                except Exception:
                    logger.debug("Generation listener failed", exc_info=True)
            if self._stop is not None and self._stop.is_set():
                # Every token yielded so far has been fed to the model, so the
                # cache still holds exactly tokens + generated.
                logger.info("Qwen3 generate: stopped after %d tokens", len(generated))
                break
        self._set_cached_tokens(tokens + generated)
        logger.info(
            "Qwen3 generate: reused %d/%d prompt tokens, %d generated in %.3fs",
            reused,
            len(tokens),
            len(generated),
            time.monotonic() - started,
        )
        return text.strip()

    def _generate_lookup(self, tokens, reused, cache, sampler, max_tokens, hint, prompt, started) -> str:
        """Generate with proposals from ``hint`` and ``prompt``, checked several tokens per model call.

        Each call feeds the last token plus a proposal. The model's own sample
        at every position is compared with the proposal; the matching run and
        the first differing sample are kept, the rest of the call is trimmed
        from the cache. Sampling each position from the model's distribution
        and keeping it only while it equals the proposal gives the same output
        distribution as generating one token at a time.
        """
        import mlx.core as mx
        from mlx_lm.generate import generation_stream, wired_limit
        from mlx_lm.models.cache import trim_prompt_cache

        sampler = sampler or (lambda logprobs: mx.argmax(logprobs, axis=-1))
        sources = [
            self.tokenizer.encode(hint, add_special_tokens=False) if hint else [],
            self.tokenizer.encode(prompt, add_special_tokens=False),
        ]
        eos = set(self.tokenizer.eos_token_ids)
        detokenizer = self.tokenizer.detokenizer
        detokenizer.reset()
        pending = tokens[reused:]
        # What the cache holds, token for token.
        fed = list(tokens[:reused])
        generated: list[int] = []
        cursor: dict = {}
        calls = accepted = 0
        text = ""
        stopped = False
        with wired_limit(self.model, [generation_stream]):
            with mx.stream(generation_stream):
                while len(pending) > 1:
                    step = pending[: min(512, len(pending) - 1)]
                    self.model(mx.array(step)[None], cache=cache)
                    mx.eval([c.state for c in cache])
                    fed += step
                    pending = pending[len(step) :]
            while not stopped and len(generated) < max_tokens:
                draft = propose_draft(
                    generated, sources, min(LOOKUP_DRAFT_TOKENS, max_tokens - len(generated) - 1), cursor
                )
                with mx.stream(generation_stream):
                    logits = self.model(mx.array(pending + draft)[None], cache=cache)[0, -(len(draft) + 1) :, :]
                    logprobs = logits - mx.logsumexp(logits, axis=-1, keepdims=True)
                    samples = sampler(logprobs)
                samples = samples.tolist()
                calls += 1
                kept = 0
                while kept < len(draft) and samples[kept] == draft[kept]:
                    kept += 1
                trim_prompt_cache(cache, len(draft) - kept)
                fed += pending + draft[:kept]
                accepted += kept
                for token in [*draft[:kept], samples[kept]]:
                    if token in eos or len(generated) >= max_tokens:
                        stopped = True
                        break
                    generated.append(token)
                    detokenizer.add_token(token)
                if stopped:
                    break
                pending = [samples[kept]]
                text = detokenizer.text
                if self._listener is not None:
                    try:
                        self._listener(text)
                    except Exception:
                        logger.debug("Generation listener failed", exc_info=True)
                if self._stop is not None and self._stop.is_set():
                    logger.info("Qwen3 generate: stopped after %d tokens", len(generated))
                    break
        detokenizer.finalize()
        text = detokenizer.text
        self._set_cached_tokens(fed)
        logger.info(
            "Qwen3 generate: reused %d/%d prompt tokens, %d generated in %.3fs (%d model calls, %d proposed tokens kept)",
            reused,
            len(tokens),
            len(generated),
            time.monotonic() - started,
            calls,
            accepted,
        )
        return text.strip()

    def _set_cached_tokens(self, tokens: list[int]) -> None:
        self._cached_tokens = tokens
        if self._entry is not None:
            self._entry.tokens = tokens

    def _reusable_cache(self, tokens: list[int]):
        """The KV cache to continue for ``tokens``, trimmed to the prefix they share.

        Each prompt (with the adapter in effect) has its own cache, continued
        call after call as one cache used to be: named by ``prompt_cache_key``,
        or else by its first ``SAME_PROMPT_TOKENS`` tokens, which tell
        dictation cleanup from Command Mode. A prompt seen for the first time
        starts from a copy of the longest prefix another cache shares with
        ``tokens``, so a new style whose prompt opens like an existing one's
        doesn't prefill that part again. Once there are ``MAX_PROMPT_CACHES``,
        the least recently used goes.
        """
        from mlx_lm.models.cache import can_trim_prompt_cache, make_prompt_cache, trim_prompt_cache

        def shared_with(entry: _PromptCache) -> int:
            # Leave at least one prompt token to feed the model.
            limit = min(len(entry.tokens), len(tokens) - 1)
            shared = 0
            while shared < limit and entry.tokens[shared] == tokens[shared]:
                shared += 1
            return shared

        key = self._cache_key if self._cache_key is not None else tuple(tokens[:SAME_PROMPT_TOKENS])
        same_adapter = [entry for entry in self._prompt_caches if entry.adapter == self._adapter_path]
        entry = next((e for e in same_adapter if e.key == key), None)
        if entry is not None and can_trim_prompt_cache(entry.cache):
            shared = shared_with(entry)
            trim_prompt_cache(entry.cache, len(entry.tokens) - shared)
            entry.tokens = entry.tokens[:shared]
            self._prompt_caches.remove(entry)
        else:
            if entry is not None:
                self._prompt_caches.remove(entry)
            entry = _PromptCache(make_prompt_cache(self.model), key, self._adapter_path)
            donor = max(same_adapter, key=shared_with, default=None)
            if donor is not None:
                self._copy_prefix(donor, entry, shared_with(donor))
        kept = [e for e in self._prompt_caches if len(e.tokens) <= KEPT_CACHE_TOKENS]
        self._prompt_caches = [*kept[max(0, len(kept) - MAX_PROMPT_CACHES + 1) :], entry]
        self._entry = entry
        self._cached_tokens = entry.tokens
        return entry.cache

    def _copy_prefix(self, donor: _PromptCache, entry: _PromptCache, shared: int) -> None:
        """Start ``entry`` with ``donor``'s first ``shared`` tokens. MLX arrays are
        values, so the two caches never write into each other."""
        from mlx_lm.models.cache import make_prompt_cache

        if not shared:
            return
        try:
            for source, target in zip(donor.cache, entry.cache, strict=True):
                keys, values = source.state
                target.state = (keys[..., :shared, :], values[..., :shared, :])
        except Exception:
            logger.debug("Could not copy a cached prefix; prefilling it instead", exc_info=True)
            entry.cache = make_prompt_cache(self.model)
            return
        entry.tokens = donor.tokens[:shared]
