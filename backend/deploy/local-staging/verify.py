"""Checks for the local staging rehearsal (see run.sh). Standard library only.

Drives the running production image over HTTP, scripts the Resend stand-in through its
control path, stops and restarts Redis and the database, and finally reads the backend's
log to prove no secret, address or recovery code was written to it. Prints one line per
check; exit status 1 if any failed. It talks only to the stack's own loopback ports and
containers (docker compose -p <project>), never to anything else.
"""

import argparse
import json
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

failures = 0


def check(ok: bool, name: str, detail: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"{'ok  ' if ok else 'FAIL'} {name}" + (f"  [{detail}]" if detail else ""))


class Stack:
    def __init__(self, args: argparse.Namespace) -> None:
        self.api = args.api.rstrip("/")
        self.stub = args.stub.rstrip("/")
        self.project, self.file, self.env_file = args.project, args.compose_file, args.env_file
        self.secrets = dict(
            line.split("=", 1)
            for line in Path(args.env_file).read_text().splitlines()
            if "=" in line
        )
        ca = self.compose("exec", "-T", "backend", "cat", "/certs/ca.crt").stdout
        self.ca_file = Path(tempfile.mkdtemp(prefix="staging-ca-")) / "ca.crt"
        self.ca_file.write_text(ca)
        self.tls = ssl.create_default_context(cafile=str(self.ca_file))

    def compose(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "docker",
                "compose",
                "-p",
                self.project,
                "-f",
                self.file,
                "--env-file",
                self.env_file,
                *args,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        token: str | None = None,
        base: str | None = None,
    ) -> tuple[int, dict[str, str], Any]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            (base or self.api) + path,
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                **({"Authorization": f"Bearer {token}"} if token else {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30, context=self.tls) as response:
                status, raw, headers = response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            status, raw, headers = error.code, error.read(), dict(error.headers)
        parsed: Any
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = raw[:200]
        return status, {k.lower(): v for k, v in headers.items()}, parsed

    def stub_requests(self) -> list[Any]:
        return self.call("GET", "/_requests", base=self.stub)[2]

    def stub_plan(self, plan: list[dict[str, Any]]) -> None:
        self.call("POST", "/_plan", plan, base=self.stub)

    def wait_for(self, predicate: Any, seconds: float = 90) -> bool:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return True
            time.sleep(1)
        return False


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("api", "stub", "env_file", "project", "compose_file"):
        parser.add_argument("--" + name.replace("_", "-"), required=True)
    s = Stack(parser.parse_args())
    run = uuid.uuid4().hex[:8]
    email, other = f"stage.{run}@example.com", f"nobody.{run}@example.com"
    password, new_password = "Staging-pass-1234", "Staging-new-5678"

    # ── the image and the process ──
    probe = s.compose(
        "exec",
        "-T",
        "backend",
        "sh",
        "-c",
        "id -u; tr '\\0' ' ' < /proc/1/cmdline; echo; "
        "for p in /app/tests /app/.env /app/.git; do [ -e $p ] && echo present:$p; done; true",
    ).stdout.splitlines()
    check(probe[:1] == ["10001"], "runs as a non-root user", probe[0] if probe else "")
    check(
        "uvicorn" in probe[1] and "--reload" not in probe[1],
        "uvicorn without --reload",
        probe[1][:90],
    )
    check(
        not any(line.startswith("present:") for line in probe[2:]),
        "no tests, .env or .git in the image",
    )
    check("--port 10000" in probe[1], "listens on the platform's PORT", "10000")

    # ── liveness, readiness, closed documentation ──
    status, _, body = s.call("GET", "/health")
    check(status == 200 and body.get("environment") == "staging", "/health", f"{status} {body}")
    status, headers, body = s.call("GET", "/health/ready")
    check(
        status == 200
        and body == {"status": "ready"}
        and headers.get("cache-control") == "no-store",
        "/health/ready is ready",
        f"{status} {body}",
    )
    for path in ("/docs", "/redoc", "/openapi.json"):
        check(s.call("GET", path)[0] == 404, f"{path} is closed")

    # ── schema: migrated by the container's own startup ──
    head = s.compose("exec", "-T", "backend", "alembic", "current").stdout
    check(
        "(head)" in head,
        "alembic current is at head",
        head.strip().splitlines()[-1] if head else "",
    )
    drift = s.compose("exec", "-T", "backend", "alembic", "check")
    check(
        drift.returncode == 0 and "No new upgrade operations" in drift.stdout + drift.stderr,
        "alembic check: model and database agree",
    )

    # ── auth over TLS database and TLS Redis ──
    status, _, registered = s.call(
        "POST",
        "/api/v1/auth/register",
        {
            "email": email,
            "username": f"stage{run}",
            "password": password,
            "timezone": "Europe/Istanbul",
        },
    )
    check(status == 201, "register", str(status))
    refresh_token = registered["tokens"]["refresh_token"]
    status, _, _ = s.call("POST", "/api/v1/auth/login", {"email": email, "password": password})
    check(status == 200, "login with the right password", str(status))
    status, _, _ = s.call(
        "POST", "/api/v1/auth/login", {"email": email, "password": "wrong-pass-1"}
    )
    check(status == 401, "login with a wrong password", str(status))
    # The burst uses its own account: once an (account, address) bucket is full even the right
    # password is refused until the window ends, which is the point, but would hide later checks.
    burst = f"stage.burst.{run}@example.com"
    s.call(
        "POST",
        "/api/v1/auth/register",
        {
            "email": burst,
            "username": f"burst{run}",
            "password": password,
            "timezone": "Europe/Istanbul",
        },
    )
    statuses = [
        s.call("POST", "/api/v1/auth/login", {"email": burst, "password": "wrong-pass-1"})[0]
        for _ in range(7)
    ]
    check(
        statuses[:5] == [401] * 5 and statuses[5:] == [429, 429],
        "shared limiter (Lua over TLS Redis) admits 5 wrong passwords, then refuses",
        str(statuses),
    )
    status, headers, _ = s.call(
        "POST", "/api/v1/auth/login", {"email": burst, "password": password}
    )
    check(
        status == 429 and headers.get("retry-after", "").isdigit(),
        "429 carries Retry-After, even for the right password",
        f"{status} {headers.get('retry-after')}",
    )

    # ── recovery through the HTTPS mail provider ──
    request_path, confirm_path = (
        "/api/v1/auth/password-recovery/request",
        "/api/v1/auth/password-recovery/confirm",
    )
    before = len(s.stub_requests())
    known = s.call("POST", request_path, {"email": email})
    unknown = s.call("POST", request_path, {"email": other})
    check(
        known[0] == unknown[0] == 202 and known[2] == unknown[2],
        "recovery answers identically",
        f"{known[0]}/{unknown[0]}",
    )
    s.wait_for(lambda: len(s.stub_requests()) > before, 10)
    sent = s.stub_requests()[before:]
    check(len(sent) == 1 and sent[0]["to"] == [email], "exactly one message, to the real account")
    sent_headers_ok = sent and sent[0]["subject"].startswith("Your BodyTrack password reset code")
    check(bool(sent_headers_ok), "message subject")
    match = re.search(r"\b(\d{4}) (\d{4})\b", sent[0]["text"]) if sent else None
    code = (match.group(1) + match.group(2)) if match else ""
    check(bool(code), "the message carries a code")
    status, _, _ = s.call(
        "POST", confirm_path, {"email": email, "code": code, "new_password": new_password}
    )
    check(status == 204, "code resets the password", str(status))
    check(
        s.call("POST", "/api/v1/auth/login", {"email": email, "password": password})[0] == 401,
        "old password no longer works",
    )
    check(
        s.call("POST", "/api/v1/auth/refresh", {"refresh_token": refresh_token})[0] == 401,
        "old refresh token is dead after the reset",
    )

    # ── provider failures never change what the caller sees ──
    fresh = f"stage2.{run}@example.com"
    s.call(
        "POST",
        "/api/v1/auth/register",
        {
            "email": fresh,
            "username": f"stagetwo{run}",
            "password": password,
            "timezone": "Europe/Istanbul",
        },
    )
    s.stub_plan([{"status": 429}])
    before = len(s.stub_requests())
    failing = s.call("POST", request_path, {"email": fresh})
    s.wait_for(lambda: len(s.stub_requests()) > before, 10)
    check(
        failing[0] == 202 and failing[2] == known[2],
        "a throttled provider still gets the generic answer",
    )

    # ── Redis away: fail closed, liveness unaffected, then recovery ──
    s.compose("stop", "redis")
    check(
        s.wait_for(lambda: s.call("GET", "/health/ready")[0] == 503, 30), "not ready without Redis"
    )
    status, _, body = s.call("GET", "/health/ready")
    check(body == {"status": "unavailable"}, "readiness reveals nothing else", str(body))
    check(s.call("GET", "/health")[0] == 200, "liveness stays up without Redis")
    status, headers, _ = s.call(
        "POST", "/api/v1/auth/login", {"email": email, "password": new_password}
    )
    check(
        status == 503 and headers.get("retry-after") == "10",
        "login fails closed (503), never admitted",
        f"{status}",
    )
    s.compose("start", "redis")
    check(
        s.wait_for(lambda: s.call("GET", "/health/ready")[0] == 200, 90),
        "ready again after Redis returns",
    )
    check(
        s.wait_for(
            lambda: s.call(
                "POST", "/api/v1/auth/login", {"email": email, "password": new_password}
            )[0]
            == 200,
            60,
        ),
        "login works again after Redis returns",
    )

    # ── database away ──
    s.compose("stop", "db")
    check(
        s.wait_for(lambda: s.call("GET", "/health/ready")[0] == 503, 30),
        "not ready without the database",
    )
    check(s.call("GET", "/health")[0] == 200, "liveness stays up without the database")
    s.compose("start", "db")
    check(
        s.wait_for(lambda: s.call("GET", "/health/ready")[0] == 200, 90),
        "ready again after the database returns",
    )
    check(
        s.wait_for(
            lambda: s.call(
                "POST", "/api/v1/auth/login", {"email": email, "password": new_password}
            )[0]
            == 200,
            60,
        ),
        "login works again (pool replaced its dead connections)",
    )

    # ── the log ──
    logs = s.compose("logs", "backend", "--no-color").stdout
    check(
        "email delivery failed (resend http 429 rate_limit_exceeded)" in logs,
        "the provider failure is logged as a fixed reason",
    )
    leaked = [
        name
        for name, value in {
            "database password": s.secrets["STAGING_DB_PASSWORD"],
            "redis password": s.secrets["STAGING_REDIS_PASSWORD"],
            "jwt secret": s.secrets["STAGING_JWT_SECRET"],
            "resend key": s.secrets["STAGING_RESEND_KEY"],
            "password": password,
            "new password": new_password,
            "recovery code": code,
            "spaced code": f"{code[:4]} {code[4:]}",
            "email": email,
            "second email": fresh,
            "unknown email": other,
            "burst email": burst,
        }.items()
        if value and value in logs
    ]
    check(not leaked, "no secret, password, code or address in the backend log", ", ".join(leaked))
    check("Traceback" not in logs, "no traceback in the backend log")

    print(f"{failures} check(s) failed" if failures else "all checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
