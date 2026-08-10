"""The single description of what ``/api/*` returns.

Two suites consume this. The backend replays recorded InventDB responses
through the real app and checks the output conforms. The frontend's Playwright
suite asks its *mock* for the same endpoints and checks the same shapes. A
change on either side that the other has not followed shows up as a failure
instead of as a test that passes against a fiction.

The shapes mirror ``frontend/src/types.ts``, which is what the React code
actually destructures.

Shape language
--------------
``"string"``      a str
``"number"``      an int or float (not bool)
``"int"``         an int (not bool)
``"bool"``        a bool
``"object"``      any JSON object
``"array"``       any JSON array
``"any"``         anything, including null
``"a|b"``         a union; ``"null"`` is a valid member
``{"k": shape}``  an object; a trailing ``?`` on a key makes it optional
``[shape]``       an array whose every element matches ``shape``

Objects are checked for *required keys present and well-typed*, not for the
absence of extras — an API that adds a field must not break its clients.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------- primitives

NAME_VALUE = {"name": "string", "value": "number"}
RECORD = "object"  # schemaless: InventDB documents carry arbitrary columns


def _list_of(item: Any) -> dict[str, Any]:
    """The paginated envelope every entity list endpoint returns."""
    return {"items": [item], "total": "int", "limit": "int", "offset": "int"}


# ------------------------------------------------------------------- shapes

HEALTH = {
    "ok": "bool",
    "version": "string",
    "inventdb_base_url": "string",
    "namespace": "string",
    "frontend_bundled": "bool",
}

LOGIN = {"token": "string", "user": "object", "ok?": "bool"}

AUTH_USER = {"username?": "string", "email?": "string", "role?": "string"}

META_ENTITIES = {
    "entities": [
        {
            "name": "string",
            "label": "string",
            "label_plural": "string",
            "key": "string",
            "search_fields": ["string"],
            "order_by": "string|null",
        }
    ]
}

DASHBOARD_SUMMARY = {
    "properties": {
        "total": "int",
        "occupied": "int",
        "vacant": "int",
        "occupancy_rate": "number",
    },
    "tenants": {"total": "int"},
    "leases": {"total": "int", "active": "int", "expiring_soon": "int"},
    "maintenance": {"total": "int", "open": "int", "in_progress": "int"},
    "financials": {
        "income_month": "number",
        "expense_month": "number",
        "net_month": "number",
        "expected_rent": "number",
    },
}

DASHBOARD_CHARTS = {
    "cashflow": [
        {"month": "string", "income": "number", "expense": "number", "net": "number"}
    ],
    "property_status": [NAME_VALUE],
    "lease_status": [NAME_VALUE],
    "maintenance_status": [NAME_VALUE],
    "maintenance_priority": [NAME_VALUE],
    "expense_breakdown": [NAME_VALUE],
}

REPORT_TEMPLATES = {
    "templates": [
        {
            "id": "string",
            "name": "string",
            "description": "string",
            "category": "string",
            "mode": "string",
            "version": "any",
            "created_by": "string",
        }
    ],
    "count": "int",
}

REPORT_DETAIL = {
    "id": "string",
    "name": "string",
    "description": "string",
    "category": "string",
    "mode": "string",
    "version": "any",
    "parameters": [
        {
            "name": "any",
            "label": "any",
            "type": "string",
            "required": "bool",
            "default": "any",
            "options": [{"value": "string", "label": "string"}],
        }
    ],
}

REPORT_RENDER = {"html": "string", "meta": "object"}

PNL = {
    "income_total": "number",
    "expense_total": "number",
    "net_total": "number",
    "income_by_category": [NAME_VALUE],
    "expense_by_category": [NAME_VALUE],
}

CASHFLOW = {
    "cashflow": [
        {"month": "string", "income": "number", "expense": "number", "net": "number"}
    ]
}

RENT_ROLL = {"rows": [RECORD], "count": "int", "monthly_total": "number"}
RENEWALS = {"rows": [RECORD], "count": "int", "days": "int"}
OCCUPANCY = {
    "distribution": [NAME_VALUE],
    "total": "int",
    "occupied": "int",
    "occupancy_rate": "number",
}
WORK_ORDERS = {
    "by_status": [NAME_VALUE],
    "by_priority": [NAME_VALUE],
    "by_category": [NAME_VALUE],
    "open_cost_estimate": "number",
}

WORKFLOWS = {"workflows": ["object"]}
WORKFLOW_RUNS = {"runs": ["object"]}

DELETE_ACK = {"ok": "bool", "id": "string"}
ERROR = {"ok": "bool", "error": "any"}


# ----------------------------------------------------------------- endpoints
# `path` may contain {record_id} / {template_id}; each side binds them from its
# own fixtures, because the backend's recordings and the frontend's mock store
# do not share ids.

ENDPOINTS: list[dict[str, Any]] = [
    {"key": "health", "method": "GET", "path": "/api/health", "shape": HEALTH, "auth": False},
    {
        "key": "auth-login",
        "method": "POST",
        "path": "/api/auth/login",
        "body": {"username": "e2e.manager", "password": "correct-horse"},
        "shape": LOGIN,
        "auth": False,
    },
    {"key": "auth-me", "method": "GET", "path": "/api/auth/me", "shape": AUTH_USER},
    {"key": "meta-entities", "method": "GET", "path": "/api/meta/entities", "shape": META_ENTITIES},
    {
        "key": "dashboard-summary",
        "method": "GET",
        "path": "/api/dashboard/summary",
        "shape": DASHBOARD_SUMMARY,
    },
    {
        "key": "dashboard-charts",
        "method": "GET",
        "path": "/api/dashboard/charts",
        "shape": DASHBOARD_CHARTS,
    },
    {
        "key": "properties-list",
        "method": "GET",
        "path": "/api/properties",
        "shape": _list_of(RECORD),
    },
    {
        "key": "properties-search",
        "method": "GET",
        "path": "/api/properties?q=a&limit=5",
        "shape": _list_of(RECORD),
    },
    {
        "key": "property-detail",
        "method": "GET",
        "path": "/api/properties/{record_id}",
        "shape": RECORD,
    },
    {
        "key": "property-create",
        "method": "POST",
        "path": "/api/properties",
        "body": {"street": "1 Contract Way", "city": "Mumbai", "status": "Vacant"},
        "shape": RECORD,
        "status": 201,
    },
    {
        "key": "property-update",
        "method": "PUT",
        "path": "/api/properties/{record_id}",
        "body": {"city": "Delhi"},
        "shape": RECORD,
    },
    {
        "key": "property-delete",
        "method": "DELETE",
        "path": "/api/properties/{record_id}",
        "shape": DELETE_ACK,
    },
    {
        "key": "report-templates",
        "method": "GET",
        "path": "/api/reports/templates",
        "shape": REPORT_TEMPLATES,
    },
    {
        "key": "report-detail",
        "method": "GET",
        "path": "/api/reports/templates/{template_id}",
        "shape": REPORT_DETAIL,
    },
    {
        "key": "report-render",
        "method": "POST",
        "path": "/api/reports/templates/{template_id}/render",
        "body": {"params": {}},
        "shape": REPORT_RENDER,
    },
    {"key": "report-pnl", "method": "GET", "path": "/api/reports/pnl", "shape": PNL},
    {"key": "report-cashflow", "method": "GET", "path": "/api/reports/cashflow", "shape": CASHFLOW},
    {
        "key": "report-rent-roll",
        "method": "GET",
        "path": "/api/reports/rent-roll",
        "shape": RENT_ROLL,
    },
    {"key": "report-renewals", "method": "GET", "path": "/api/reports/renewals", "shape": RENEWALS},
    {
        "key": "report-occupancy",
        "method": "GET",
        "path": "/api/reports/occupancy",
        "shape": OCCUPANCY,
    },
    {
        "key": "report-work-orders",
        "method": "GET",
        "path": "/api/reports/work-orders",
        "shape": WORK_ORDERS,
    },
    {"key": "workflows", "method": "GET", "path": "/api/workflows", "shape": WORKFLOWS},
    {"key": "workflow-runs", "method": "GET", "path": "/api/workflows/runs", "shape": WORKFLOW_RUNS},
    {
        "key": "error-envelope",
        "method": "GET",
        "path": "/api/no-such-entity",
        "shape": ERROR,
        "status": 404,
    },
]


# ---------------------------------------------------------------- validation

_SCALARS = {
    "string": lambda v: isinstance(v, str),
    # `bool` is excluded from the numeric types on purpose: JSON `true` where a
    # count is expected is a bug, not a 1.
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "int": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "bool": lambda v: isinstance(v, bool),
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "null": lambda v: v is None,
    "any": lambda _v: True,
}


def validate(shape: Any, value: Any, path: str = "$") -> list[str]:
    """Return a list of human-readable mismatches; empty means conforming."""
    if isinstance(shape, str):
        members = shape.split("|")
        for member in members:
            check = _SCALARS.get(member)
            if check is None:
                return [f"{path}: unknown type in contract: {member!r}"]
            if check(value):
                return []
        return [f"{path}: expected {shape}, got {_describe(value)}"]

    if isinstance(shape, list):
        if not isinstance(value, list):
            return [f"{path}: expected array, got {_describe(value)}"]
        errors: list[str] = []
        for index, item in enumerate(value):
            errors.extend(validate(shape[0], item, f"{path}[{index}]"))
        return errors

    if isinstance(shape, dict):
        if not isinstance(value, dict):
            return [f"{path}: expected object, got {_describe(value)}"]
        errors = []
        for raw_key, sub in shape.items():
            optional = raw_key.endswith("?")
            key = raw_key[:-1] if optional else raw_key
            if key not in value:
                if not optional:
                    errors.append(f"{path}.{key}: missing")
                continue
            errors.extend(validate(sub, value[key], f"{path}.{key}"))
        return errors

    return [f"{path}: malformed contract entry {shape!r}"]


def _describe(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return f"bool({value})"
    if isinstance(value, (int, float, str)):
        return f"{type(value).__name__}({value!r})"
    if isinstance(value, list):
        return f"array[{len(value)}]"
    if isinstance(value, dict):
        return f"object{{{', '.join(sorted(value))}}}"
    return type(value).__name__


# ------------------------------------------------------- SQL statement keys

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def sql_key(statement: str) -> str:
    """Normalise a statement so a recording keeps matching it tomorrow.

    Whitespace is collapsed, and literal dates are masked — ``/api/reports/
    renewals`` interpolates today's date, so an exact-text key would go stale
    every midnight.
    """
    return _DATE_RE.sub("<date>", " ".join(statement.split()))
