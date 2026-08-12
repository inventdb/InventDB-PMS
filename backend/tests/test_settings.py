"""``app.routers.settings`` — repointing the app at a different InventDB.

This is the one setting a running instance can change, and it is the address
every login goes to. So what these protect is not the happy path but the ways a
bad change could hurt: an unauthenticated caller redirecting the app, a typo
locking everyone out, or a downgrade to plain http putting passwords on the wire
in the clear.
"""

from __future__ import annotations

import json

import pytest

from app.config import get_settings, normalize_base_url
from app.errors import ApiError
from tests.conftest import BASE_URL

NEW_URL = "https://acme.inventdb.com"


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    """Point the override file at a throwaway path, and restore the cache.

    Without this a test that repoints the app would leak into every test after
    it — `get_settings` is cached process-wide, which is exactly the property
    that makes the setting work at runtime.
    """
    monkeypatch.setattr("app.config._STATE_PATH", tmp_path / "settings.json")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# ===========================================================================
# What counts as a valid base URL
# ===========================================================================


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://acme.inventdb.com", "https://acme.inventdb.com"),
        ("  https://acme.inventdb.com/  ", "https://acme.inventdb.com"),
        ("https://acme.inventdb.com///", "https://acme.inventdb.com"),
        ("http://localhost:4600", "http://localhost:4600"),
        ("http://127.0.0.1:4600", "http://127.0.0.1:4600"),
    ],
)
def test_a_good_url_is_accepted_and_canonicalised(raw, expected):
    assert normalize_base_url(raw) == expected


@pytest.mark.parametrize(
    "raw,because",
    [
        ("", "empty"),
        ("   ", "blank"),
        ("acme.inventdb.com", "no scheme — would resolve unpredictably"),
        ("//acme.inventdb.com", "scheme-relative"),
        ("ftp://acme.inventdb.com", "not http(s)"),
        ("https://", "no host"),
        # Plain http anywhere but loopback would put the user's InventDB
        # password on the network unencrypted.
        ("http://acme.inventdb.com", "plain http off localhost"),
        # Credentials in a URL end up in every log line that records it.
        ("https://user:pass@acme.inventdb.com", "embedded credentials"),
        # Paths are appended by the client; a base carrying one silently
        # produces the wrong endpoints.
        ("https://acme.inventdb.com/api", "has a path"),
        ("https://acme.inventdb.com?x=1", "has a query"),
    ],
)
def test_a_dangerous_or_malformed_url_is_refused(raw, because):
    with pytest.raises(ApiError) as caught:
        normalize_base_url(raw)
    assert caught.value.status_code == 400, because


# ===========================================================================
# Reading
# ===========================================================================


def test_the_current_connection_is_reported(api, fake):
    fake.on("GET", "/api/auth/me", {"username": "rohan"})

    body = api.get("/api/settings/connection").get_json()

    assert body["base_url"] == BASE_URL
    assert body["namespace"] == "pms"
    assert body["overridden"] is False


# ===========================================================================
# Changing it
# ===========================================================================


def test_changing_it_probes_the_new_host_first(api, fake):
    fake.allow_base(NEW_URL)
    fake.on("GET", "/api/auth/me", {"username": "rohan"})
    fake.on("GET", "/api/auth/health", {"enabled": True})

    body = api.put("/api/settings/connection", json={"base_url": NEW_URL}).get_json()

    assert body["base_url"] == NEW_URL
    assert body["changed"] is True
    # The caller's token was minted by the instance we just left.
    assert body["sign_out_required"] is True
    # The probe went to the NEW host, not the old one.
    assert fake.last_call("GET", "/api/auth/health").base == NEW_URL


def test_the_change_survives_a_restart(api, fake, tmp_path):
    fake.allow_base(NEW_URL)
    fake.on("GET", "/api/auth/me", {"username": "rohan"})
    fake.on("GET", "/api/auth/health", {"enabled": True})

    api.put("/api/settings/connection", json={"base_url": NEW_URL})

    # Written to the state file, not just held in memory — otherwise the app
    # would silently revert to the old instance on the next deploy.
    from app.config import _STATE_PATH

    saved = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    assert saved["inventdb_base_url"] == NEW_URL
    get_settings.cache_clear()
    assert get_settings().base_url == NEW_URL


def test_an_unreachable_host_is_not_saved(api, fake):
    fake.allow_base(NEW_URL)
    fake.on("GET", "/api/auth/me", {"username": "rohan"})
    fake.on("GET", "/api/auth/health", {"error": "nope"}, status=502)

    resp = api.put("/api/settings/connection", json={"base_url": NEW_URL})

    # A typo here would leave the app pointing nowhere, with no way back
    # through the UI — so it has to answer before the change is kept.
    assert resp.status_code == 400
    assert "Couldn't reach" in resp.get_json()["error"]
    assert get_settings().base_url == BASE_URL


def test_saving_the_same_url_is_not_a_reconnect(api, fake):
    fake.on("GET", "/api/auth/me", {"username": "rohan"})

    body = api.put("/api/settings/connection", json={"base_url": BASE_URL}).get_json()

    # No probe, no write, and no pointless sign-out.
    assert body["changed"] is False
    assert "sign_out_required" not in body
    assert not fake.calls_to("GET", "/api/auth/health")


@pytest.mark.parametrize(
    "body", [{}, {"base_url": ""}, {"base_url": "not a url"}, {"base_url": None}]
)
def test_a_bad_body_never_reaches_the_probe(api, fake, body):
    fake.on("GET", "/api/auth/me", {"username": "rohan"})

    assert api.put("/api/settings/connection", json=body).status_code == 400
    assert not fake.calls_to("GET", "/api/auth/health")


# ===========================================================================
# Resetting
# ===========================================================================


def test_reset_goes_back_to_the_configured_instance(api, fake):
    fake.allow_base(NEW_URL)
    fake.on("GET", "/api/auth/me", {"username": "rohan"})
    fake.on("GET", "/api/auth/health", {"enabled": True})
    api.put("/api/settings/connection", json={"base_url": NEW_URL})

    body = api.delete("/api/settings/connection").get_json()

    assert body["base_url"] == BASE_URL
    assert body["overridden"] is False
    assert body["sign_out_required"] is True


def test_reset_with_nothing_to_reset_is_a_no_op(api, fake):
    fake.on("GET", "/api/auth/me", {"username": "rohan"})

    body = api.delete("/api/settings/connection").get_json()

    assert body["changed"] is False
    assert "sign_out_required" not in body


# ===========================================================================
# Who may change it
# ===========================================================================


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/settings/connection"),
        ("PUT", "/api/settings/connection"),
        ("DELETE", "/api/settings/connection"),
    ],
)
def test_a_bearer_token_is_required(api, fake, method, path):
    resp = api._open(method, path, token=None, json={"base_url": NEW_URL})

    assert resp.status_code == 401
    assert not fake.calls


def test_a_token_the_instance_rejects_cannot_repoint_the_app(api, fake):
    # Holding *a* bearer header is not being signed in. Without asking InventDB
    # who it belongs to, anyone could redirect the app — and then collect the
    # credentials of everyone who signed in afterwards.
    fake.on("GET", "/api/auth/me", {"error": "Invalid token"}, status=401)

    resp = api.put("/api/settings/connection", json={"base_url": NEW_URL})

    assert resp.status_code == 401
    assert not fake.calls_to("GET", "/api/auth/health")
    assert get_settings().base_url == BASE_URL
