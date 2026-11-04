"""Password work (bcrypt) runs in a bounded set of worker threads, never on the event loop.

What these tests pin: an in-progress password check does not stop unrelated async work
(the point of the change: Redis answers keep being read), the number of checks running at
once is bounded, a full queue is refused rather than queued or run on the loop, and the
accounting survives cancellation and errors. The security behaviour of sign-in itself
(wrong/unknown/long passwords, limits, dummy verification) is covered by test_auth.py,
test_auth_ratelimit.py, test_account_deletion.py and test_password_recovery.py.

The blocking is simulated with threading events, not with timing, so these do not depend on
how fast the machine is.
"""

import ast
import asyncio
import threading
import time
from collections.abc import Callable
from pathlib import Path

import pytest
from httpx import AsyncClient, Response

from app.core import passwordwork
from app.core.config import settings
from app.core.passwordwork import PasswordWorkBusyError, offload
from app.core.ratelimit import Bucket, RateLimiter
from app.core.security import hash_password, verify_password
from tests.test_auth_ratelimit import OWNER, ClientAt, register_owner, sign_in
from tests.test_ratelimit import count_of

APP = Path(__file__).resolve().parent.parent / "app"
WAIT = 10  # seconds a blocked worker waits for its release before giving up


class Blocker:
    """A stand-in for verify_password that holds its worker thread until released."""

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()
        self.calls = 0
        self.threads: set[int] = set()
        self.released_in_time = True
        self._lock = threading.Lock()

    def __call__(self, plain: str, password_hash: str) -> bool:
        with self._lock:
            self.calls += 1
            self.threads.add(threading.get_ident())
        self.entered.set()
        if not self.release.wait(timeout=WAIT):
            self.released_in_time = False
        return verify_password(plain, password_hash)


async def wait_until(condition: Callable[[], bool], seconds: float = 5) -> None:
    deadline = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < deadline, "condition not reached"
        await asyncio.sleep(0.005)


