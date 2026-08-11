"""Application configuration loaded from environment variables / .env file.

Uses only the standard library plus python-dotenv (pure Python) so there are no
compiled dependencies to build.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

# Load a local .env (if present) before reading configuration.
load_dotenv()


def _get(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    inventdb_base_url: str = _get(
        "INVENTDB_BASE_URL", "https://your-slug.sandbox.inventdb.com"
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
