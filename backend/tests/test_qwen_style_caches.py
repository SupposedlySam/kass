"""One KV cache per writing style, so switching apps keeps each style's prompt cached."""

import numpy as np

from backend.backends import qwen_llm_backend
from backend.backends.qwen_llm_backend import MLXQwenLLMBackend


class Layer:
    """A KV cache layer holding one number per token, like mlx_lm's KVCache."""

    def __init__(self):
        self.values = np.zeros((1, 1, 0, 1))

    @property
    def offset(self):
        return self.values.shape[2]

    @property
    def state(self):
        return self.values, self.values

    @state.setter
    def state(self, value):
        self.values = value[0]

    def is_trimmable(self):
        return True

    def trim(self, count):
        self.values = self.values[:, :, : self.offset - count, :]
        return count


class Model:
    def make_cache(self):
        return [Layer()]


def backend():
    llm = MLXQwenLLMBackend("4B")
    llm.model = Model()
    return llm


def call(llm, key, tokens, generated=(99,)):
    """What a generate call does with the cache: continue it, feed the rest, record what it holds."""
    llm._cache_key = key
    cache = llm._reusable_cache(tokens)
    reused = len(llm._cached_tokens)
    held = [*tokens, *generated]
    layer = cache[0]
    layer.values = np.concatenate([layer.values, np.array(held[reused:], dtype=float).reshape(1, 1, -1, 1)], axis=2)
    llm._set_cached_tokens(held)
    return cache, reused


SHARED = list(range(100))
# Two styles with the same settings: their prompts differ only in their examples.
CHAT = [*SHARED, *range(1000, 1050)]
WORK = [*SHARED, *range(2000, 2050)]


def test_the_same_style_continues_its_cache():
    llm = backend()
    first, _ = call(llm, "chat", [*CHAT, 7000])
    again, reused = call(llm, "chat", [*CHAT, 8000])
    assert again is first
    assert reused == len(CHAT)


def test_switching_styles_never_trims_the_other_styles_prompt():
    llm = backend()
    chat, _ = call(llm, "chat", [*CHAT, 7000])
    work, reused = call(llm, "work", [*WORK, 7000])
    assert work is not chat
    # The shared opening is copied, not prefilled again.
    assert reused == len(SHARED)
    assert list(work[0].values.ravel()[: len(SHARED)]) == SHARED
    for _ in range(3):
        back, reused = call(llm, "chat", [*CHAT, 7100])
        assert back is chat
        assert reused == len(CHAT)
        again, reused = call(llm, "work", [*WORK, 7100])
        assert again is work
        assert reused == len(WORK)
    # Copying left Chat's cache exactly as it was.
    assert list(chat[0].values.ravel()) == [*CHAT, 7100, 99]


def test_a_new_example_at_the_end_still_continues_the_cache():
    llm = backend()
    first, _ = call(llm, "chat", [*CHAT, 7000])
    grown, reused = call(llm, "chat", [*CHAT, 5, 6, 7000])
    assert grown is first
    assert reused == len(CHAT)


def test_the_least_recently_used_cache_goes_first(monkeypatch):
    monkeypatch.setattr(qwen_llm_backend, "MAX_PROMPT_CACHES", 2)
    llm = backend()
    call(llm, "a", [1] * 50 + [0])
    call(llm, "b", [2] * 50 + [0])
    call(llm, "a", [1] * 50 + [5])
    call(llm, "c", [3] * 50 + [0])
    assert [entry.key for entry in llm._prompt_caches] == ["a", "c"]


def test_caches_made_with_the_adapter_are_kept_apart():
    llm = backend()
    base, _ = call(llm, "chat", [*CHAT, 7000])
    llm._adapter_path = "/adapter"
    adapted, reused = call(llm, "chat", [*CHAT, 7000])
    assert adapted is not base
    assert reused == 0
