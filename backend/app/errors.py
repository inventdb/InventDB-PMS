"""Shared error type and JSON error handling for the Flask API."""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """An error that should be returned to the client as JSON.

    Attributes
    ----------
    status_code:
        HTTP status to send.
    detail:
        Human-readable message (or structured payload) describing the error.
    """

    def __init__(self, status_code: int, detail: Any) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail

    def to_dict(self) -> dict[str, Any]:
        return {"ok": False, "error": self.detail}
