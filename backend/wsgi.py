"""WSGI entrypoint for production servers.

Examples
--------
Linux (gunicorn):
    gunicorn -w 4 -b 0.0.0.0:8000 wsgi:app

Windows (waitress):
    waitress-serve --listen=0.0.0.0:8000 wsgi:app
"""

from app.main import app  # noqa: F401

if __name__ == "__main__":
    from app.config import get_settings

    settings = get_settings()
    try:
        from waitress import serve

        serve(app, host=settings.api_host, port=settings.api_port)
    except ImportError:  # pragma: no cover - fallback to dev server
        app.run(host=settings.api_host, port=settings.api_port)
