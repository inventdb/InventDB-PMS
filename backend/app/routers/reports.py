"""Reporting endpoints.

Two families live here.

``/templates/*`` is the real thing: a thin proxy onto **InventDB's saved report
templates** — the same reports the SOAR app's Report room lists, stored in
``_System.ReportTemplates`` and rendered by InventDB's own report engine. The
PMS neither defines nor computes these; it lists them, collects their
parameters, and asks InventDB to render. Authoring happens in SOAR.

The remaining endpoints are PMS-specific SQL rollups (P&L, rent roll, renewals
…), each computed by a query executed *inside* InventDB rather than aggregated
in Python. They are no longer surfaced by the Reports page — which now shows
the SOAR reports — but are left in place as a working API.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..errors import ApiError
from ..inventdb import InventDBClient, _safe_ident

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

NS = "pms"


def _rows(client: InventDBClient, sql: str) -> list[dict[str, Any]]:
    return client.query_rows(sql)


def _num(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


_ACRONYMS = {"Hoa": "HOA", "Hvac": "HVAC", "Ach": "ACH", "Coi": "COI", "Co": "CO"}


def _title(v: Any) -> str:
    """Title-case a value (InventDB lowercases GROUP BY string values)."""
    s = str(v).strip() if v is not None else ""
    if not s:
        return "Other"
    return " ".join(_ACRONYMS.get(w, w) for w in s.title().split(" "))


def _distribution(rows: list[dict[str, Any]], dim: str, num: bool = False):
    """Map grouped rows -> [{name, value}], reading the dimension by its real
    column name (InventDB ignores AS aliases on grouped columns)."""
    out = []
    for r in rows:
        name = _title(r.get(dim))
        value = _num(r.get("value")) if num else int(r.get("value") or 0)
        out.append({"name": name, "value": value})
    return out


# ===========================================================================
# InventDB SOAR saved reports
# ===========================================================================

_LABEL_FIELDS = ("name", "title", "first_name", "label", "description")


def _pick_bind_field(sample: dict[str, Any] | None) -> str | None:
    """Choose the column a source-backed parameter should bind to.

    Mirrors the SOAR Report room. A template's SQL filters on a *business* key
    (``WHERE owner_id = :owner_id``), so binding InventDB's internal ``_id``
    GUID matches nothing and the report renders empty. Prefer the first
    non-internal ``*_id`` column that actually carries a value; only fall back
    to ``_id`` when the type has no business key at all.
    """
    if not sample:
        return None
    for key, value in sample.items():
        if key in ("_id", "id") or key.startswith("_"):
            continue
        if not key.lower().endswith("_id"):
            continue
        if isinstance(value, (int, float)) or (isinstance(value, str) and value):
            return key
    return None


def _param_options(client: InventDBClient, param: dict[str, Any]) -> list[dict[str, str]]:
    """Resolve the dropdown choices for a parameter that declares a `source`.

    The source names an InventDB type (``pms.owners``). It comes from a stored
    template rather than the request, but it is still interpolated into SQL, so
    each half is validated as an identifier before use.
    """
    source = str(param.get("source") or "").strip()
    if not source:
        return []
    parts = source.split(".")
    if len(parts) != 2:
        return []
    ns, type_name = (_safe_ident(parts[0], "namespace"), _safe_ident(parts[1], "type"))

    rows = client.query_rows(f"SELECT * FROM {ns}.{type_name} LIMIT 200")
    if not rows:
        return []

    bind = str(param.get("bindField") or "") or _pick_bind_field(rows[0]) or "_id"
    options: list[dict[str, str]] = []
    for row in rows:
        value = row.get(bind) if bind in row else row.get("_id")
        if value in (None, ""):
            continue
        label = next(
            (str(row[f]) for f in _LABEL_FIELDS if row.get(f) not in (None, "")),
            str(value),
        )
        options.append({"value": str(value), "label": label})
    return options


@bp.get("/templates")
def list_report_templates():
    """The saved reports defined in InventDB SOAR."""
    client = authed_client()
    data = client.list_report_templates() or {}
    templates = data.get("templates") or []
    out = [
        {
            "id": t.get("_id"),
            "name": t.get("name") or "(untitled report)",
            "description": t.get("description") or "",
            "category": t.get("category") or "",
            "mode": t.get("mode") or "",
            "version": t.get("version"),
            "created_by": t.get("createdBy") or "",
        }
        for t in templates
        if t.get("_id")
    ]
    out.sort(key=lambda t: (t["category"].lower(), t["name"].lower()))
    return jsonify({"templates": out, "count": len(out)})


@bp.get("/templates/<template_id>")
def get_report_template(template_id: str):
    """A single report's definition, with its parameter pickers pre-resolved.

    The `html` body is deliberately dropped — it is the template source, can
    run to tens of kilobytes, and the client only ever displays the *rendered*
    output.
    """
    client = authed_client()
    doc = client.get_report_template(template_id) or {}
    params = doc.get("parameters") or []

    resolved = []
    for p in params:
        if not isinstance(p, dict):
            continue
        resolved.append(
            {
                "name": p.get("name"),
                "label": p.get("label") or p.get("name"),
                "type": p.get("type") or "text",
                "required": bool(p.get("required", True)),
                "default": p.get("default"),
                "options": [],
                "_source": p,
            }
        )

    # Each source-backed picker costs its own SQL round trip, and the report
    # cannot start rendering until they all land — so resolve them
    # concurrently rather than one after another. A report with four pickers
    # went from four sequential round trips to one wall-clock round trip.
    sourced = [e for e in resolved if e["_source"].get("source")]
    if sourced:
        with ThreadPoolExecutor(max_workers=min(8, len(sourced))) as pool:
            futures = {
                pool.submit(_param_options, client, e["_source"]): e for e in sourced
            }
            for future in as_completed(futures):
                entry = futures[future]
                try:
                    entry["options"] = future.result()
                except ApiError:
                    # A bad `source` on one parameter must not take down the
                    # whole report — the field degrades to a free-text input.
                    entry["options"] = []

    for entry in resolved:
        entry.pop("_source", None)

    return jsonify(
        {
            "id": doc.get("_id") or template_id,
            "name": doc.get("name") or "(untitled report)",
            "description": doc.get("description") or "",
            "category": doc.get("category") or "",
            "mode": doc.get("mode") or "",
            "version": doc.get("version"),
            "parameters": resolved,
        }
    )


@bp.post("/templates/<template_id>/render")
def render_report_template(template_id: str):
    """Render a saved report against live data. Returns InventDB's HTML."""
    body = request.get_json(silent=True)
    params = body.get("params") if isinstance(body, dict) else None
    if params is not None and not isinstance(params, dict):
        raise ApiError(400, "params must be an object")

    client = authed_client()
    result = client.render_report_template(template_id, params or {}) or {}
    return jsonify({"html": result.get("html") or "", "meta": result.get("meta") or {}})


