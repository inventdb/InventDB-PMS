"""``app.main`` — the application factory: error handling, CORS, SPA hosting.

The error handlers matter more than they look. Every route in this app signals
failure by raising :class:`ApiError`, and the frontend's axios interceptor keys
off both the status and the JSON body — so a handler that let an exception
escape as Flask's HTML error page would break the UI's error states even though
the backend "worked".
"""

from __future__ import annotations

import socket

import pytest
from werkzeug.exceptions import NotFound

from app import __version__
from app.config import Settings
from app.errors import ApiError
from app.main import _frontend_dist, _refuse_occupied_port, create_app


# ===========================================================================
# ApiError
# ===========================================================================


def test_api_error_carries_a_status_and_a_json_body():
    exc = ApiError(404, "Nothing here")
    assert exc.status_code == 404
    assert exc.to_dict() == {"ok": False, "error": "Nothing here"}


def test_api_error_stringifies_its_detail_for_the_exception_message():
    assert str(ApiError(400, {"field": "x"})) == "{'field': 'x'}"


def test_a_structured_detail_survives_into_the_response(api, fake):
    """InventDB returns field-level validation errors as an object; the handler
    must forward the structure rather than flattening it to a string."""
    fake.on("POST", "/db/pms/properties", {"error": {"beds": "must be an integer"}}, status=422)

    resp = api.post("/api/properties", json={"beds": "three"})

    assert resp.status_code == 422
    assert resp.get_json()["error"] == {"beds": "must be an integer"}


# ===========================================================================
# Error handlers
# ===========================================================================


def test_an_unknown_route_returns_json_not_an_html_error_page(client):
    resp = client.get("/api/does-not-exist")

    assert resp.status_code == 404
    assert resp.content_type.startswith("application/json")
    assert resp.get_json()["ok"] is False


def test_a_wrong_method_returns_json_405(client):
    resp = client.post("/api/meta/entities")

    assert resp.status_code == 405
    assert resp.get_json()["ok"] is False


def test_the_generic_entity_route_shadows_method_errors_on_other_api_paths(client, fake):
    """`POST /api/health` is a 404, not a 405.

    The resources blueprint registers `POST /api/<entity_name>`, which matches
    any single-segment path under `/api`. So a wrong-method request to a real
    endpoint is answered by the CRUD router's "Unknown entity" branch instead
    of Flask's method check. Harmless — both are 4xx JSON — but it explains a
    confusing status if anyone goes looking.
    """
    resp = client.post("/api/health")

    assert resp.status_code == 404
    assert "Unknown entity" in resp.get_json()["error"]
    assert fake.calls == []


def test_an_unexpected_exception_becomes_a_json_500(flask_app, api):
    @flask_app.get("/api/boom")
    def _boom():
        raise RuntimeError("kaboom")

    resp = api.get("/api/boom")

    assert resp.status_code == 500
    assert resp.get_json()["ok"] is False
    assert "kaboom" in resp.get_json()["error"]


def test_the_catch_all_handler_echoes_the_exception_text(flask_app, api):
    """Worth being deliberate about: the 500 body includes `str(exc)`, so any
    internal detail in an exception message reaches the client. Fine for a
    demo instance, worth revisiting before an untrusted deployment.
    """
    @flask_app.get("/api/leaky")
    def _leaky():
        raise RuntimeError("connection string: postgres://user:pw@host/db")

    body = api.get("/api/leaky").get_json()

    assert "postgres://user:pw@host/db" in body["error"]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 422, 500])
def test_every_api_error_status_reaches_the_client(flask_app, api, status):
    @flask_app.get("/api/raise")
    def _raise():
        raise ApiError(status, "nope")

    assert api.get("/api/raise").status_code == status


def test_an_http_exception_keeps_its_description(flask_app, api):
    @flask_app.get("/api/gone")
    def _gone():
        raise NotFound("That record was deleted")

    resp = api.get("/api/gone")

    assert resp.status_code == 404
    assert resp.get_json()["error"] == "That record was deleted"


# ===========================================================================
# Health
# ===========================================================================


def test_health_describes_the_deployment_without_calling_inventdb(client, fake):
    body = client.get("/api/health").get_json()

    assert body == {
        "ok": True,
        "version": __version__,
        "inventdb_base_url": "https://inventdb.test",
        "namespace": "pms",
        "frontend_bundled": False,
    }
    assert fake.calls == [], "health must not depend on the upstream being up"


def test_health_is_public(client):
    assert client.get("/api/health").status_code == 200


# ===========================================================================
# CORS
# ===========================================================================


