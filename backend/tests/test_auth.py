"""``app.routers.auth`` — the identity proxy.

The backend deliberately holds no credentials and mints no tokens: InventDB is
the single identity provider and these routes are a thin pass-through. What is
worth testing is the validation in front of them, and that failures reach the
client with the upstream's own status rather than a generic 500.
"""

from __future__ import annotations

import pytest
import requests


# ===========================================================================
# Login
# ===========================================================================


def test_login_forwards_credentials_and_returns_the_token(api, fake):
    fake.on("POST", "/api/auth/login", {"ok": True, "token": "jwt-xyz", "user": {"id": 1}})

    resp = api.post("/api/auth/login", json={"username": "rohan", "password": "hunter2"})

    assert resp.status_code == 200
    assert resp.get_json()["token"] == "jwt-xyz"
    assert fake.last_call("POST", "/api/auth/login").body == {
        "username": "rohan",
        "password": "hunter2",
    }


def test_login_does_not_require_the_callers_own_token(api, fake):
    """Obvious, but it is the one route that must work unauthenticated."""
    resp = api.post(
        "/api/auth/login", token=None, json={"username": "u", "password": "p"}
    )
    assert resp.status_code == 200


def test_login_trims_surrounding_whitespace_from_the_username(api, fake):
    """Users paste usernames with a trailing space; the password is left alone
    because whitespace there is significant."""
    api.post("/api/auth/login", json={"username": "  rohan  ", "password": " p "})

    body = fake.last_call("POST", "/api/auth/login").body
    assert body["username"] == "rohan"
    assert body["password"] == " p "


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"username": "rohan"},
        {"password": "hunter2"},
        {"username": "", "password": "hunter2"},
        {"username": "rohan", "password": ""},
        {"username": "   ", "password": "hunter2"},
        {"username": None, "password": None},
    ],
)
def test_login_rejects_incomplete_credentials_without_calling_inventdb(api, fake, payload):
    resp = api.post("/api/auth/login", json=payload)

    assert resp.status_code == 400
    assert resp.get_json() == {
        "ok": False,
        "error": "username and password are required",
    }
    assert fake.calls == [], "a malformed login must not become an upstream request"


@pytest.mark.parametrize("body", ["[]", '"str"', "null", "", "not json"])
def test_login_rejects_a_non_object_body(api, fake, body):
    resp = api.post("/api/auth/login", data=body, content_type="application/json")
    assert resp.status_code == 400
    assert fake.calls == []


def test_bad_credentials_come_back_as_401_not_500(api, fake):
    fake.on("POST", "/api/auth/login", {"error": "Invalid username or password"}, status=401)

    resp = api.post("/api/auth/login", json={"username": "u", "password": "wrong"})

    assert resp.status_code == 401
    assert resp.get_json() == {"ok": False, "error": "Invalid username or password"}


def test_an_unreachable_instance_is_a_502(api, fake):
    fake.on("POST", "/api/auth/login", error=requests.ConnectionError("no route to host"))

    resp = api.post("/api/auth/login", json={"username": "u", "password": "p"})

    assert resp.status_code == 502
    assert "inventdb.test" in resp.get_json()["error"]


# ===========================================================================
# Current user
# ===========================================================================


def test_me_requires_a_bearer_token(api, fake):
    assert api.get("/api/auth/me", token=None).status_code == 401
    assert fake.calls == []


def test_me_returns_the_upstream_profile(api, fake):
    fake.on("GET", "/api/auth/me", {"username": "rohan", "role": "manager"})
    assert api.get("/api/auth/me").get_json()["role"] == "manager"


def test_an_expired_token_surfaces_as_401(api, fake):
    """This is what drives the frontend's redirect back to the login screen, so
    the status has to survive the proxy intact."""
    fake.on("GET", "/api/auth/me", {"error": "Token expired"}, status=401)

    resp = api.get("/api/auth/me")

    assert resp.status_code == 401
    assert resp.get_json()["error"] == "Token expired"


# ===========================================================================
# Password routes
# ===========================================================================


@pytest.mark.parametrize("payload", [{}, {"email": ""}, {"email": "   "}])
def test_forgot_password_requires_an_email(api, fake, payload):
    resp = api.post("/api/auth/forgot-password", token=None, json=payload)
    assert resp.status_code == 400
    assert fake.calls == []


def test_forgot_password_is_public_and_trims_the_address(api, fake):
    resp = api.post(
        "/api/auth/forgot-password", token=None, json={"email": "  a@b.c  "}
    )

    assert resp.status_code == 200
    assert fake.last_call("POST", "/api/auth/forgot-password").body == {"email": "a@b.c"}


# ===========================================================================
# Connectivity probe
# ===========================================================================


def test_health_reports_a_reachable_instance(api, fake):
    fake.on("GET", "/api/auth/health", {"status": "up"})

    body = api.get("/api/auth/health", token=None).get_json()

    assert body["ok"] is True
    assert body["inventdb"] == {"status": "up"}
    assert body["base_url"] == "https://inventdb.test"


def test_health_reports_failure_as_a_200_with_ok_false(api, fake):
    """This endpoint exists to *diagnose* an unreachable instance, so it must
    answer rather than propagate the failure. That is why it catches broadly."""
    fake.on("GET", "/api/auth/health", error=requests.ConnectionError("refused"))

    resp = api.get("/api/auth/health", token=None)
    body = resp.get_json()

    assert resp.status_code == 200
    assert body["ok"] is False
    assert "refused" in body["error"]
    assert body["base_url"] == "https://inventdb.test"


def test_health_survives_an_upstream_error_status_too(api, fake):
    fake.on("GET", "/api/auth/health", {"error": "maintenance"}, status=503)

    body = api.get("/api/auth/health", token=None).get_json()

    assert body["ok"] is False
    assert "maintenance" in body["error"]