# ===========================================================================
# PMS SQL rollups (retained API; not surfaced by the Reports page)
# ===========================================================================


@bp.get("/pnl")
def profit_and_loss():
    """Income vs. expense totals and category breakdowns (all computed in SQL)."""
    client = authed_client()
    by_type = _rows(
        client,
        f"SELECT type, SUM(amount) AS total, COUNT(*) AS n "
        f"FROM {NS}.transactions GROUP BY type",
    )
    income = expense = 0.0
    for r in by_type:
        if str(r.get("type", "")).lower() == "income":
            income = _num(r.get("total"))
        elif str(r.get("type", "")).lower() == "expense":
            expense = _num(r.get("total"))

    income_by_cat = _rows(
        client,
        f"SELECT account_category, SUM(amount) AS value "
        f"FROM {NS}.transactions WHERE lower(type) = 'income' "
        f"GROUP BY account_category ORDER BY value DESC",
    )
    expense_by_cat = _rows(
        client,
        f"SELECT account_category, SUM(amount) AS value "
        f"FROM {NS}.transactions WHERE lower(type) = 'expense' "
        f"GROUP BY account_category ORDER BY value DESC",
    )
    return jsonify(
        {
            "income_total": income,
            "expense_total": expense,
            "net_total": round(income - expense, 2),
            "income_by_category": _distribution(income_by_cat, "account_category", num=True),
            "expense_by_category": _distribution(expense_by_cat, "account_category", num=True),
        }
    )