def test_the_configured_origin_is_allowed_on_api_routes(client):
    resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


def test_credentials_are_permitted_so_the_frontend_can_send_its_token(client):
    resp = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers.get("Access-Control-Allow-Credentials") == "true"


def test_an_unlisted_origin_gets_no_allow_header(client):
    resp = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_a_preflight_is_answered(client):
    resp = client.open(
        "/api/properties",
        method="OPTIONS",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert resp.status_code < 400
    assert resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:5173"


# ===========================================================================
# Root route and SPA hosting
# ===========================================================================


def test_without_a_bundled_frontend_the_root_describes_the_api(client):
    body = client.get("/").get_json()

    assert body["name"] == "InventDB PMS API"
    assert body["health"] == "/api/health"
    assert "Frontend not bundled" in body["note"]


def test_a_built_frontend_is_served_from_the_root(tmp_path, monkeypatch, fake):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>PMS</title>", encoding="utf-8")
    (dist / "app.js").write_text("console.log(1)", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(dist))

    app_client = create_app().test_client()

    assert b"<title>PMS</title>" in app_client.get("/").data
    assert b"console.log(1)" in app_client.get("/app.js").data


def test_client_side_routes_fall_back_to_the_index(tmp_path, monkeypatch, fake):
    """A hard refresh on /properties/abc must serve the SPA shell, not a 404 —
    the route only exists in the browser's router."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>PMS</title>", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(dist))

    app_client = create_app().test_client()

    assert b"<title>PMS</title>" in app_client.get("/properties/abc").data
    assert b"<title>PMS</title>" in app_client.get("/reports").data


def test_api_routes_win_over_the_spa_fallback(tmp_path, monkeypatch, fake):
    """The catch-all `/<path:path>` rule must not swallow the API surface."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    monkeypatch.setenv("FRONTEND_DIST", str(dist))

    resp = create_app().test_client().get("/api/health")

    assert resp.get_json()["ok"] is True
    assert resp.get_json()["frontend_bundled"] is True


def test_a_directory_without_an_index_is_not_treated_as_a_build(tmp_path, monkeypatch):
    empty = tmp_path / "dist"
    empty.mkdir()
    monkeypatch.setenv("FRONTEND_DIST", str(empty))

    # Falls through to the default location, which is absent in a checkout that
    # has never been built — so this asserts only that it is not `empty`.
    assert _frontend_dist() != empty


def test_a_nonexistent_configured_dist_is_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path / "nope"))
    assert _frontend_dist() != tmp_path / "nope"


# ===========================================================================
# Port collision
# ===========================================================================


def test_a_free_port_starts_normally():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]

    # Nothing is listening now that the probe socket is closed.
    assert _refuse_occupied_port("127.0.0.1", free) is None


def test_a_port_someone_else_is_serving_is_refused():
    """The bug this exists to prevent.

    ``SO_REUSEADDR`` lets a second server bind a port Windows is already
    serving, so the collision does not raise -- requests just get split between
    two apps. A sibling InventDB app sharing this port is how its frontend ended
    up proxying into this app's entity registry, with every module there
    answering ``404 Unknown entity``.
    """
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        port = taken.getsockname()[1]

        with pytest.raises(SystemExit) as excinfo:
            _refuse_occupied_port("127.0.0.1", port)

    assert str(port) in str(excinfo.value)
    assert "API_PORT" in str(excinfo.value)


def test_a_wildcard_bind_is_probed_on_the_loopback():
    """`0.0.0.0` is not connectable; the check has to ask 127.0.0.1 instead."""
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        port = taken.getsockname()[1]

        with pytest.raises(SystemExit):
            _refuse_occupied_port("0.0.0.0", port)


def test_the_reloader_child_does_not_refuse_the_port_its_parent_opened(monkeypatch):
    """Werkzeug binds in the parent and passes the fd down.

    Without this exemption the guard fires on every `debug=True` start: the
    child probes the port, finds the parent's own listening socket, and exits.
    """
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen(1)
        port = taken.getsockname()[1]

        monkeypatch.setenv("WERKZEUG_RUN_MAIN", "true")
        assert _refuse_occupied_port("127.0.0.1", port) is None

        monkeypatch.delenv("WERKZEUG_RUN_MAIN")
        monkeypatch.setenv("WERKZEUG_SERVER_FD", "7")
        assert _refuse_occupied_port("127.0.0.1", port) is None


def test_this_app_keeps_the_conventional_port():
    """8000 stays here; the sibling app is the one that moved off it."""
    assert Settings().api_port == 8000
