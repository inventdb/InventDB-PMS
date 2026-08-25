"""Run the real Flask app over HTTP, against a stand-in InventDB.

The frontend E2E suite mocks `/api` in the browser, so the Flask layer is never
exercised by it; the pytest suite exercises Flask but through its test client,
which skips the wire. This script closes that gap: it serves the actual
application on a port, with InventDB replaced by an in-memory stand-in, so
Playwright can drive the API the way a browser does — real routing, real status
codes, real headers, real error envelopes.

The stand-in is deliberately small. It answers what the PMS actually sends —
login, `/sql`, record CRUD, bulk insert, saved views, report templates — and
answers everything else benignly. It is not an InventDB implementation, and no
test here should assert on InventDB's behaviour; the point is the PMS's own
layer in front of it.

    python -m tests.e2e_server [port]
"""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
from typing import Any

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099

# Pinned before app.config is imported: Settings reads the environment once, at
# class-creation time.
os.environ.setdefault("INVENTDB_BASE_URL", "https://inventdb.e2e")
os.environ.setdefault("INVENTDB_NAMESPACE", "pms")
os.environ.setdefault("INVENTDB_APP", "pms")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("PMS_STATE_FILE", os.path.join(os.path.dirname(__file__), "_e2e_state.json"))

BASE = os.environ["INVENTDB_BASE_URL"]
TOKEN = "e2e-token"
PASSWORD = "correct-horse"

# --------------------------------------------------------------------------- data

SEED: dict[str, list[dict[str, Any]]] = {
    "properties": [
        {
            "_id": "p1", "property_id": "P-1001", "street": "44 Cedar Lane",
            "city": "Richmond", "state": "VA", "region": "Central VA",
            "type": "Townhouse", "status": "Occupied", "beds": 3, "baths": 2,
            "market_rent": 2100, "owner_id": "O-1001",
        },
        {
            "_id": "p2", "property_id": "P-1002", "street": "12 Oak Road",
            "city": "Norfolk", "state": "VA", "region": "Coastal VA",
            "type": "Condo", "status": "Vacant", "beds": 2, "baths": 1,
            "market_rent": 1650, "owner_id": "O-1002",
        },
    ],
    "owners": [
        {"_id": "o1", "owner_id": "O-1001", "name": "Harbourline Holdings",
         "type": "LLC", "email": "meera@harbourline.example", "mgmt_fee": 8},
        {"_id": "o2", "owner_id": "O-1002", "name": "Patterson Family Trust",
         "type": "Trust", "email": "eleanor@example.com", "mgmt_fee": 10},
    ],
    "leases": [
        {"_id": "l1", "lease_id": "L-7001", "property_id": "P-1001",
         "tenant_id": "T-9001", "status": "Active", "contract_rent": 2100,
         "lease_end": "2026-06-30"},
    ],
    "work_orders": [
        {"_id": "w1", "wo": "WO-1", "property_id": "P-1001", "category": "plumbing",
         "priority": "High", "status": "Open", "estimated_cost": 400},
    ],
}

_views: list[dict[str, Any]] = []
_templates: dict[str, dict[str, Any]] = {}


def _rows_for(sql: str) -> list[dict[str, Any]]:
    """Answer a SELECT well enough for the layer in front of it to be tested."""
    lowered = sql.lower()
    if "count(*)" in lowered:
        for name, rows in SEED.items():
            if f".{name}" in lowered:
                return [{"c": len(rows)}]
        return [{"c": 0}]
    for name, rows in SEED.items():
        if f".{name}" in lowered:
            return [dict(r) for r in rows]
    return []


class _Response:
    """The slice of `requests.Response` the client actually touches."""

    def __init__(self, status: int, payload: Any) -> None:
        self.status_code = status
        self._payload = payload
        self.headers: dict[str, str] = {"Content-Type": "application/json"}

    @property
    def text(self) -> str:
        return json.dumps(self._payload)

    @property
    def content(self) -> bytes:
        return self.text.encode()

    def json(self) -> Any:
        return self._payload

    def iter_content(self, chunk_size: Any = None):
        yield self.content

    def close(self) -> None:
        return None


