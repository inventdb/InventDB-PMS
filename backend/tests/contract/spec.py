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

# A workflow definition. `_id` and `name` are the two fields every surface
# reads, so they are required; the rest is optional because InventDB omits what
# does not apply — `next_run_at` only exists for a cron trigger, `plan` is
# absent from a list response on some versions.
WORKFLOW = {
    "_id": "string",
    "name": "string",
    "trigger_kind?": "string",
    "trigger_intent?": "string",
    "trigger_spec?": "object",
    "plan?": "array",
    "active?": "bool",
    "pending_approval?": "bool",
    "sandbox?": "bool",
    "version?": "int",
    "next_run_at?": "string|null",
}

WORKFLOWS = {"workflows": [WORKFLOW]}
WORKFLOW_VERSIONS = {"versions": ["object"]}
# One frozen definition, read in full so an old plan can be reviewed before a
# rollback. Same shape as a workflow plus its version number.
WORKFLOW_VERSION = {
    "version": "int",
    "name": "string",
    "plan?": "array",
    "trigger_intent?": "string",
    "created_at?": "string",
}
# Firing is asynchronous: the engine queues an event and the run appears later,
# so what comes back identifies the event, not a result.
WORKFLOW_QUEUED = {"event_id": "string"}
WORKFLOW_DELETED = {"deleted": "string"}

# ---- Report Studio ---------------------------------------------------------
# The edit stream is not described here: it is a `text/event-stream` of
# InventDB's own events, relayed rather than reshaped, so there is no JSON body
# for this machinery to check (`tests/test_report_studio.py` covers the relay).
# The snapshot list IS reshaped — two attachments become one report — so it is.

REPORT_SNAPSHOTS = {
    "snapshots": [
        {
            "record_id": "string",
            "attachment_id": "string",
            "name": "string",
            "created_at": "any",
            "from_template": "bool",
        }
    ],
    "count": "int",
}


# ---- Analyze ---------------------------------------------------------------
# The agent stream itself is not described here: it is a `text/event-stream` of
# InventDB's own frames, relayed byte-for-byte rather than reshaped, so there is
# no JSON body for this machinery to check. `tests/test_analyze.py` covers the
# relay. What IS described is everything the room needs *around* the stream —
# the model catalog, the workspace default, the thread history and the
# web-search gate — because those the app does reshape.

ANALYZE_CONFIG = {
    "configured": "bool",
    "model": "string|null",
    "modelFamily": "string|null",
}

ANALYZE_MODELS = {"models": ["object"]}

ANALYZE_THREADS = {"threads": ["object"]}

ANALYZE_WEBSEARCH = {"enabled": "bool", "consented": "bool"}
WORKFLOW_RUNS = {"runs": ["object"]}
# One run with its execution timeline. Relayed as InventDB shapes it — the two
# keys are the contract; what a step row contains is the engine's business, and
# pinning it here would break the PMS every time a new step kind was added.
WORKFLOW_RUN_DETAIL = {"run": "object", "steps": ["object"]}

# ---- The inbox -------------------------------------------------------------
# A notification's `actions` are the contract, not decoration: their absence is
# what distinguishes a bell from a parked run, and the UI's badge, buttons and
# "needs you" state all read from it. The rest of a notification is relayed as
# InventDB shapes it.
NOTIFICATION = {
    "_id": "string",
    "title": "string",
    "body?": "string",
    "actions?": "array",
    "workflow_id?": "string",
    "run_id?": "string",
    "created_at?": "string",
    "read_at?": "string|null",
    "resolved_action?": "string|null",
}
NOTIFICATIONS = {"notifications": [NOTIFICATION]}

# ---- Files -----------------------------------------------------------------
# One search answers both halves of the drive, so all three keys are required
# even when a leg is empty: the grid maps over `results` and the tree over
# `folders`, and an absent key would be a crash rather than an empty drive.
#
# A file row is left loose on purpose. InventDB's search flattens several item
# shapes together, so the same value arrives under more than one spelling
# (`_id`/`attachment_id`, `size`/`size_bytes`) depending on which leg matched —
# pinning one spelling here would fail against a response that is correct.
FILE_SEARCH = {
    "results": ["object"],
    "total_matches": "int",
    "folders": [
        {
            "namespace?": "string",
            # A folder always belongs to a type: "2026" under leases and "2026"
            # under inspections are different folders, and the tree groups by
            # type first for exactly that reason.
            "type": "string",
            # "" means the files sitting at the type's root.
            "path": "string",
            "count": "int",
        }
    ],
}