@bp.get("/cashflow")
def cashflow():
    """Monthly income/expense using SQL YEAR()/MONTH() grouping."""
    client = authed_client()
    rows = _rows(
        client,
        f"SELECT YEAR(date) AS y, MONTH(date) AS m, type, SUM(amount) AS total "
        f"FROM {NS}.transactions GROUP BY y, m, type",
    )
    buckets: dict[str, dict[str, float]] = {}
    for r in rows:
        try:
            y = int(r.get("y"))
            m = int(r.get("m"))
        except (TypeError, ValueError):
            continue
        key = f"{y:04d}-{m:02d}"
        b = buckets.setdefault(key, {"income": 0.0, "expense": 0.0})
        kind = str(r.get("type", "")).lower()
        if kind in ("income", "expense"):
            b[kind] += _num(r.get("total"))

    months = sorted(buckets.keys())[-12:]
    series = [
        {
            "month": mk,
            "income": round(buckets[mk]["income"], 2),
            "expense": round(buckets[mk]["expense"], 2),
            "net": round(buckets[mk]["income"] - buckets[mk]["expense"], 2),
        }
        for mk in months
    ]
    return jsonify({"cashflow": series})


@bp.get("/rent-roll")
def rent_roll():
    """Active leases joined to their property (SQL JOIN)."""
    client = authed_client()
    rows = _rows(
        client,
        "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, "
        "l.property_id AS property_id, p.city AS city, p.state AS state, "
        "l.contract_rent AS contract_rent, l.market_rent AS market_rent, "
        "l.lease_start AS lease_start, l.lease_end AS lease_end, l.status AS status "
        f"FROM {NS}.leases l JOIN {NS}.properties p "
        "ON l.property_id = p.property_id "
        "WHERE lower(l.status) = 'active' "
        "ORDER BY l.contract_rent DESC",
    )
    total = round(sum(_num(r.get("contract_rent")) for r in rows), 2)
    return jsonify({"rows": rows, "count": len(rows), "monthly_total": total})


@bp.get("/renewals")
def renewals():
    """Lease Renewals Due — leases ending within N days (default 90).

    Mirrors the InventDB saved report used by the 'Weekly Lease Renewals Due'
    workflow.
    """
    client = authed_client()
    try:
        days = max(1, min(int(request.args.get("days", 90)), 365))
    except (TypeError, ValueError):
        days = 90
    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=days)
    rows = _rows(
        client,
        "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, "
        "l.property_id AS property_id, p.city AS city, "
        "l.lease_end AS lease_end, l.contract_rent AS contract_rent, "
        "l.market_rent AS market_rent, l.renewal_type AS renewal_type "
        f"FROM {NS}.leases l JOIN {NS}.properties p "
        "ON l.property_id = p.property_id "
        f"WHERE l.lease_end >= '{today.isoformat()}' "
        f"AND l.lease_end <= '{end.isoformat()}' "
        "ORDER BY l.lease_end ASC",
    )
    for r in rows:
        delta = _num(r.get("market_rent")) - _num(r.get("contract_rent"))
        r["rent_gap"] = round(delta, 2)
    return jsonify({"rows": rows, "count": len(rows), "days": days})


@bp.get("/occupancy")
def occupancy():
    """Property status distribution (SQL GROUP BY)."""
    client = authed_client()
    rows = _rows(
        client,
        f"SELECT status, COUNT(*) AS value FROM {NS}.properties "
        "GROUP BY status ORDER BY value DESC",
    )
    total = sum(int(r.get("value") or 0) for r in rows)
    occupied = sum(
        int(r.get("value") or 0)
        for r in rows
        if str(r.get("status", "")).lower() == "occupied"
    )
    return jsonify(
        {
            "distribution": _distribution(rows, "status"),
            "total": total,
            "occupied": occupied,
            "occupancy_rate": round((occupied / total) * 100, 1) if total else 0.0,
        }
    )


@bp.get("/work-orders")
def work_orders_report():
    """Work order pipeline by status & priority, plus open cost estimate (SQL)."""
    client = authed_client()
    by_status = _rows(
        client,
        f"SELECT status, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY status ORDER BY value DESC",
    )
    by_priority = _rows(
        client,
        f"SELECT priority, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY priority ORDER BY value DESC",
    )
    by_category = _rows(
        client,
        f"SELECT category, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY category ORDER BY value DESC",
    )
    open_cost = _rows(
        client,
        f"SELECT SUM(est_cost) AS total FROM {NS}.work_orders "
        "WHERE lower(status) != 'completed'",
    )
    return jsonify(
        {
            "by_status": _distribution(by_status, "status"),
            "by_priority": _distribution(by_priority, "priority"),
            "by_category": _distribution(by_category, "category"),
            "open_cost_estimate": _num(open_cost[0].get("total")) if open_cost else 0.0,
        }
    )