class TestTheEventLoopKeepsRunning:
    async def test_a_password_check_in_progress_does_not_stop_unrelated_async_work(
        self,
        client: AsyncClient,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        await register_owner(client)
        blocker = Blocker()
        monkeypatch.setattr("app.domains.auth.service.verify_password", blocker)

        login = asyncio.create_task(sign_in(client, OWNER["email"], "wrong-password"))
        await wait_until(blocker.entered.is_set)

        # The check is stuck in its worker. The loop must still turn, and a real Redis round
        # trip (what the limiter waits for under its 0.5 s timeout) must still complete.
        turns = 0
        for _ in range(25):
            await asyncio.sleep(0.004)
            turns += 1
        assert await rate_limiter.connection().ping()
        assert turns == 25
        assert not login.done(), "the sign-in cannot have finished while its check is held"

        blocker.release.set()
        response = await login

        assert response.status_code == 401
        assert blocker.released_in_time, "the loop was blocked: no release arrived in time"
        assert threading.get_ident() not in blocker.threads, "bcrypt ran on the loop's thread"

    async def test_hashing_and_checking_return_what_the_plain_functions_return(self) -> None:
        hashed = await offload(hash_password, "Aa1-correct-horse")

        assert hashed.startswith("$2b$")
        assert await offload(verify_password, "Aa1-correct-horse", hashed) is True
        assert await offload(verify_password, "Aa1-other", hashed) is False

    async def test_the_work_runs_on_a_worker_thread(self) -> None:
        threads: list[int] = []

        def record() -> None:
            threads.append(threading.get_ident())

        await offload(record)

        assert threads and threads[0] != threading.get_ident()


class TestConcurrencyIsBounded:
    async def test_at_most_the_configured_number_of_checks_run_at_once(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "PASSWORD_WORK_WORKERS", 2)
        monkeypatch.setattr(settings, "PASSWORD_WORK_MAX_QUEUED", 50)
        await register_owner(client)
        lock = threading.Lock()
        running = peak = 0

        def counting(plain: str, password_hash: str) -> bool:
            nonlocal running, peak
            with lock:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with lock:
                running -= 1
            return False

        monkeypatch.setattr("app.domains.auth.service.verify_password", counting)

        responses = await asyncio.gather(
            *(sign_in(client_at(f"10.0.{n}.1"), OWNER["email"], "wrong") for n in range(10))
        )

        assert {response.status_code for response in responses} == {401}
        assert peak == 2

    async def test_a_full_queue_is_refused_at_once_and_the_attempt_is_given_back(
        self,
        client: AsyncClient,
        client_at: ClientAt,
        rate_limiter: RateLimiter,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # One worker and one waiting place: the third request has nowhere to go.
        monkeypatch.setattr(settings, "PASSWORD_WORK_WORKERS", 1)
        monkeypatch.setattr(settings, "PASSWORD_WORK_MAX_QUEUED", 1)
        await register_owner(client)
        blocker = Blocker()
        monkeypatch.setattr("app.domains.auth.service.verify_password", blocker)

        tasks = [
            asyncio.create_task(sign_in(client_at(f"10.1.{n}.1"), OWNER["email"], "wrong"))
            for n in range(3)
        ]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED, timeout=WAIT)

        assert len(done) == 1 and len(pending) == 2
        refused: Response = done.pop().result()
        assert refused.status_code == 503
        assert refused.headers["Retry-After"] == str(passwordwork.BUSY_RETRY_AFTER_SECONDS)
        assert refused.json()["detail"] == PasswordWorkBusyError.default_detail
        assert OWNER["password"] not in refused.text

        blocker.release.set()
        rest = await asyncio.gather(*pending)

        assert {response.status_code for response in rest} == {401}
        # Only the two real (wrong) attempts count; the refused one was given back.
        assert blocker.calls == 2, "the refused request must not have reached bcrypt at all"
        assert await count_of(rate_limiter, Bucket("login:account", OWNER["email"], 50, 3600)) == 2

    async def test_a_busy_refusal_never_falls_back_to_hashing_on_the_loop(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "PASSWORD_WORK_WORKERS", 1)
        monkeypatch.setattr(settings, "PASSWORD_WORK_MAX_QUEUED", 0)
        release = threading.Event()
        ran: list[str] = []

        def held() -> None:
            release.wait(timeout=WAIT)

        def other() -> None:
            ran.append("other")

        first = asyncio.create_task(offload(held))
        await asyncio.sleep(0.05)

        with pytest.raises(PasswordWorkBusyError) as refused:
            await offload(other)

        assert refused.value.status_code == 503
        assert refused.value.headers == {"Retry-After": str(passwordwork.BUSY_RETRY_AFTER_SECONDS)}
        assert ran == []
        release.set()
        await first


class TestAccountingIsExact:
    async def test_a_cancelled_caller_keeps_its_worker_slot_until_the_thread_ends(self) -> None:
        entered, release = threading.Event(), threading.Event()

        def held() -> str:
            entered.set()
            release.wait(timeout=WAIT)
            return "done"

        task = asyncio.create_task(offload(held))
        await wait_until(entered.is_set)
        gate = passwordwork._gate()
        assert gate.in_flight == 1 and gate.limiter.borrowed_tokens == 1

        task.cancel()
        await asyncio.sleep(0.05)
        assert task.done()
        # The caller is gone, but a running thread cannot be stopped: its worker slot and its
        # place in the count stay taken until it really ends.
        assert gate.in_flight == 1 and gate.limiter.borrowed_tokens == 1
        release.set()
        await wait_until(lambda: gate.in_flight == 0)

        assert gate.limiter.borrowed_tokens == 0

    async def test_an_error_in_the_work_is_raised_and_leaves_nothing_counted(self) -> None:
        def broken() -> None:
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            await offload(broken)

        gate = passwordwork._gate()
        assert gate.in_flight == 0 and gate.limiter.borrowed_tokens == 0


class TestNoBlockingPasswordCallRemains:
    def test_the_slow_functions_are_never_called_directly_from_application_code(self) -> None:
        """They may only be handed to offload() as values; calling one runs bcrypt on whoever
        called it, which in this app is the event loop."""
        slow = {"hash_password", "verify_password", "dummy_password_hash"}
        offenders: list[str] = []
        for path in APP.rglob("*.py"):
            if path == APP / "core" / "security.py":
                continue  # defines them (dummy_password_hash calls hash_password)
            for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
                if isinstance(node, ast.Call):
                    func = node.func
                    name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
                    if name in slow:
                        offenders.append(f"{path.relative_to(APP)}:{node.lineno} calls {name}()")
        assert offenders == []

    def test_passlib_is_only_imported_by_the_security_module(self) -> None:
        importers: list[str] = []
        for path in APP.rglob("*.py"):
            if path == APP / "core" / "security.py":
                continue
            for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
                names = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else [node.module or ""]
                    if isinstance(node, ast.ImportFrom)
                    else []
                )
                if any(name.split(".")[0] in {"passlib", "bcrypt"} for name in names):
                    importers.append(str(path.relative_to(APP)))
        assert importers == []