FILE_LIST = {"files": ["object"]}
FILE_VERSIONS = {"versions": ["object"]}
FILE_TEXT = {"text?": "string"}
# Deliberately one batch: the caller loops so it can show a real count and stop
# between passes. `remaining` is absent unless InventDB reports it.
FILE_BULK_DELETE = {"deleted": "int", "skipped": "int", "remaining?": "int|null"}
# `parents` is every record the file is now reachable from; `[0]` is its
# primary home. A `copy` leaves more than one.
FILE_ATTACH = {"mode": "string", "parents": ["object"]}

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
        "key": "workflow-run-detail",
        "method": "GET",
        "path": "/api/workflows/runs/{run_id}",
        "shape": WORKFLOW_RUN_DETAIL,
    },
    {
        "key": "notifications",
        "method": "GET",
        "path": "/api/notifications",
        "shape": NOTIFICATIONS,
    },
    {
        "key": "notification-detail",
        "method": "GET",
        "path": "/api/notifications/{notification_id}",
        "shape": NOTIFICATION,
    },
    {
        "key": "file-search",
        "method": "POST",
        "path": "/api/files/search",
        "body": {"query": "*", "search_type": "keyword", "limit": 25},
        "shape": FILE_SEARCH,
    },
    {
        "key": "file-list",
        "method": "GET",
        "path": "/api/files/{file_type}/{file_record}",
        "shape": FILE_LIST,
    },
    {
        "key": "file-text",
        "method": "GET",
        "path": "/api/files/{file_type}/{file_record}/{attachment_id}/text",
        "shape": FILE_TEXT,
    },
    {
        "key": "file-versions",
        "method": "GET",
        "path": "/api/files/{file_type}/{file_record}/{attachment_id}/versions",
        "shape": FILE_VERSIONS,
    },
    {
        "key": "file-bulk-delete",
        "method": "POST",
        "path": "/api/files/bulk-delete",
        "body": {"type": "leases", "folder": "2026", "limit": 15},
        "shape": FILE_BULK_DELETE,
    },
    {
        "key": "file-attach",
        "method": "POST",
        "path": "/api/files/attach",
        "body": {"attachment_id": "att-001", "type": "leases", "record_id": "lea-001"},
        "shape": FILE_ATTACH,
    },
    {
        "key": "workflow-detail",
        "method": "GET",
        "path": "/api/workflows/{workflow_id}",
        "shape": WORKFLOW,
    },
    {
        "key": "workflow-versions",
        "method": "GET",
        "path": "/api/workflows/{workflow_id}/versions",
        "shape": WORKFLOW_VERSIONS,
    },
    {
        "key": "workflow-version",
        "method": "GET",
        "path": "/api/workflows/{workflow_id}/versions/1",
        "shape": WORKFLOW_VERSION,
    },
    {
        "key": "workflow-create",
        "method": "POST",
        "path": "/api/workflows",
        "body": {
            "name": "Contract check",
            "trigger_kind": "cron",
            "trigger_spec": {"expr": "0 9 * * 1", "tz": "UTC"},
            "trigger_intent": "Every Monday at 9 AM",
            "plan": [
                {
                    "idx": 0,
                    "kind": "sql_query",
                    "label": "Count leases",
                    "narration": "",
                    "sql": "SELECT 1",
                }
            ],
        },
        "shape": WORKFLOW,
        "status": 201,
    },
    {
        "key": "workflow-update",
        "method": "PUT",
        "path": "/api/workflows/{workflow_id}",
        "body": {"trigger_intent": "Every Monday at 10 AM"},
        "shape": WORKFLOW,
    },
    {
        "key": "workflow-activate",
        "method": "POST",
        "path": "/api/workflows/{workflow_id}/activate",
        "body": {},
        "shape": WORKFLOW,
    },
    {
        "key": "workflow-run",
        "method": "POST",
        "path": "/api/workflows/{workflow_id}/run",
        "body": {"sandbox_override": True},
        "shape": WORKFLOW_QUEUED,
        "status": 202,
    },
    {
        "key": "workflow-delete",
        "method": "DELETE",
        "path": "/api/workflows/{workflow_id}",
        "shape": WORKFLOW_DELETED,
    },
    {
        "key": "report-snapshots",
        "method": "GET",
        "path": "/api/reports/snapshots",
        "shape": REPORT_SNAPSHOTS,
    },
    {
        "key": "analyze-config",
        "method": "GET",
        "path": "/api/analyze/config",
        "shape": ANALYZE_CONFIG,
    },
    {
        "key": "analyze-models",
        "method": "GET",
        "path": "/api/analyze/models",
        "shape": ANALYZE_MODELS,
    },
    {
        "key": "analyze-threads",
        "method": "GET",
        "path": "/api/analyze/threads",
        "shape": ANALYZE_THREADS,
    },
    {
        "key": "analyze-websearch-status",
        "method": "GET",
        "path": "/api/analyze/websearch/status",
        "shape": ANALYZE_WEBSEARCH,
    },
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
