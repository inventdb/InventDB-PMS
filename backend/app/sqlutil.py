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


#: Longest WHERE fragment a drill-down may carry. The agent's filters are a few
#: hundred characters; anything far beyond that is not a filter.
MAX_WHERE_LEN = 4000

_STRING_LITERAL_RE = re.compile(r"'(?:[^']|'')*'")
# `replace` is deliberately absent: REPLACE() is an ordinary string function.
_WRITE_WORD_RE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|merge|"
    r"attach|detach|copy|exec|execute|call|into|set)\b",
    re.IGNORECASE,
)


def safe_where(fragment: str) -> str:
    """Accept a WHERE-clause fragment taken from the query behind a chart.

    A drill-down re-runs the filter of a query the user already saw, so the
    fragment arrives from the client. It is held to the shape of a single
    boolean expression: no statement separator, no comments, no write or DDL
    keyword outside a string literal, balanced quotes and parentheses. What is
    left can only narrow a ``SELECT * FROM <one type>`` — and the caller's own
    token still decides which rows that SELECT may see.
    """
    if not isinstance(fragment, str):
        raise ApiError(400, "where must be text")
    text = fragment.replace("\x00", "").strip()
    if not text:
        return ""
    if len(text) > MAX_WHERE_LEN:
        raise ApiError(400, "where is too long to be a filter")
    if text.count("'") % 2:
        raise ApiError(400, "where has an unterminated string")
    # Judge the structure with the literals blanked out, so a tenant called
    # "O'Drop; Update" can be filtered on without tripping the guard.
    bare = _STRING_LITERAL_RE.sub("''", text)
    if ";" in bare or "--" in bare or "/*" in bare or "*/" in bare:
        raise ApiError(400, "where may hold one condition, not statements or comments")
    if _WRITE_WORD_RE.search(bare):
        raise ApiError(400, "where may only filter rows")
    depth = 0
    for ch in bare:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                break
    if depth != 0:
        raise ApiError(400, "where has unbalanced parentheses")
    return text


def like_literal(value: str) -> str:
    """Render a value for a LIKE pattern, escaping quotes and wildcards."""
    text = str(value).replace("\x00", "")
    text = text.replace("'", "''")
    return "'%" + text + "%'"
