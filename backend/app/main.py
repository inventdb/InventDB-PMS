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
from pathlib import Path

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from . import __version__
from .config import get_settings
from .errors import ApiError
from .routers import auth, dashboard, meta, reports, resources, workflows


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
    CORS(
        app,
        resources={r"/api/*": {"origins": settings.cors_origin_list}},
        supports_credentials=True,
    )

    # --- API health ---
    @app.get("/api/health")
    def health():  # pragma: no cover - trivial
        return jsonify(
            {
                "ok": True,
                "version": __version__,
                "inventdb_base_url": settings.base_url,
                "namespace": settings.inventdb_namespace,
                "frontend_bundled": dist is not None,
            }
        )

    # --- Blueprints (specific prefixes are registered before the generic one) ---
    app.register_blueprint(auth.bp)
    app.register_blueprint(meta.bp)
    app.register_blueprint(dashboard.bp)
    app.register_blueprint(reports.bp)
    app.register_blueprint(workflows.bp)
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


def run() -> None:  # pragma: no cover - convenience entrypoint
    settings = get_settings()
    app.run(host=settings.api_host, port=settings.api_port, debug=True)


if __name__ == "__main__":  # pragma: no cover
    run()
