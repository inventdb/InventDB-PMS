"""Reporting endpoints — computed **directly by InventDB's SQL engine**.

Every figure here is produced by a SQL query executed against InventDB
(``GROUP BY`` / ``SUM`` / ``JOIN`` / date functions), not aggregated in Python.
The backend only shapes the returned rows for the UI. This mirrors the saved
reports that InventDB workflows render (e.g. "Lease Renewals Due").
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..inventdb import InventDBClient

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
