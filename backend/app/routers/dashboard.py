"""Dashboard & reporting aggregations (Flask blueprint).

Aggregates are computed in Python from record snapshots fetched via ``SELECT *``
so they stay correct regardless of InventDB SQL dialect details and degrade
gracefully when a type has no rows yet.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from flask import Blueprint, jsonify

from ..context import authed_client
from ..inventdb import InventDBClient

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


def _num(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


def _all(client: InventDBClient, type_name: str) -> list[dict[str, Any]]:
    return client.query_rows(f"SELECT * FROM {client.namespace}.{type_name} LIMIT 5000")


@bp.get("/summary")
def summary():
    client = authed_client()
    props = _all(client, "properties")
    tenants = _all(client, "tenants")
    leases = _all(client, "leases")
    maint = _all(client, "work_orders")
    txns = _all(client, "transactions")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    this_month = _month_key(now)

    total_props = len(props)
    occupied = sum(1 for p in props if str(p.get("status", "")).lower() == "occupied")
    vacant = sum(1 for p in props if str(p.get("status", "")).lower() == "vacant")
    denom = total_props or 1
    occupancy_rate = round((occupied / denom) * 100, 1)

    active_leases = [l for l in leases if str(l.get("status", "")).lower() == "active"]
    expiring_soon = 0
    for l in active_leases:
        end = _parse_date(l.get("lease_end"))
        if end and 0 <= (end - now).days <= 90:
            expiring_soon += 1

    maint_open = sum(
        1 for m in maint if str(m.get("status", "")).lower() in ("open", "new")
    )
    maint_progress = sum(
        1 for m in maint if str(m.get("status", "")).lower() == "in progress"
    )

    income_month = expense_month = 0.0
    for t in txns:
        dt = _parse_date(t.get("date"))
        if not dt or _month_key(dt) != this_month:
            continue
        kind = str(t.get("type", "")).lower()
        if kind == "income":
            income_month += _num(t.get("amount"))
        elif kind == "expense":
            expense_month += _num(t.get("amount"))

    expected_rent = sum(_num(l.get("contract_rent")) for l in active_leases)

    return jsonify(
        {
            "properties": {
                "total": total_props,
                "occupied": occupied,
                "vacant": vacant,
                "occupancy_rate": occupancy_rate,
            },
            "tenants": {"total": len(tenants)},
            "leases": {
                "total": len(leases),
                "active": len(active_leases),
                "expiring_soon": expiring_soon,
            },
            "maintenance": {
                "total": len(maint),
                "open": maint_open,
                "in_progress": maint_progress,
            },
            "financials": {
                "income_month": round(income_month, 2),
                "expense_month": round(expense_month, 2),
                "net_month": round(income_month - expense_month, 2),
                "expected_rent": round(expected_rent, 2),
            },
        }
    )


@bp.get("/charts")
def charts():
    client = authed_client()
    props = _all(client, "properties")
    leases = _all(client, "leases")
    maint = _all(client, "work_orders")
    txns = _all(client, "transactions")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    months: list[str] = []
    cy, cm = now.year, now.month
    for _ in range(6):
        months.append(f"{cy:04d}-{cm:02d}")
        cm -= 1
        if cm == 0:
            cm = 12
            cy -= 1
    months.reverse()

    income_by_month: dict[str, float] = defaultdict(float)
    expense_by_month: dict[str, float] = defaultdict(float)
    for t in txns:
        dt = _parse_date(t.get("date"))
        if not dt:
            continue
        mk = _month_key(dt)
        if mk not in months:
            continue
        kind = str(t.get("type", "")).lower()
        if kind == "income":
            income_by_month[mk] += _num(t.get("amount"))
        elif kind == "expense":
            expense_by_month[mk] += _num(t.get("amount"))

    cashflow = [
        {
            "month": mk,
            "income": round(income_by_month.get(mk, 0.0), 2),
            "expense": round(expense_by_month.get(mk, 0.0), 2),
            "net": round(
                income_by_month.get(mk, 0.0) - expense_by_month.get(mk, 0.0), 2
            ),
        }
        for mk in months
    ]

    def _dist(rows: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
        counter = Counter((str(r.get(field)).strip() or "Unknown") for r in rows)
        return [{"name": k, "value": v} for k, v in counter.most_common()]

    expense_cat: dict[str, float] = defaultdict(float)
    for t in txns:
        if str(t.get("type", "")).lower() == "expense":
            cat = str(t.get("account_category") or "Other").strip() or "Other"
            expense_cat[cat] += _num(t.get("amount"))
    expense_breakdown = [
        {"name": k, "value": round(v, 2)}
        for k, v in sorted(expense_cat.items(), key=lambda kv: kv[1], reverse=True)
    ]

    return jsonify(
        {
            "cashflow": cashflow,
            "property_status": _dist(props, "status"),
            "lease_status": _dist(leases, "status"),
            "maintenance_status": _dist(maint, "status"),
            "maintenance_priority": _dist(maint, "priority"),
            "expense_breakdown": expense_breakdown,
        }
    )
