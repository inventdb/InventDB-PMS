"""Spreadsheet import (Flask blueprint).

The workbook never reaches the server. SOAR's importer parses it in the browser —
header detection, per-column types, the typed preview — and posts already-typed
records here in batches. So this router is one endpoint doing one thing: relay a
batch to InventDB's bulk endpoint with the namespace pinned server-side.

The type name is whatever the browser derived from the sheet, not one of the ten
PMS modules. That is deliberate and matches SOAR: a workbook written to this
schema keyifies its sheet names straight onto the module types (``Work Orders``
-> ``work_orders``), and one that isn't still imports rather than being refused.
InventDB is schemaless; a type it has not seen is created on first write.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..errors import ApiError

bp = Blueprint("imports", __name__, url_prefix="/api/import")

#: Rows accepted in one request. The browser already batches at 500; this is the
#: ceiling that stops a hand-rolled caller posting a million rows in one go.
_MAX_ROWS = 5_000


@bp.post("/<type_name>")
def import_rows(type_name: str):
    """Write one batch of already-typed records into ``type_name``."""
    client = authed_client()

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Expected a JSON object body")
    rows = body.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ApiError(400, "Send at least one row to import")
    if len(rows) > _MAX_ROWS:
        raise ApiError(400, f"Send at most {_MAX_ROWS:,} rows per request")

    prepared: list[dict[str, Any]] = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ApiError(400, f"Row {i + 1} is not an object")
        # Underscore keys are InventDB's own. A sheet exported from the app
        # carries `_id`; re-importing must not try to reuse it as an identity.
        data = {k: v for k, v in row.items() if not k.startswith("_")}
        if data:
            prepared.append(data)

    if not prepared:
        raise ApiError(400, "Every row was empty")

    # `bulk_insert` validates the type name through `_safe_ident` and pins the
    # namespace to the configured one, so a caller cannot reach another database.
    client.bulk_insert(type_name, prepared)
    return jsonify({"ok": True, "created": len(prepared), "type": type_name})
