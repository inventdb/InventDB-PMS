"""InventDB Property Management System — Flask application factory.

The backend is a thin, secure business layer in front of InventDB SOAR:
  * Authentication is delegated to InventDB (it issues the JWT).
  * All data lives in an InventDB namespace; this API adds validation, search,
    dashboard aggregation, SQL-backed reports and a workflows view.

Optionally, if the frontend has been built (``frontend/dist``), the same server
serves the SPA so the whole app can be deployed as a single service.
"""

from __future__ import annotations

import os
import socket
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from . import __version__
from .config import get_settings
from .errors import ApiError
from .routers import (
    analyze,
    auth,
    dashboard,
    files,
    imports,
    meta,
    notifications,
    reports,
    resources,
    settings as settings_routes,
    views,
    workflows,
)


def _frontend_dist() -> Path | None:
    configured = os.environ.get("FRONTEND_DIST")
    candidates = []
    if configured:
        candidates.append(Path(configured))
    # Default: ../frontend/dist relative to the backend package.
    candidates.append(Path(__file__).resolve().parents[2] / "frontend" / "dist")
    for path in candidates:
        if path.is_dir() and (path / "index.html").exists():
            return path
    return None


def create_app() -> Flask:
    settings = get_settings()
    dist = _frontend_dist()

    app = Flask(__name__, static_folder=None)

    # Keep JSON keys in the order InventDB sent them.
    #
    # Flask's JSON provider sorts object keys alphabetically by default. For a
    # thin proxy that is not cosmetic: a result row's key order IS its column
    # order, and the Analyze grid renders `Object.keys(row).slice(0, 8)`. Sorted,
    # a work-order result led with `days_open` and pushed `w.wo` — the work-order
    # number — out of the visible columns entirely, so the same saved analysis
    # showed different columns in the PMS than in SOAR's Analyze room.
    app.json.sort_keys = False

    CORS(
        app,
        resources={r"/api/*": {"origins": settings.cors_origin_list}},
        supports_credentials=True,
    )

    # --- API health ---
    @app.get("/api/health")
    def health():  # pragma: no cover - trivial
        # Read live rather than closing over the startup snapshot: the base URL
        # is editable at runtime, and a stale value here would be the one place
        # the UI still showed the old instance.
        current = get_settings()
        return jsonify(
            {
                "ok": True,
                "version": __version__,
                "inventdb_base_url": current.base_url,
                "namespace": current.inventdb_namespace,
                "frontend_bundled": dist is not None,
            }
        )

    # --- Blueprints (specific prefixes are registered before the generic one) ---
    app.register_blueprint(auth.bp)
    app.register_blueprint(meta.bp)
    app.register_blueprint(dashboard.bp)
    app.register_blueprint(reports.bp)
    app.register_blueprint(workflows.bp)
    app.register_blueprint(settings_routes.bp)
    app.register_blueprint(notifications.bp)
    app.register_blueprint(files.bp)
    app.register_blueprint(analyze.bp)
    app.register_blueprint(imports.bp)
    app.register_blueprint(views.bp)
    # Registered last: its routes are `/api/<entity>`, which would otherwise
    # shadow the specific prefixes above.
    app.register_blueprint(resources.bp)

    # --- Error handling: always return JSON for API-style errors ---
    @app.errorhandler(ApiError)
    def _handle_api_error(exc: ApiError):
        return jsonify(exc.to_dict()), exc.status_code

    @app.errorhandler(HTTPException)
    def _handle_http_error(exc: HTTPException):
        return jsonify({"ok": False, "error": exc.description}), exc.code or 500

    @app.errorhandler(Exception)
    def _handle_unexpected(exc: Exception):  # pragma: no cover - safety net
        return jsonify({"ok": False, "error": f"Internal error: {exc}"}), 500

    # --- Optional SPA hosting ---
    if dist is not None:

        @app.get("/")
        def _index():
            return send_from_directory(dist, "index.html")

        @app.get("/<path:path>")
        def _spa(path: str):
            # Serve real files; fall back to index.html for client-side routes.
            target = dist / path
            if target.is_file():
                return send_from_directory(dist, path)
            return send_from_directory(dist, "index.html")

    else:

        @app.get("/")
        def _root():
            return jsonify(
                {
                    "name": "InventDB PMS API",
                    "version": __version__,
                    "inventdb": settings.base_url,
                    "namespace": settings.inventdb_namespace,
                    "health": "/api/health",
                    "note": "Frontend not bundled; run the Vite dev server or build it.",
                }
            )

    return app


# Module-level app for WSGI servers (gunicorn/waitress: "app.main:app").
app = create_app()


def _refuse_occupied_port(host: str, port: int) -> None:
    """Abort rather than share a port that something else is already serving.

    Both Flask's dev server and waitress set ``SO_REUSEADDR``, and on Windows
    that flag lets a second process bind an address another process is already
    listening on -- no ``EADDRINUSE``, no warning. Connections then land on
    whichever socket the stack picks, so a second app on the same port doesn't
    fail to start, it *intermittently answers for the first one*.

    That is not a theoretical failure. A sibling InventDB app sharing 8000 meant
    its frontend proxied ``/api`` straight into this app's entity registry: every
    module there came back ``404 Unknown entity`` while both servers reported
    themselves healthy. Refusing to start names the collision at the moment it
    happens instead of leaving it to be diagnosed from an empty table three
    layers away.
    """
    # Werkzeug's reloader binds the listening socket in the parent and hands the
    # descriptor to the child, so the child would find "its own" port occupied
    # and refuse to start. Only the process that actually opens the port asks.
    if os.environ.get("WERKZEUG_RUN_MAIN") or os.environ.get("WERKZEUG_SERVER_FD"):
        return

    probe_host = "127.0.0.1" if host in ("", "0.0.0.0", "::") else host
    with socket.socket() as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((probe_host, port)) != 0:
            return

    raise SystemExit(
        f"Port {port} is already serving something on {probe_host}.\n"
        f"Starting here anyway would not fail -- on Windows both processes can\n"
        f"hold the port, and requests would be split between them at random.\n"
        f"Stop the other server, or pick another port:  API_PORT=8001"
    )


def run() -> None:  # pragma: no cover - convenience entrypoint
    settings = get_settings()
    _refuse_occupied_port(settings.api_host, settings.api_port)
    app.run(host=settings.api_host, port=settings.api_port, debug=True)


if __name__ == "__main__":  # pragma: no cover
    run()
