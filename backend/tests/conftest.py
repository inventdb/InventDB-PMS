"""Shared fixtures.

Configuration is pinned *before* ``app.config`` is imported. ``Settings`` is a
dataclass whose field defaults call ``_get(...)`` at class-creation time, so the
environment is read once, at import — setting these later (or clearing
``get_settings``' cache) would have no effect. Assigning rather than
``setdefault``-ing also means a developer's own exported ``INVENTDB_NAMESPACE``
cannot quietly change what the SQL assertions expect.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

BASE_URL = "https://inventdb.test"
NAMESPACE = "pms"
TOKEN = "test-token"

os.environ["INVENTDB_BASE_URL"] = BASE_URL
os.environ["INVENTDB_NAMESPACE"] = NAMESPACE
os.environ["INVENTDB_APP"] = "pms"
os.environ["INVENTDB_TIMEOUT"] = "5"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
# The base URL is overridable at runtime and persisted to a state file. Point
# that file somewhere disposable so a developer who has repointed their own
# checkout doesn't change what these tests are asserting against.
os.environ["PMS_STATE_FILE"] = str(
    Path(tempfile.gettempdir()) / "pms-test-settings-do-not-create.json"
)

import pytest  # noqa: E402
from werkzeug.test import TestResponse  # noqa: E402

from app.main import create_app  # noqa: E402
from tests.fake_inventdb import FakeInventDB  # noqa: E402


class Api:
    """Test client that presents a bearer token unless told otherwise.

    Every route outside ``/api/auth/login`` needs one, so making it the default
    keeps the auth plumbing out of tests that are about something else. Pass
    ``token=None`` to exercise the unauthenticated path.
    """

    def __init__(self, client) -> None:
        self._client = client

    def _open(self, method: str, path: str, *, token: str | None = TOKEN, **kwargs):
        headers = dict(kwargs.pop("headers", None) or {})
        if token is not None:
            headers.setdefault("Authorization", f"Bearer {token}")
        return self._client.open(path, method=method, headers=headers, **kwargs)

    def get(self, path: str, **kwargs) -> TestResponse:
        return self._open("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> TestResponse:
        return self._open("POST", path, **kwargs)

    def put(self, path: str, **kwargs) -> TestResponse:
        return self._open("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs) -> TestResponse:
        return self._open("DELETE", path, **kwargs)


@pytest.fixture
def fake(monkeypatch) -> FakeInventDB:
    """Intercept the app's only outbound call and record what it sends."""
    stub = FakeInventDB(BASE_URL)
    monkeypatch.setattr("app.inventdb.requests.request", stub.transport)
    return stub


@pytest.fixture
def flask_app(monkeypatch):
    """A fresh app with SPA hosting disabled.

    ``_frontend_dist`` probes ``../frontend/dist`` on disk, so whether the app
    serves the SPA — and therefore whether ``GET /`` returns JSON or HTML —
    depends on if somebody has run a frontend build. Pinning it keeps the suite
    independent of that. ``test_app.py`` covers the SPA branch explicitly.

    ``TESTING`` is left off on purpose: the registered error handlers are part
    of what these tests assert, and this keeps them behaving exactly as they do
    in production.
    """
    monkeypatch.setattr("app.main._frontend_dist", lambda: None)
    return create_app()


@pytest.fixture
def client(flask_app):
    return flask_app.test_client()


@pytest.fixture
def api(client) -> Api:
    return Api(client)


@pytest.fixture
def rows():
    """Small row factory: ``rows(3, city="Mumbai")`` -> three numbered records."""

    def _rows(count: int, **fields):
        return [
            {"_id": f"rec-{i}", **{k: v for k, v in fields.items()}} for i in range(count)
        ]

    return _rows