def transport(method: str, url: str, **kw: Any) -> _Response:
    """Drop-in for `requests.request` — the whole of InventDB, in memory."""
    path = url[len(BASE):] if url.startswith(BASE) else url
    path = path.split("?", 1)[0]
    body = kw.get("json")
    method = method.upper()

    # ---- auth ------------------------------------------------------------
    if path.endswith("/auth/login") or path == "/login":
        creds = body or {}
        if creds.get("password") != PASSWORD:
            return _Response(401, {"error": "Invalid username or password"})
        return _Response(200, {"token": TOKEN, "user": {"username": creds.get("username"), "role": "manager"}})
    if "/auth/me" in path or path.endswith("/me"):
        return _Response(200, {"username": "e2e.manager", "email": "e2e@example.com", "role": "manager"})

    # ---- sql -------------------------------------------------------------
    if path == "/sql":
        statement = (body or {}).get("sql", "")
        rows = _rows_for(statement)
        return _Response(200, {"rows": rows, "metrics": {"count": len(rows)}})

    # ---- saved views -----------------------------------------------------
    if path == "/api/saved-views":
        if method == "GET":
            return _Response(200, {"views": _views})
        doc = dict(body or {})
        doc["_id"] = doc.get("_id") or f"view-{uuid.uuid4().hex[:6]}"
        _views.append(doc)
        return _Response(200, doc)
    m = re.match(r"^/api/saved-views/([^/]+)$", path)
    if m:
        vid = m.group(1)
        found = next((v for v in _views if v.get("_id") == vid), None)
        if method == "GET":
            return _Response(200, found or {"_id": vid})
        if method == "PUT":
            if found:
                found.update(body or {})
            return _Response(200, found or {"_id": vid})
        if method == "DELETE":
            _views[:] = [v for v in _views if v.get("_id") != vid]
            return _Response(200, {"ok": True})
    if path == "/api/saved-views/generate-layout":
        return _Response(200, {
            "html": "<html><body><div class='vk-grid'><div class='vk-card'>"
                    "<div class='vk-title'>Designed</div></div></div></body></html>",
            "sql": f"SELECT * FROM pms.properties",
        })
    if path == "/api/saved-views/render-layout":
        return _Response(200, {
            "html": "<html><body><div class='vk-grid'><div class='vk-card'>"
                    "<div class='vk-title'>Rendered</div></div></div></body></html>",
            "total": 2,
        })

    # ---- report templates ------------------------------------------------
    if path == "/api/report-templates":
        if method == "GET":
            return _Response(200, {"templates": list(_templates.values())})
        tid = f"tpl-{uuid.uuid4().hex[:6]}"
        _templates[tid] = {"_id": tid, **(body or {})}
        return _Response(200, _templates[tid])
    m = re.match(r"^/api/report-templates/([^/]+)(/render)?$", path)
    if m:
        tid = m.group(1)
        if m.group(2):
            return _Response(200, {"html": "<html><body><b>report</b></body></html>", "meta": {}})
        if method == "GET":
            return _Response(200, _templates.get(tid, {"_id": tid, "html": "<html></html>"}))
        if method == "PUT":
            _templates.setdefault(tid, {"_id": tid}).update(body or {})
            return _Response(200, _templates[tid])
        if method == "DELETE":
            _templates.pop(tid, None)
            return _Response(200, {"ok": True})

    # ---- records ---------------------------------------------------------
    # Bulk first: it shares the record prefix, and its body is a LIST, so
    # letting the record branch see it would try to build a dict from rows.
    if re.match(r"^/api/pms/[a-z_0-9]+/bulk$", path):
        type_name = path.split("/")[3]
        rows = body if isinstance(body, list) else []
        SEED.setdefault(type_name, []).extend(rows)
        return _Response(200, {"ok": True, "inserted": len(rows)})

    m = re.match(r"^/db/pms/([a-z_0-9]+)(?:/([^/]+))?$", path)
    if m:
        type_name, record_id = m.group(1), m.group(2)
        rows = SEED.setdefault(type_name, [])
        if method == "GET" and record_id:
            found = next((r for r in rows if r.get("_id") == record_id), None)
            return _Response(200, found) if found else _Response(404, {"error": "Not found"})
        if method == "POST":
            doc = dict(body or {})
            doc["_id"] = doc.get("_id") or f"rec-{uuid.uuid4().hex[:6]}"
            rows.append(doc)
            return _Response(200, {"id": doc["_id"], **doc})
        if method == "PUT":
            doc = dict(body or {})
            at = next((i for i, r in enumerate(rows) if r.get("_id") == doc.get("_id")), None)
            if at is not None:
                rows[at] = doc
            return _Response(200, doc)
        if method == "DELETE" and record_id:
            rows[:] = [r for r in rows if r.get("_id") != record_id]
            return _Response(200, {"ok": True})
    # ---- everything else -------------------------------------------------
    return _Response(200, {"ok": True})


def main() -> None:
    import app.inventdb as inventdb

    inventdb.requests.request = transport  # type: ignore[assignment]

    from app.main import create_app

    application = create_app()
    try:
        from waitress import serve

        print(f"e2e backend on http://127.0.0.1:{PORT}", flush=True)
        serve(application, host="127.0.0.1", port=PORT, threads=8, _quiet=True)
    except ImportError:  # pragma: no cover - dev fallback
        application.run(host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
