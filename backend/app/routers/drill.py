"""Drill-downs: the records behind a number, and what the caller may do with one.

Two endpoints serve the right-hand drill-down panel.

``POST /api/drill/<entity>`` lists, one page at a time, the records of ONE module
that sit behind a figure — a chart bar, a dashboard KPI, a grouped table row.
The figure came from a query the user already saw, so the panel sends that
query's WHERE clause back (held to the shape of a filter by ``safe_where``) plus
equality filters for the clicked dimension. The statement is always
``SELECT * FROM <namespace>.<entity> [alias] WHERE …``: one type, read-only, and
answered under the caller's own token, so row-level security decides what is
in it exactly as it decided what was in the chart.

``GET /api/drill/<entity>/<record_id>/access`` answers "may this person edit
THIS record?" — see ``record_access`` for how that is worked out.
"""

from __future__ import annotations

import re
from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..entities import get_entity
from ..errors import ApiError
from ..sqlutil import ident, safe_where, sql_literal

bp = Blueprint("drill", __name__, url_prefix="/api/drill")

#: Page size bounds for the panel's grids. The panel shows 10 by default.
MAX_PAGE = 200

#: Record ids are server-minted UUIDs (hyphens allowed); nothing that could
#: change the upstream URL — `?`, `#`, `/`, spaces — gets through.
_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")


def _entity(name: str):
    entity = get_entity(name)
    if not entity:
        raise ApiError(404, f"Unknown entity: {name}")
    return entity


def _int(body: dict[str, Any], name: str, default: int) -> int:
    raw = body.get(name, default)
    if isinstance(raw, bool):
        raise ApiError(400, f"'{name}' must be a whole number")
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise ApiError(400, f"'{name}' must be a whole number") from None


def _count(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    first = rows[0]
    for key in ("c", "COUNT(*)", "count"):
        if key in first:
            try:
                return int(first[key] or 0)
            except (TypeError, ValueError):
                return 0
    for value in first.values():
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return 0


_ADMIN_ROLES = {"admin", "superadmin"}


def _role(me: Any) -> str:
    user = me.get("user") if isinstance(me, dict) else None
    if not isinstance(user, dict):
        user = me if isinstance(me, dict) else {}
    return str(user.get("role") or user.get("globalRole") or "").strip().lower()


@bp.get("/<entity_name>/<record_id>/access")
def record_access(entity_name: str, record_id: str):
    """May the caller see — and change — this one record?

    The panel opens every record read-only and offers Edit only when this says
    ``can_edit``. It is worked out the way InventDB decides a write, as far as
    the caller is allowed to ask:

    1. The record must come back when read under the caller's own token. Row
       rules that hide a record from someone answer 404, so a record they can't
       see is a record they can't edit.
    2. An admin or superadmin may write anything (InventDB's write middleware
       lets them straight through).
    3. Anyone else needs a write grant on the module — the same check that
       middleware makes, asked through ``/api/permissions/check``.

    A row rule that narrows WRITE further than read is only evaluated by
    InventDB inside the write itself, and it does not expose a way to ask about
    one record beforehand. Saving still goes through that rule; a refusal comes
    back as 403 and the panel turns the record read-only with InventDB's reason.
    ``row_rules`` says so, so the client can be honest about it.
    """
    entity = _entity(entity_name)
    if not _ID_RE.fullmatch(record_id or ""):
        raise ApiError(400, f"Invalid record id: {record_id!r}")
    client = authed_client()

    try:
        client.get_record(entity.name, record_id)
    except ApiError as exc:
        if exc.status_code in (403, 404):
            return jsonify(
                {"can_view": False, "can_edit": False, "reason": "This record is not visible to you.", "row_rules": "n/a"}
            )
        raise

    role = _role(client.me())
    if role in _ADMIN_ROLES:
        return jsonify(
            {"can_view": True, "can_edit": True, "reason": f"Your {role} role can change any record.", "row_rules": "bypassed"}
        )
    resource = f"{ident(client.namespace, 'namespace')}.{ident(entity.name, 'type')}"
    allowed = client.permission_check(resource, "write")
    return jsonify(
        {
            "can_view": True,
            "can_edit": allowed,
            "reason": (
                f"You can change {entity.label_plural.lower()}."
                if allowed
                else f"You can view {entity.label_plural.lower()} but not change them."
            ),
            "row_rules": "enforced_on_save" if allowed else "n/a",
        }
    )


@bp.post("/<entity_name>")
def drill_records(entity_name: str):
    entity = _entity(entity_name)
    client = authed_client()
    body = request.get_json(silent=True)
    if body is None:
        body = {}
    if not isinstance(body, dict):
        raise ApiError(400, "Expected a JSON object body")

    alias = body.get("alias") or ""
    if alias:
        alias = ident(alias, "alias")
    table = f"{ident(client.namespace, 'namespace')}.{ident(entity.name, 'type')}"
    source = f"{table} {alias}" if alias else table

    conditions: list[str] = []
    where = safe_where(body.get("where") or "")
    if where:
        conditions.append(f"({where})")

    filters = body.get("filters") or {}
    if not isinstance(filters, dict):
        raise ApiError(400, "filters must be an object of column: value")
    prefix = f"{alias}." if alias else ""
    for column, value in filters.items():
        col = ident(column, "filter column")
        if value is None:
            conditions.append(f"{prefix}{col} IS NULL")
        elif isinstance(value, (dict, list)):
            raise ApiError(400, f"filter {column!r} must be a single value")
        else:
            conditions.append(f"{prefix}{col} = {sql_literal(value)}")

    limit = max(1, min(_int(body, "limit", 10), MAX_PAGE))
    offset = max(0, _int(body, "offset", 0))
    order_by = body.get("order_by") or entity.order_by
    order_dir = "DESC" if str(body.get("order_dir", "asc")).lower() == "desc" else "ASC"
    order_sql = f" ORDER BY {prefix}{ident(order_by, 'order_by')} {order_dir}" if order_by else ""
    where_sql = (" WHERE " + " AND ".join(conditions)) if conditions else ""

    # Unlike the module list, a failing statement is reported, not turned into
    # an empty page: "nothing behind this number" and "couldn't re-run the
    # query behind this number" must not look the same.
    page = client.sql(f"SELECT * FROM {source}{where_sql}{order_sql} LIMIT {limit} OFFSET {offset}")
    counted = client.sql(f"SELECT COUNT(*) AS c FROM {source}{where_sql}")
    return jsonify(
        {
            "items": page.get("rows") or [],
            "total": _count(counted.get("rows") or []),
            "limit": limit,
            "offset": offset,
        }
    )
