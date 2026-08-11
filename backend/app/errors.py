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
    extra:
        Extra top-level keys to merge into the JSON body. Used to carry
        structured detail a message cannot hold — notably InventDB's workflow
        plan-validation ``issues``, which name the offending step, so the
        editor can point at it instead of showing "plan validation failed".
    """

    def __init__(
        self, status_code: int, detail: Any, extra: dict[str, Any] | None = None
    ) -> None:
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail
        self.extra = extra or {}

    def to_dict(self) -> dict[str, Any]:
        # `ok`/`error` are never overridden by `extra`; a hostile upstream body
        # cannot turn a failure into a success by naming a key "ok".
        return {**self.extra, "ok": False, "error": self.detail}
