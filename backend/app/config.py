"""Application configuration loaded from environment variables / .env file.

Uses only the standard library plus python-dotenv (pure Python) so there are no
compiled dependencies to build.

Most settings are environment-only: they are deployment decisions, and changing
them at runtime would mean an app that no longer matches how it was started.
The InventDB **base URL** is the exception. It is the one setting an operator
genuinely needs to change without a redeploy — pointing the app at their own
instance instead of the bundled default — so it can be overridden at runtime and
is persisted to a small state file beside the app. Everything else stays where
it was declared.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

from .errors import ApiError

# Load a local .env (if present) before reading configuration.
load_dotenv()


def _get(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


# Runtime overrides live outside the package so a redeploy doesn't wipe them and
# a checkout doesn't carry one developer's instance into everyone else's tests.
# The path is configurable so the suite can point it somewhere disposable.
_STATE_PATH = Path(
    _get(
        "PMS_STATE_FILE",
        str(Path(__file__).resolve().parent.parent / "instance" / "settings.json"),
    )
)

#: Settings that may be changed at runtime. Deliberately short — see the module
#: docstring. Everything absent from here is a deployment decision.
_RUNTIME_KEYS = ("inventdb_base_url",)


@dataclass(frozen=True)
class Settings:
    inventdb_base_url: str = _get(
        "INVENTDB_BASE_URL", "https://your-slug.cloud.inventdb.com"
    )
    inventdb_namespace: str = _get("INVENTDB_NAMESPACE", "pms")
    inventdb_app: str = _get("INVENTDB_APP", "pms")
    inventdb_timeout: float = float(_get("INVENTDB_TIMEOUT", "30"))
    # Idle gap allowed between SSE chunks on the Analyze agent stream. Not a
    # total budget: the agent can reason for minutes without emitting anything,
    # so this only catches a genuinely dead connection.
    inventdb_stream_timeout: float = float(_get("INVENTDB_STREAM_TIMEOUT", "600"))
    api_host: str = _get("API_HOST", "0.0.0.0")
    api_port: int = int(_get("API_PORT", "8000"))
    cors_origins: str = _get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )

    @property
    def base_url(self) -> str:
        return self.inventdb_base_url.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return origins or ["*"]


def _read_overrides() -> dict[str, str]:
    """Runtime overrides, or an empty mapping if there are none.

    A missing file is the normal case, not an error — it just means nobody has
    changed anything. A corrupt one is ignored rather than fatal: the app should
    still start on its configured defaults instead of refusing to boot.
    """
    try:
        data = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: str(v) for k, v in data.items() if k in _RUNTIME_KEYS and v}


@lru_cache
def get_settings() -> Settings:
    overrides = _read_overrides()
    return replace(Settings(), **overrides) if overrides else Settings()


def normalize_base_url(raw: str) -> str:
    """Validate an InventDB base URL and return it in canonical form.

    This is the address every outbound request and every login goes to, so the
    checks are about what could be done with a bad one rather than tidiness:

      * an absolute http(s) URL only — a scheme-relative or relative value would
        resolve against whatever the server happens to be, unpredictably;
      * no embedded credentials — ``https://user:pass@host`` would put a secret
        into every log line that records the URL;
      * no path, query or fragment — paths are appended by the client, so a base
        carrying its own would silently produce the wrong endpoints;
      * plain http only for a loopback host. Anywhere else it would send the
        user's password across the network in the clear.
    """
    url = (raw or "").strip().rstrip("/")
    if not url:
        raise ApiError(400, "Enter the base URL of your InventDB instance")

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ApiError(400, "The URL must start with https:// (or http:// for localhost)")
    if not parsed.hostname:
        raise ApiError(400, "That URL has no host — for example https://acme.inventdb.com")
    if parsed.username or parsed.password:
        raise ApiError(400, "Remove the username and password from the URL")
    if parsed.path or parsed.query or parsed.fragment:
        raise ApiError(400, "Use just the host — no path, query or fragment")

    is_loopback = parsed.hostname in ("localhost", "127.0.0.1", "::1")
    if parsed.scheme == "http" and not is_loopback:
        raise ApiError(
            400,
            "Use https:// — over plain http your InventDB password would cross "
            "the network unencrypted",
        )
    return url


def set_inventdb_base_url(raw: str) -> Settings:
    """Point the app at a different InventDB instance, and persist the choice."""
    url = normalize_base_url(raw)
    overrides = {**_read_overrides(), "inventdb_base_url": url}
    _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _STATE_PATH.write_text(json.dumps(overrides, indent=2) + "\n", encoding="utf-8")
    get_settings.cache_clear()
    return get_settings()


def reset_inventdb_base_url() -> Settings:
    """Drop the override and fall back to the configured/default instance."""
    overrides = {k: v for k, v in _read_overrides().items() if k != "inventdb_base_url"}
    if overrides:
        _STATE_PATH.write_text(json.dumps(overrides, indent=2) + "\n", encoding="utf-8")
    else:
        _STATE_PATH.unlink(missing_ok=True)
    get_settings.cache_clear()
    return get_settings()


def configured_base_url() -> str:
    """What the base URL would be with no runtime override — the .env value."""
    return Settings().base_url
