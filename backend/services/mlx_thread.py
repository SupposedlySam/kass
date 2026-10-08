"""Single dedicated worker thread for all MLX GPU work.

MLX's Metal command encoder/stream is thread-local: it binds to whichever
thread first touches the GPU device. ``asyncio.to_thread()`` uses the event
loop's default executor, which hands successive calls to different worker
threads — a model loaded on one thread and generated on another raises
"There is no Stream(gpu, N) in current thread" (issue #699).

Routing every MLX load, generate, transcribe and unload through this one
worker keeps them on a single thread. Jobs run to completion one at a time,
so a load-then-infer pair submitted as one job cannot be interleaved with an
unload or a different-size load from another request.

Jobs queue in two lanes. Speculative work, a head start no result waits on
(prefilling a style's prompt, loading the cleanup model while the user
speaks), runs only when no other job is queued. So a recognition never waits
in line behind it, only behind the one job already running. Each lane runs in
submission order.
"""

import asyncio
import contextlib
import logging
import threading
import time
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from contextvars import ContextVar

from ..utils import memory

logger = logging.getLogger(__name__)

# Set by ``speculative_mlx_work`` for the jobs submitted inside it.
_speculative = ContextVar("mlx_speculative", default=False)


class _MLXWorker:
    """Runs jobs on one thread, queued work before queued speculative work.

    A ``ThreadPoolExecutor`` with one worker owns the thread, so it joins at
    interpreter exit rather than being cut off mid-MLX call. Each submit
    queues the job in its lane and hands the executor one turn; a turn runs
    whichever job is most urgent when it starts, so every job gets one.
    """

    def __init__(self):
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-worker")
        self._now = deque()
        self._later = deque()
        self._lock = threading.Lock()

    def submit(self, func, *args, speculative=False) -> Future:
        future = Future()
        with self._lock:
            (self._later if speculative else self._now).append((future, func, args))
        self._executor.submit(self._turn)
        return future

    def _turn(self):
        with self._lock:
            future, func, args = (self._now or self._later).popleft()
        if not future.set_running_or_notify_cancel():
            return
        try:
            result = func(*args)
        except BaseException as error:
            future.set_exception(error)
        else:
            future.set_result(result)


_mlx_executor = _MLXWorker()
# Jobs run one at a time, so a slow one holds up everything queued behind it.
# Log any job that waited or ran this long, and what it waited behind.
SLOW_JOB_SECONDS = 1.0
_current_job = None


@contextlib.contextmanager
def speculative_mlx_work():
    """Queue the MLX jobs submitted inside behind every other queued job.

    For a head start nothing waits on, which the work that needs it redoes
    if it has not run yet.
    """
    token = _speculative.set(True)
    try:
        yield
    finally:
        _speculative.reset(token)


def _job_name(func) -> str:
    return getattr(func, "__qualname__", repr(func)).replace("<locals>.", "")


def run_on_mlx_thread(func, *args):
    """Run ``func(*args)`` on the single dedicated MLX worker thread."""
    name = _job_name(func)
    queued = time.monotonic()
    behind = _current_job

    def timed():
        global _current_job
        started = time.monotonic()
        _current_job = name
        try:
            return func(*args)
        finally:
            _current_job = None
            waited = started - queued
            ran = time.monotonic() - started
            if waited >= SLOW_JOB_SECONDS or ran >= SLOW_JOB_SECONDS:
                logger.warning(
                    "Slow MLX job %s: waited=%.2fs behind=%s ran=%.2fs %s",
                    name,
                    waited,
                    behind or "nothing",
                    ran,
                    memory.summary(),
                )

    return asyncio.wrap_future(_mlx_executor.submit(timed, speculative=_speculative.get()))


def clear_mlx_cache() -> None:
    """Return MLX's cached unified memory to the OS after a model is freed.

    Must run on the MLX worker thread (call it from an unload that is already
    routed through ``run_on_mlx_thread``). ``clear_cache`` moved out of the
    ``mlx.core.metal`` namespace in newer MLX, so resolve it from either.
    """
    import mlx.core as mx

    clear = getattr(mx, "clear_cache", None) or getattr(getattr(mx, "metal", None), "clear_cache", None)
    if clear is not None:
        clear()


def keep_weights_resident() -> None:
    """Keep every MLX allocation resident for the life of the process.

    MLX wires allocations only while its wired limit leaves room for them.
    ``mlx_lm``'s ``wired_limit`` raises the limit for one generate and puts
    the old one back afterwards, which at the default ``0`` drops every model
    from the residency set between dictations. After hours of idle macOS then
    pages the Whisper and Qwen weights out, and the next dictation spends
    seconds faulting them back in. Raising the limit once, the way
    ``mlx_lm.server`` does, keeps them in; later loads join as they allocate,
    and each generate's ``wired_limit`` now restores this value, not ``0``.
    """
    import mlx.core as mx

    if not mx.metal.is_available():
        return
    mx.set_wired_limit(mx.device_info()["max_recommended_working_set_size"])
