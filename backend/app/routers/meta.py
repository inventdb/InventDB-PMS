"""Metadata endpoints: entity registry, namespace discovery, raw SQL passthrough."""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..entities import ENTITIES
from ..errors import ApiError

bp = Blueprint("meta", __name__, url_prefix="/api/meta")


@bp.get("/entities")
def list_entities():
    return jsonify(
        {
            "entities": [
                {
                    "name": e.name,
                    "label": e.label,
                    "label_plural": e.label_plural,
                    "key": e.key,
                    "search_fields": e.search_fields,
                    "order_by": e.order_by,
                }
                for e in ENTITIES
            ]
        }
    )


@bp.get("/types")
def list_types():
    return jsonify(authed_client().list_types())


@bp.get("/relationships")
def relationships():
    return jsonify(authed_client().relationships())


@bp.post("/sql")
def run_sql():
    body = request.get_json(silent=True) or {}
    statement = (body.get("sql") or "").strip().rstrip(";").strip()
    if not statement:
        raise ApiError(400, "sql is required")
    if not statement.lower().startswith(("select", "with")):
        raise ApiError(400, "Only SELECT / WITH queries are allowed here.")
    return jsonify(authed_client().sql(statement))
