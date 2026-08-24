"""Request helpers for building an InventDB client from the incoming request."""

from __future__ import annotations

from flask import request

from .errors import ApiError
from .inventdb import InventDBClient


def _bearer_token() -> str:
    authorization = request.headers.get("Authorization", "")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise ApiError(401, "Missing or invalid Authorization header")
    return parts[1].strip()


def require_token() -> str:
    """Assert the caller presented a bearer token, and return it.

    For routes that are gated on being signed in but do no upstream work of
    their own -- building a client just to throw it away would read as an
    oversight rather than a deliberate check.
    """
    return _bearer_token()


def authed_client() -> InventDBClient:
    """InventDB client bound to the caller's bearer token."""
    return InventDBClient(token=_bearer_token())


def anon_client() -> InventDBClient:
    """InventDB client with no token, for public endpoints."""
    return InventDBClient(token=None)
