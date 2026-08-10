"""Helpers for safely composing the small amount of SQL this app builds.

All table/column identifiers originate from the internal entity registry or are
validated against a strict identifier pattern; all values are rendered through
``sql_literal`` which quotes and escapes them. User input never reaches SQL
unescaped.
"""

from __future__ import annotations

import re
from typing import Any

from .errors import ApiError

_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def ident(value: str, label: str = "identifier") -> str:
    # `fullmatch`, not `match`: Python's `$` also matches immediately before a
    # trailing newline, so `^ident$` would accept "properties\n".
    if not isinstance(value, str) or not _IDENT_RE.fullmatch(value):
        raise ApiError(400, f"Invalid {label}: {value!r}")
    return value


def sql_literal(value: Any) -> str:
    """Render a Python value as a safe SQL literal."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    text = str(value).replace("\x00", "")
    return "'" + text.replace("'", "''") + "'"


def like_literal(value: str) -> str:
    """Render a value for a LIKE pattern, escaping quotes and wildcards."""
    text = str(value).replace("\x00", "")
    text = text.replace("'", "''")
    return "'%" + text + "%'"
