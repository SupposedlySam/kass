"""Dictation cleanup and Command Mode share one model and keep one prompt cache each."""

import mlx_lm.models.cache as mlx_cache

from backend.backends import qwen_llm_backend
from backend.backends.qwen_llm_backend import MLXQwenLLMBackend

CLEANUP = [0, *range(100, 300)]
COMMAND = [0, *range(300, 400)]


class Cache:
    def __init__(self):
        self.trimmed = 0


def backend(monkeypatch):
    monkeypatch.setattr(mlx_cache, "make_prompt_cache", lambda model: Cache())
    monkeypatch.setattr(mlx_cache, "can_trim_prompt_cache", lambda cache: True)
    monkeypatch.setattr(mlx_cache, "trim_prompt_cache", lambda cache, n: setattr(cache, "trimmed", cache.trimmed + n))
    result = MLXQwenLLMBackend("4B")
    result.model = object()
    return result


def call(model, tokens, generated):
    """What a generate call does with the cache: reuse a prefix, then hold prompt + output."""
    cache = model._reusable_cache(tokens)
    reused = len(model._cached_tokens)
    model._set_cached_tokens(tokens + generated)
    return cache, reused


def test_switching_prompts_reuses_each_prompts_own_cache(monkeypatch):
    model = backend(monkeypatch)
    cleanup, _ = call(model, [*CLEANUP, 1, 2], [3])
    command, reused = call(model, [*COMMAND, 4], [5])
    assert command is not cleanup
    assert reused == 0
    # Back to dictation: its system prompt and examples are still cached.
    again, reused = call(model, [*CLEANUP, 6], [7])
    assert again is cleanup
    assert reused == len(CLEANUP)
    # And the command's prompt is still cached for the next command.
    back, reused = call(model, [*COMMAND, 8], [9])
    assert back is command
    assert reused == len(COMMAND)


def test_the_same_prompt_keeps_trimming_one_cache(monkeypatch):
    model = backend(monkeypatch)
    first, _ = call(model, [*CLEANUP, 1, 2], [3])
    second, reused = call(model, [*CLEANUP, 1, 2, 4], [5])
    assert second is first
    assert reused == len(CLEANUP) + 2
    assert len(model._prompt_caches) == 1


def test_a_long_selections_cache_is_not_kept_once_unused(monkeypatch):
    monkeypatch.setattr(qwen_llm_backend, "KEPT_CACHE_TOKENS", 150)
    model = backend(monkeypatch)
    call(model, COMMAND + list(range(1000, 1100)), [1])
    cleanup, _ = call(model, CLEANUP, [2])
    assert [entry.cache for entry in model._prompt_caches] == [cleanup]


def test_unloading_forgets_every_cache(monkeypatch):
    model = backend(monkeypatch)
    call(model, CLEANUP, [1])
    call(model, COMMAND, [2])
    assert len(model._prompt_caches) == 2
    model.tokenizer = object()
    monkeypatch.setattr("backend.backends.qwen_llm_backend.clear_mlx_cache", lambda: None)
    model.unload_model()
    assert model._prompt_caches == []
    assert model._entry is None
