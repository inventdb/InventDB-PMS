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


_KEYWORDS = ("select", "from", "where", "group by", "having", "order by", "limit", "offset",
             "union", "intersect", "except", "with", "distinct")
#: Each keyword as a whole word, multi-word ones with any whitespace between.
_KEYWORD_RE = {
    kw: re.compile(r"\s+".join(kw.split(" ")) + r"\b", re.IGNORECASE) for kw in _KEYWORDS
}


def _top_level_keywords(sql: str) -> list[tuple[int, str]]:
    """(position, keyword) of each top-level clause keyword in ``sql`` —
    outside string literals, quoted identifiers and parentheses."""
    marks: list[tuple[int, str]] = []
    depth = 0
    quote: str | None = None
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if quote:
            if ch == quote and i + 1 < n and sql[i + 1] == quote:
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and (i == 0 or not (sql[i - 1].isalnum() or sql[i - 1] in "_.")):
            for kw in _KEYWORDS:
                m = _KEYWORD_RE[kw].match(sql, i)
                if m:
                    marks.append((i, kw))
                    i = m.end() - 1
                    break
        i += 1
    return marks


def count_statement(sql: str) -> str | None:
    """``SELECT COUNT(*) AS c`` over the same rows as a plain ``SELECT``.

    Keeps the FROM (joins included) and WHERE; drops the select list, ORDER BY,
    LIMIT and OFFSET. Returns None when a row count would not be the result's
    count — a GROUP BY, a DISTINCT, a set operation or a CTE — so the caller
    can say "unknown" instead of a wrong number.
    """
    if not isinstance(sql, str):
        return None
    text = sql.strip().rstrip(";").strip()
    marks = _top_level_keywords(text)
    if not marks or marks[0] != (0, "select"):
        return None
    kinds = [k for _, k in marks]
    if any(k in kinds for k in ("group by", "having", "union", "intersect", "except", "with")):
        return None
    # DISTINCT straight after SELECT changes the count.
    if len(marks) > 1 and marks[1][1] == "distinct" and not text[6:marks[1][0]].strip():
        return None
    froms = [p for p, k in marks if k == "from"]
    if not froms:
        return None
    end = next((p for p, k in marks if k in ("order by", "limit", "offset") and p > froms[0]), len(text))
    return f"SELECT COUNT(*) AS c {text[froms[0]:end].strip()}"

