"""Generic CRUD API for every PMS entity (Flask blueprint).

Routes are mounted under ``/api/<entity>`` for each entity in the registry, e.g.
``/api/properties``, ``/api/leases``. Listing uses InventDB SQL (with a resilient
fallback), while create/update/delete use the record endpoints so InventDB stamps
its system fields and preserves history.
"""

from __future__ import annotations

import uuid
from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..entities import Entity, get_entity
from ..errors import ApiError
from ..inventdb import InventDBClient
from ..sqlutil import ident, sql_literal

bp = Blueprint("resources", __name__, url_prefix="/api")

_RESERVED = {"q", "limit", "offset", "order_by", "order_dir"}

_KEY_PREFIX = {
    "owners": "O",
    "properties": "P",
    "tenants": "T",
    "leases": "L",
    "work_orders": "WO",
    "vendors": "V",
    "transactions": "TX",
    "inspections": "I",
    "compliance": "POL",
    "daily_tasks": "DT",
}


def _require_entity(entity_name: str) -> Entity:
    entity = get_entity(entity_name)
    if not entity:
        raise ApiError(404, f"Unknown entity: {entity_name}")
    return entity


def _gen_key(entity: Entity) -> str:
    prefix = _KEY_PREFIX.get(entity.name, entity.name[:3].upper())
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def _table(client: InventDBClient, entity: Entity) -> str:
    return f"{ident(client.namespace, 'namespace')}.{ident(entity.name, 'type')}"


def _matches_q(row: dict[str, Any], q: str, fields: list[str]) -> bool:
    needle = q.lower()
    for f in fields:
        val = row.get(f)
        if val is not None and needle in str(val).lower():
            return True
    return False


def _json_body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object body")
    return data


def _int_arg(name: str, default: int) -> int:
    """A whole-number query parameter, or ``default`` when it is absent.

    A malformed value is the caller's mistake, so it has to be refused as one.
    A bare ``int()`` raises ValueError inside the view instead, which the
    catch-all handler turns into a 500 carrying the Python exception text --
    the wrong status, and it tells the caller about our internals.
    """
    raw = request.args.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        raise ApiError(400, f"'{name}' must be a whole number") from None


def _count(client: InventDBClient, table: str, where: list[str]) -> int:
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    try:
        data = client.sql(f"SELECT COUNT(*) AS c FROM {table}{where_sql}")
    except ApiError:
        return 0
    rows = data.get("rows") or []
    if rows:
        first = rows[0]
        for key in ("c", "COUNT(*)", "count"):
            if key in first:
                try:
                    return int(first[key] or 0)
                except (TypeError, ValueError):
                    return 0
        for v in first.values():
            try:
                return int(v)
            except (TypeError, ValueError):
                continue
    return 0


@bp.get("/<entity_name>")
def list_records(entity_name: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    table = _table(client, entity)

    args = request.args
    q = args.get("q") or None
    limit = max(1, min(_int_arg("limit", 500), 5000))
    offset = max(0, _int_arg("offset", 0))
    order_by = args.get("order_by") or entity.order_by
    order_dir = "DESC" if str(args.get("order_dir", "asc")).lower() == "desc" else "ASC"

    where: list[str] = []
    for key in args.keys():
        if key in _RESERVED:
            continue
        value = args.get(key)
        if value in (None, ""):
            continue
        col = ident(key, "filter column")
        where.append(f"{col} = {sql_literal(value)}")

    order_sql = f" ORDER BY {ident(order_by, 'order_by')} {order_dir}" if order_by else ""

    if not q:
        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        stmt = f"SELECT * FROM {table}{where_sql}{order_sql} LIMIT {limit} OFFSET {offset}"
        rows = client.query_rows(stmt)
        total = _count(client, table, where)
        return jsonify({"items": rows, "total": total, "limit": limit, "offset": offset})

    # Free-text search path (Python-side for dialect independence).
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    rows = client.query_rows(f"SELECT * FROM {table}{where_sql}{order_sql} LIMIT 5000")
    fields = entity.search_fields or (list(rows[0].keys()) if rows else [])
    filtered = [r for r in rows if _matches_q(r, q, fields)]
    page = filtered[offset : offset + limit]
    return jsonify(
        {"items": page, "total": len(filtered), "limit": limit, "offset": offset}
    )


@bp.get("/<entity_name>/<record_id>")
def get_record(entity_name: str, record_id: str):
    _require_entity(entity_name)
    return jsonify(authed_client().get_record(entity_name, record_id))


@bp.post("/<entity_name>")
def create_record(entity_name: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    payload = _json_body()
    data = {k: v for k, v in payload.items() if not k.startswith("_")}
    if not data.get(entity.key):
        data[entity.key] = _gen_key(entity)

    result = client.create_record(entity_name, data)
    new_id = result.get("id") if isinstance(result, dict) else None
    if new_id:
        try:
            return jsonify(client.get_record(entity_name, new_id)), 201
        except ApiError:
            pass
    return jsonify({**data, "_id": new_id, "ok": True}), 201


@bp.put("/<entity_name>/<record_id>")
def update_record(entity_name: str, record_id: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    payload = {k: v for k, v in _json_body().items() if not k.startswith("_")}

    # Merge onto the existing document so fields not present in the edit form
    # (notably the business key and any extra fields) are preserved regardless
    # of whether InventDB's PUT replaces or merges.
    merged: dict[str, Any] = {}
    try:
        existing = client.get_record(entity_name, record_id)
        if isinstance(existing, dict):
            merged = {k: v for k, v in existing.items() if not k.startswith("_")}
    except ApiError:
        pass
    merged.update(payload)
    if not merged.get(entity.key):
        merged[entity.key] = _gen_key(entity)
    merged["_id"] = record_id

    client.update_record(entity_name, merged)
    try:
        return jsonify(client.get_record(entity_name, record_id))
    except ApiError:
        return jsonify({**merged, "ok": True})


@bp.delete("/<entity_name>/<record_id>")
def delete_record(entity_name: str, record_id: str):
    _require_entity(entity_name)
    authed_client().delete_record(entity_name, record_id)
    return jsonify({"ok": True, "id": record_id})
