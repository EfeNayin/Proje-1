"""How DATABASE_URL becomes an asyncpg connection, including verified TLS.

`?ssl=verify-full` is what config.check_deployment_safety demands outside development. Handed
to asyncpg as that bare string it looks for a CA file at ~/.postgresql/root.crt and fails when
there is none (found by running the production image against a TLS PostgreSQL), instead of
using the system's trusted authorities. So the string is replaced here by a real
`ssl.SSLContext` built the standard way: system CAs (or SSL_CERT_FILE), the certificate chain
required, the server's hostname checked against the certificate. Hosted databases such as Neon
present certificates from a public authority, which that default store trusts.

Every place that opens a database connection (the application engine, Alembic, the preflight
check) goes through `engine_arguments`, so they cannot disagree.
"""

import ssl
from typing import Any

from sqlalchemy.engine import URL, make_url


def verified_tls_context() -> ssl.SSLContext:
    context = ssl.create_default_context()  # CERT_REQUIRED and check_hostname=True by default
    return context


def engine_arguments(database_url: str) -> tuple[URL, dict[str, Any]]:
    """The URL without `ssl=verify-full`, and the `connect_args` that replace it."""
    url = make_url(database_url)
    if url.query.get("ssl") != "verify-full":
        return url, {}
    return url.difference_update_query(["ssl"]), {"ssl": verified_tls_context()}
