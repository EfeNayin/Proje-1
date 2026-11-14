"""Password work (bcrypt), kept off the event loop.

Hashing or checking a password takes ~0.2 s of CPU. Run on the event loop it stops every
other request in the process for that long, including the answers from Redis the rate
limiter is waiting for (which then times out into a 503 although nothing is wrong with
Redis). `offload` runs such a call in a worker thread instead; bcrypt releases the GIL,
so the loop keeps serving while it runs.

Concurrency is bounded twice:
  * PASSWORD_WORK_WORKERS threads run at once, through a limiter of their own. The
    default anyio limiter (40 threads, shared with every sync endpoint) is not used:
    forty bcrypt runs at once only thrash the CPU, and a burst of logins would take
    the threads other endpoints need.
  * At most PASSWORD_WORK_MAX_QUEUED further calls wait for a worker. The next one is
    refused at once with PasswordWorkBusyError (503, Retry-After) rather than queued.
There is no fallback: when the work cannot be scheduled the request fails, it never
hashes on the loop instead.

Only plain values go in and out (strings, a bool). Database sessions and ORM objects stay
on the event loop and are never handed to a worker thread. The functions that run in the
worker (app.core.security) never log what they are given.
"""

import asyncio
import weakref
from collections.abc import Callable
from typing import Any, TypeVar, TypeVarTuple, Unpack

import anyio
import anyio.to_thread

from app.core.config import settings
from app.core.exceptions import ServiceUnavailableError

_T = TypeVar("_T")
_Args = TypeVarTuple("_Args")

BUSY_RETRY_AFTER_SECONDS = 2


class PasswordWorkBusyError(ServiceUnavailableError):
    """Every worker is busy and the waiting line is full. Nothing was started."""

    default_detail = "The service is busy right now. Try again in a moment."

    def __init__(self) -> None:
        super().__init__(retry_after=BUSY_RETRY_AFTER_SECONDS)


class _Gate:
    """The worker limiter and the number of calls in flight, for one event loop."""

    def __init__(self) -> None:
        self.limiter = anyio.CapacityLimiter(settings.PASSWORD_WORK_WORKERS)
        self.in_flight = 0  # running + waiting; only touched on the loop, never across an await


# One gate per event loop: a limiter belongs to the loop it was first used on, and the
# tests run every test on a loop of its own.
_gates: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _Gate] = weakref.WeakKeyDictionary()


def _gate() -> _Gate:
    loop = asyncio.get_running_loop()
    gate = _gates.get(loop)
    if gate is None:
        gate = _gates[loop] = _Gate()
    return gate


async def offload(function: Callable[[Unpack[_Args]], _T], *args: Unpack[_Args]) -> _T:
    """Run `function(*args)` in a worker thread and wait for its result.

    Raises PasswordWorkBusyError, without starting anything, when the workers and the
    waiting line are full.

    The call runs in a task of its own and the caller waits through `asyncio.shield`. A
    caller that is cancelled stops waiting at once, but a running thread cannot be stopped,
    so its worker slot and its place in the count are given back only when the thread
    really ends (anyio releases the limiter early when a plain task.cancel() lands while it
    waits). A call that was still queued runs anyway: bounded by MAX_QUEUED, and cheaper
    than guessing whether its thread had just started.
    """
    gate = _gate()
    if gate.in_flight >= gate.limiter.total_tokens + settings.PASSWORD_WORK_MAX_QUEUED:
        raise PasswordWorkBusyError
    gate.in_flight += 1
    work = asyncio.ensure_future(_run(gate, function, args))
    work.add_done_callback(_forget_outcome)
    return await asyncio.shield(work)


async def _run(
    gate: _Gate, function: Callable[[Unpack[_Args]], _T], args: tuple[Unpack[_Args]]
) -> _T:
    try:
        return await anyio.to_thread.run_sync(function, *args, limiter=gate.limiter)
    finally:
        gate.in_flight -= 1


def _forget_outcome(work: "asyncio.Future[Any]") -> None:
    """Mark the outcome as seen: a caller that was cancelled never reads it."""
    if not work.cancelled():
        work.exception()
