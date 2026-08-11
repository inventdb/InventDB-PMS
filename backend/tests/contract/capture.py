"""Record the InventDB responses the contract tests replay.

The point of the recordings is that the contract tests run against payloads a
real instance produced, rather than against payloads someone wrote to match
what they believed the API returned. Belief is exactly what drifts.

Rather than transcribe endpoints by hand, this drives the **real Flask app**
with a recording wrapper installed around ``requests.request``. Whatever the app
asks InventDB for during a full pass over the contract is what gets recorded —
so the recordings are, by construction, the set the tests need, and they update
themselves when the app's queries change.

Usage
-----
Refresh from a live instance (read-only)::

    cd backend
    INVENTDB_BASE_URL=https://<slug>.sandbox.inventdb.com \\
    INVENTDB_USERNAME=you INVENTDB_PASSWORD=... \\
    python -m tests.contract.capture

Also exercise create/update/delete against that instance — this **writes to the
live namespace**, creating one property and deleting it again::

    python -m tests.contract.capture --include-writes

Regenerate the checked-in synthetic baseline (no network, no credentials)::

    python -m tests.contract.capture --synthetic

Secrets are stripped before anything is written: bearer tokens, password
fields, and any key whose name looks credential-shaped.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
RECORDING_PATH = HERE / "recordings" / "inventdb.json"

REDACTED = "<redacted>"
_SECRET_KEYS = {
    "token",
    "access_token",
    "refresh_token",
    "jwt",
    "password",
    "current_password",
    "new_password",
    "secret",
    "api_key",
    "apikey",
    "authorization",
}


# ===========================================================================
# The synthetic baseline
# ===========================================================================
# Committed so the suite is meaningful in a checkout with no credentials. These
# are shaped like InventDB's responses but the values are invented — running a
# live capture replaces them, and the `source` field in the written file says
# which of the two you are looking at.

_PROPERTY_ROWS = [
    {
        "_id": "rec-001",
        "property_id": "P-001",
        "street": "12 Marine Drive",
        "city": "Mumbai",
        "state": "MH",
        "zip": "400020",
        "region": "West",
        "owner_id": "O-001",
        "type": "Condo",
        "status": "Occupied",
        "beds": 3,
        "baths": 2,
        "sqft": 1450,
        "year_built": 2011,
    },
    {
        "_id": "rec-002",
        "property_id": "P-002",
        "street": "9 Park Lane",
        "city": "Delhi",
        "state": "DL",
        "zip": "110001",
        "region": "North",
        "owner_id": "O-002",
        "type": "Apartment",
        "status": "Vacant",
        "beds": 2,
        "baths": 1,
        "sqft": 980,
        "year_built": 2004,
    },
]

_LEASE_ROWS = [
    {
        "_id": "lease-001",
        "lease_id": "L-001",
        "tenant_name": "Asha Rao",
        "property_id": "P-001",
        "status": "Active",
        "contract_rent": 2500,
        "market_rent": 2750,
        "lease_start": "2024-01-01",
        "lease_end": "2026-12-31",
        "renewal_type": "Auto",
    }
]

_SYNTHETIC_HTTP: dict[str, dict[str, Any]] = {
    "POST /api/auth/login": {
        "status": 200,
        "payload": {
            "ok": True,
            "token": REDACTED,
            "user": {
                "id": "u-1",
                "username": "e2e.manager",
                "email": "e2e.manager@example.com",
                "role": "manager",
                "isActive": True,
            },
        },
    },
    "GET /api/auth/me": {
        "status": 200,
        "payload": {
            "id": "u-1",
            "username": "e2e.manager",
            "email": "e2e.manager@example.com",
            "role": "manager",
            "isActive": True,
        },
    },
    "GET /db/pms/properties/rec-001": {"status": 200, "payload": _PROPERTY_ROWS[0]},
    "POST /db/pms/properties": {"status": 200, "payload": {"ok": True, "id": "rec-001"}},
    "PUT /db/pms/properties": {"status": 200, "payload": {"ok": True, "id": "rec-001"}},
    "DELETE /db/pms/properties/rec-001": {"status": 200, "payload": {"ok": True}},
    "GET /api/report-templates": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "templates": [
                    {
                        "_id": "tpl-001",
                        "name": "Owner Statement",
                        "description": "Monthly statement for a single owner.",
                        "category": "Finance",
                        "mode": "sql",
                        "version": 3,
                        "createdBy": "soar.admin",
                    },
                    {
                        "_id": "tpl-002",
                        "name": "Lease Renewals Due",
                        "description": "Leases ending in the next 90 days.",
                        "category": "Leasing",
                        "mode": "sql",
                        "version": 1,
                        "createdBy": "soar.admin",
                    },
                ]
            },
        },
    },
    "GET /api/report-templates/tpl-001": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "_id": "tpl-001",
                "name": "Owner Statement",
                "description": "Monthly statement for a single owner.",
                "category": "Finance",
                "mode": "sql",
                "version": 3,
                "html": "<h1>{{ owner.name }}</h1>",
                "parameters": [
                    {
                        "name": "owner_id",
                        "label": "Owner",
                        "type": "select",
                        "required": True,
                        "source": "pms.owners",
                    },
                    {"name": "as_of", "label": "As of", "type": "date", "required": False},
                ],
            },
        },
    },
    "POST /api/report-templates/tpl-001/render": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "html": "<section><h1>Owner Statement</h1></section>",
                "meta": {"elapsed_ms": 128, "mode": "sql", "bytes": 512},
            },
        },
    },
    "GET /api/workflows": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "workflows": [
                    {
                        "_id": "wf-001",
                        "name": "Weekly Lease Renewals Due",
                        "trigger_kind": "cron",
                        "trigger_spec": {"expr": "0 9 * * 1", "tz": "UTC"},
                        "trigger_intent": "Every Monday at 9 AM",
                        "active": True,
                        "pending_approval": False,
                        "sandbox": False,
                        "version": 2,
                        "plan": [
                            {
                                "idx": 0,
                                "kind": "sql_query",
                                "label": "Query renewals",
                                "narration": "Finds leases ending in the next 30 days.",
                                "sql": "SELECT * FROM pms.leases",
                                "save_as": "expiring",
                            }
                        ],
                    }
                ]
            },
        },
    },
    "GET /api/workflows/wf-001": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "_id": "wf-001",
                "name": "Weekly Lease Renewals Due",
                "trigger_kind": "cron",
                "trigger_spec": {"expr": "0 9 * * 1", "tz": "UTC"},
                "trigger_intent": "Every Monday at 9 AM",
                "active": True,
                "pending_approval": False,
                "sandbox": False,
                "version": 2,
                "next_run_at": "2026-08-17T09:00:00Z",
                "plan": [
                    {
                        "idx": 0,
                        "kind": "sql_query",
                        "label": "Query renewals",
                        "narration": "Finds leases ending in the next 30 days.",
                        "sql": "SELECT * FROM pms.leases",
                        "save_as": "expiring",
                    }
                ],
            },
        },
    },
    "GET /api/workflows/wf-001/versions": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "versions": [
                    {
                        "_id": "wf-001.v1",
                        "workflow_id": "wf-001",
                        "version": 1,
                        "name": "Weekly Lease Renewals Due",
                        "trigger_intent": "Every Monday at 8 AM",
                        "plan": [{"idx": 0, "kind": "sql_query", "label": "Query renewals"}],
                        "created_at": "2026-07-01T00:00:00Z",
                    }
                ]
            },
        },
    },
    # Writes. A created workflow comes back inactive and awaiting approval —
    # the engine's decision, not the caller's — which is what the PMS's
    # "Never activated" state reads from.
    "POST /api/workflows": {
        "status": 201,
        "payload": {
            "ok": True,
            "data": {
                "_id": "wf-002",
                "name": "Contract check",
                "trigger_kind": "cron",
                "trigger_spec": {"expr": "0 9 * * 1", "tz": "UTC"},
                "trigger_intent": "Every Monday at 9 AM",
                "active": False,
                "pending_approval": True,
                "sandbox": True,
                "version": 1,
                "plan": [{"idx": 0, "kind": "sql_query", "label": "Count leases"}],
            },
            "issues": [],
        },
    },
    "PUT /api/workflows/wf-001": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "_id": "wf-001",
                "name": "Weekly Lease Renewals Due",
                "trigger_intent": "Every Monday at 10 AM",
                "active": True,
                "version": 3,
            },
            "issues": [],
        },
    },
    "POST /api/workflows/wf-001/activate": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "_id": "wf-001",
                "name": "Weekly Lease Renewals Due",
                "active": True,
                "pending_approval": False,
                "sandbox": False,
            },
        },
    },
    "POST /api/workflows/wf-001/run": {
        "status": 201,
        "payload": {
            "ok": True,
            "data": {
                "event_id": "ev-001",
                "workflow_id": "wf-001",
                "status": "pending",
            },
        },
    },
    "DELETE /api/workflows/wf-001": {
        "status": 200,
        "payload": {"ok": True, "data": {"deleted": "wf-001"}},
    },
    "GET /api/workflows/runs": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "runs": [
                    {
                        "_id": "run-001",
                        "workflow_id": "wf-001",
                        "status": "success",
                        "started_at": "2026-08-03T06:00:00Z",
                        "ended_at": "2026-08-03T06:00:07Z",
                        "error": None,
                    }
                ]
            },
        },
    },
    # One run's timeline. The engine writes a `tool_call` before a step runs and
    # a `tool_result` after, both at the plan step's own `idx` — so the SQL as
    # it was actually issued sits next to what it returned. The baseline keeps
    # that pairing because the UI reads the two together.
    "GET /api/workflows/runs/run-001": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "run": {
                    "_id": "run-001",
                    "workflow_id": "wf-001",
                    "status": "success",
                    "started_at": "2026-08-03T06:00:00Z",
                    "ended_at": "2026-08-03T06:00:07Z",
                    "error": None,
                    "sandbox": False,
                },
                "steps": [
                    {
                        "_id": "rs-001",
                        "run_id": "run-001",
                        "idx": 0,
                        "role": "tool_call",
                        "created_at": "2026-08-03T06:00:01Z",
                        "content": "[Query renewals] Leases expiring in the next 30 days.",
                        "tool_name": "sql_query",
                        "tool_args": {
                            "sql": "SELECT _id FROM pms.leases WHERE end_date < '2026-09-02'"
                        },
                        "tool_result": None,
                    },
                    {
                        "_id": "rs-002",
                        "run_id": "run-001",
                        "idx": 0,
                        "role": "tool_result",
                        "created_at": "2026-08-03T06:00:03Z",
                        "content": "",
                        "tool_name": "sql_query",
                        "tool_args": None,
                        "tool_result": [{"_id": "lease-001"}],
                    },
                ],
            },
        },
    },
    # The inbox. One parked decision and one bell, because the difference —
    # actions present or absent — is what the whole surface keys off.
    "GET /api/workflows/notifications": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "notifications": [
                    {
                        "_id": "notif-001",
                        "title": "Assign a contractor: kitchen tap dripping",
                        "body": "<p><strong>Recommended:</strong> Coastal Plumbing</p>",
                        "actions": [
                            {"id": "approve", "label": "Assign the recommended contractor", "kind": "approve"},
                            {"id": "decline", "label": "Not now", "kind": "decline"},
                        ],
                        "workflow_id": "wf-001",
                        "run_id": "run-001",
                        "step_idx": 6,
                        "created_at": "2026-08-11T06:42:00Z",
                        "read_at": None,
                        "resolved_action": None,
                    },
                    {
                        "_id": "notif-002",
                        "title": "Weekly renewals digest sent",
                        "body": "4 renewals are due in the next 30 days.",
                        "actions": [],
                        "workflow_id": "wf-001",
                        "run_id": "run-001",
                        "created_at": "2026-08-10T08:00:00Z",
                        "read_at": "2026-08-10T09:15:00Z",
                        "resolved_action": None,
                    },
                ]
            },
        },
    },
    "GET /api/workflows/notifications/notif-001": {
        "status": 200,
        "payload": {
            "ok": True,
            "data": {
                "_id": "notif-001",
                "title": "Assign a contractor: kitchen tap dripping",
                "body": "<p><strong>Recommended:</strong> Coastal Plumbing</p>",
                "actions": [
                    {"id": "approve", "label": "Assign the recommended contractor", "kind": "approve"},
                    {"id": "decline", "label": "Not now", "kind": "decline"},
                ],
                "workflow_id": "wf-001",
                "run_id": "run-001",
                "created_at": "2026-08-11T06:42:00Z",
                "read_at": None,
                "resolved_action": None,
            },
        },
    },
    # Analyze. `/ai/config` really does return the provider's masked key and
    # gateway URL; it is reproduced here so the offline baseline exercises the
    # same trimming the live one does — the app must forward neither.
    "GET /ai/config": {
        "status": 200,
        "payload": {
            "configured": True,
            "maskedKey": "2BVN...GchL",
            "baseUrl": "http://ai-gateway.inventdb.local:4300/anthropic/v1",
            "model": "claude-sonnet-5",
            "modelFamily": "claude",
        },
    },
    "GET /ai/models": {
        "status": 200,
        "payload": [
            {
                "id": "claude-sonnet-5",
                "key": "claude-sonnet-5",
                "name": "claude-sonnet-5 (active - current default)",
                "provider": "anthropic",
                "family": "Claude",
                "display": "Claude Sonnet 5",
                "is_reasoning": True,
                "is_active": True,
            },
            {
                "id": "claude-opus-4-8",
                "key": "claude-opus-4-8",
                "name": "Claude - Claude Opus 4.8",
                "provider": "anthropic",
                "family": "Claude",
                "display": "Claude Opus 4.8",
                "is_reasoning": True,
                "is_active": False,
            },
        ],
    },
    "GET /ai/threads": {
        "status": 200,
        "payload": {
            "ok": True,
            "threads": [
                {
                    "_id": "soar_thread-001",
                    "user_id": "user-001",
                    "label": "Rent roll by property type",
                    "created": "2026-08-01T09:00:00.000Z",
                    "_exchanges": [
                        {
                            "question": "Rent roll by property type",
                            "answer": "Single-family homes carry $48,200 of the monthly roll.",
                            "ts": "2026-08-01T09:00:04.000Z",
                            "artifacts": [],
                            "steps": [],
                        }
                    ],
                }
            ],
        },
    },
    # An instance where the gate has been turned on. Two `false`s would satisfy
    # the shape check while proving nothing forwards, and the suite's
    # "endpoints that return data actually returned some" rule rightly rejects
    # an all-falsy body.
    # One stored AI snapshot and the `.source.html` behind it — the pair the
    # studio has to collapse into a single library row.
    "GET /attach/_System/AIReports/report_1/att-1/download": {
        "status": 200,
        "payload": None,
    },
    "GET /api/websearch/status": {
        "status": 200,
        "payload": {"enabled": True, "consented": True, "consented_at": 1786083054},
    },
}

_SYNTHETIC_SQL: dict[str, list[dict[str, Any]]] = {
    "SELECT _id, record_id, filename, description, content_type, tags, created_at "
    "FROM _System._attachments WHERE record_type = 'AIReports' "
    "ORDER BY created_at DESC LIMIT 500": [
        {
            "_id": "att-1",
            "record_id": "report_1",
            "filename": "Rent_Roll_20260811_055342.html",
            "description": "AI-generated report: Rent Roll (2026-08-11 05:53)",
            "content_type": "text/html",
            "tags": ["ai-report", "auto-generated"],
            "created_at": "2026-08-11T05:53:42Z",
        },
        {
            "_id": "att-2",
            "record_id": "report_1",
            "filename": "Rent_Roll_20260811_055342.source.html",
            "description": "Source HTML for AI report: Rent Roll",
            "content_type": "text/html",
            "tags": ["ai-report-source", "auto-generated"],
            "created_at": "2026-08-11T05:53:42Z",
        },
    ],
    "SELECT * FROM pms.properties LIMIT 5000": _PROPERTY_ROWS,
    "SELECT * FROM pms.properties ORDER BY street ASC LIMIT 500 OFFSET 0": _PROPERTY_ROWS,
    "SELECT * FROM pms.properties ORDER BY street ASC LIMIT 5000": _PROPERTY_ROWS,
    "SELECT COUNT(*) AS c FROM pms.properties": [{"c": 2}],
    "SELECT * FROM pms.tenants LIMIT 5000": [
        {"_id": "ten-001", "tenant_id": "T-001", "first": "Asha", "last": "Rao"}
    ],
    "SELECT * FROM pms.leases LIMIT 5000": _LEASE_ROWS,
    # The vendor roster the maintenance shortlist ranks. One insured specialist
    # and one uninsured generalist, so the ordering rule the endpoint promises
    # has something to demonstrate itself on.
    "SELECT _id, vendor_id, company, trade, contact, phone, email, rating, "
    "coi_on_file, w_9_on_file FROM pms.vendors LIMIT 500": [
        {
            "_id": "ven-001",
            "vendor_id": "V-001",
            "company": "Coastal Plumbing",
            "trade": "Plumbing",
            "contact": "Ravi N.",
            "phone": "+91 22 5550 7788",
            "email": "ops@coastalplumbing.example",
            "rating": 4.6,
            "coi_on_file": True,
            "w_9_on_file": True,
        },
        {
            "_id": "ven-002",
            "vendor_id": "V-002",
            "company": "Handy Helpers",
            "trade": "General",
            "contact": "Priya K.",
            "phone": "+91 80 5550 9911",
            "email": "team@handyhelpers.example",
            "rating": 4.1,
            "coi_on_file": False,
            "w_9_on_file": False,
        },
    ],
    "SELECT * FROM pms.work_orders LIMIT 5000": [
        {
            "_id": "wo-001",
            "wo": "WO-001",
            "status": "Open",
            "priority": "High",
            "category": "HVAC",
            "est_cost": 450,
        }
    ],
    "SELECT * FROM pms.transactions LIMIT 5000": [
        {
            "_id": "tx-001",
            "reference": "TX-001",
            "type": "Income",
            "account_category": "Rent",
            "amount": 2500,
            "date": "2026-08-01",
        },
        {
            "_id": "tx-002",
            "reference": "TX-002",
            "type": "Expense",
            "account_category": "Repairs",
            "amount": 320,
            "date": "2026-08-04",
        },
    ],
    "SELECT type, SUM(amount) AS total, COUNT(*) AS n FROM pms.transactions GROUP BY type": [
        {"type": "income", "total": 2500, "n": 1},
        {"type": "expense", "total": 320, "n": 1},
    ],
    "SELECT account_category, SUM(amount) AS value FROM pms.transactions "
    "WHERE lower(type) = 'income' GROUP BY account_category ORDER BY value DESC": [
        {"account_category": "rent", "value": 2500}
    ],
    "SELECT account_category, SUM(amount) AS value FROM pms.transactions "
    "WHERE lower(type) = 'expense' GROUP BY account_category ORDER BY value DESC": [
        {"account_category": "repairs", "value": 320}
    ],
    "SELECT YEAR(date) AS y, MONTH(date) AS m, type, SUM(amount) AS total "
    "FROM pms.transactions GROUP BY y, m, type": [
        {"y": 2026, "m": 8, "type": "income", "total": 2500},
        {"y": 2026, "m": 8, "type": "expense", "total": 320},
    ],
    "SELECT status, COUNT(*) AS value FROM pms.properties GROUP BY status ORDER BY value DESC": [
        {"status": "occupied", "value": 1},
        {"status": "vacant", "value": 1},
    ],
    "SELECT status, COUNT(*) AS value FROM pms.work_orders GROUP BY status ORDER BY value DESC": [
        {"status": "open", "value": 1}
    ],
    "SELECT priority, COUNT(*) AS value FROM pms.work_orders GROUP BY priority ORDER BY value DESC": [
        {"priority": "high", "value": 1}
    ],
    "SELECT category, COUNT(*) AS value FROM pms.work_orders GROUP BY category ORDER BY value DESC": [
        {"category": "hvac", "value": 1}
    ],
    "SELECT SUM(est_cost) AS total FROM pms.work_orders WHERE lower(status) != 'completed'": [
        {"total": 450}
    ],
    "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, l.property_id AS property_id, "
    "p.city AS city, p.state AS state, l.contract_rent AS contract_rent, "
    "l.market_rent AS market_rent, l.lease_start AS lease_start, l.lease_end AS lease_end, "
    "l.status AS status FROM pms.leases l JOIN pms.properties p "
    "ON l.property_id = p.property_id WHERE lower(l.status) = 'active' "
    "ORDER BY l.contract_rent DESC": [
        {
            "lease_id": "L-001",
            "tenant_name": "Asha Rao",
            "property_id": "P-001",
            "city": "Mumbai",
            "state": "MH",
            "contract_rent": 2500,
            "market_rent": 2750,
            "lease_start": "2024-01-01",
            "lease_end": "2026-12-31",
            "status": "active",
        }
    ],
    "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, l.property_id AS property_id, "
    "p.city AS city, l.lease_end AS lease_end, l.contract_rent AS contract_rent, "
    "l.market_rent AS market_rent, l.renewal_type AS renewal_type "
    "FROM pms.leases l JOIN pms.properties p ON l.property_id = p.property_id "
    "WHERE l.lease_end >= '<date>' AND l.lease_end <= '<date>' ORDER BY l.lease_end ASC": [
        {
            "lease_id": "L-001",
            "tenant_name": "Asha Rao",
            "property_id": "P-001",
            "city": "Mumbai",
            "lease_end": "2026-12-31",
            "contract_rent": 2500,
            "market_rent": 2750,
            "renewal_type": "Auto",
        }
    ],
    "SELECT * FROM pms.owners LIMIT 200": [
        {"_id": "own-001", "owner_id": "O-001", "name": "Acme Holdings"},
        {"_id": "own-002", "owner_id": "O-002", "name": "Vista Trust"},
    ],
}

_SYNTHETIC_BINDINGS = {
    "record_id": "rec-001",
    "template_id": "tpl-001",
    "workflow_id": "wf-001",
    "run_id": "run-001",
    "notification_id": "notif-001",
}


# ===========================================================================
# Redaction
# ===========================================================================


def redact(value: Any) -> Any:
    """Strip anything credential-shaped, at any depth."""
    if isinstance(value, dict):
        return {
            key: (REDACTED if key.lower() in _SECRET_KEYS else redact(sub))
            for key, sub in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


# ===========================================================================
# Writing
# ===========================================================================


def write_recordings(
    http: dict[str, dict[str, Any]],
    sql: dict[str, Any],
    bindings: dict[str, str],
    *,
    source: str,
    base_url: str | None = None,
    captured_at: str | None = None,
    out: Path = RECORDING_PATH,
) -> Path:
    document = {
        "_comment": (
            "InventDB responses replayed by tests/contract/test_contract.py. "
            "Regenerate with `python -m tests.contract.capture`."
        ),
        "source": source,
        "base_url": base_url,
        "captured_at": captured_at,
        "bindings": bindings,
        "http": [
            {
                "method": key.split(" ", 1)[0],
                "path": key.split(" ", 1)[1],
                "status": entry["status"],
                "payload": redact(entry["payload"]),
            }
            for key, entry in sorted(http.items())
        ],
        "sql": [
            {"key": key, "status": 200, "rows": redact(rows)}
            for key, rows in sorted(sql.items())
        ],
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n", encoding="utf-8")
    return out


# ===========================================================================
# Live capture
# ===========================================================================


def capture_live(*, include_writes: bool, out: Path) -> Path:
    """Drive the real app against a real instance, recording every upstream call."""
    import datetime

    import requests

    base_url = os.environ.get("INVENTDB_BASE_URL", "").rstrip("/")
    username = os.environ.get("INVENTDB_USERNAME")
    password = os.environ.get("INVENTDB_PASSWORD")
    if not (base_url and username and password):
        raise SystemExit(
            "Live capture needs INVENTDB_BASE_URL, INVENTDB_USERNAME and "
            "INVENTDB_PASSWORD. Run with --synthetic to regenerate the offline "
            "baseline instead."
        )

    login = requests.post(
        f"{base_url}/api/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    login.raise_for_status()
    token = login.json().get("token")
    if not token:
        raise SystemExit(f"No token in the login response: {login.text[:200]}")

    from app.main import create_app
    import app.inventdb as inventdb_module
    from tests.contract.spec import ENDPOINTS, sql_key

    real_request = requests.request
    http: dict[str, dict[str, Any]] = {}
    sql: dict[str, Any] = {}

    def recording_request(method, url, **kwargs):
        response = real_request(method, url, **kwargs)
        path = url[len(base_url) :] if url.startswith(base_url) else url
        try:
            payload = response.json() if response.content else None
        except ValueError:
            payload = None

        if path == "/sql":
            statement = (kwargs.get("json") or {}).get("sql", "")
            rows = payload.get("rows", []) if isinstance(payload, dict) else payload
            sql[sql_key(statement)] = rows or []
        else:
            http[f"{method.upper()} {path}"] = {
                "status": response.status_code,
                "payload": payload,
            }
        return response

    inventdb_module.requests.request = recording_request
    try:
        client = create_app().test_client()
        headers = {"Authorization": f"Bearer {token}"}

        # Bind the parameterised paths to ids that exist on this instance.
        listing = client.get("/api/properties?limit=1", headers=headers).get_json() or {}
        items = listing.get("items") or []
        record_id = (items[0].get("_id") if items else None) or "rec-001"

        templates = (client.get("/api/reports/templates", headers=headers).get_json() or {}).get(
            "templates"
        ) or []
        template_id = (templates[0].get("id") if templates else None) or "tpl-001"

        workflows = (client.get("/api/workflows", headers=headers).get_json() or {}).get(
            "workflows"
        ) or []
        workflow_id = (workflows[0].get("_id") if workflows else None) or "wf-001"

        # An instance with no runs yet is normal — a fresh workflow has not
        # fired. The placeholder then records the 404, which is a real part of
        # the contract rather than a gap in it.
        runs = (client.get("/api/workflows/runs", headers=headers).get_json() or {}).get(
            "runs"
        ) or []
        run_id = (runs[0].get("_id") if runs else None) or "run-001"

        # Same reasoning as runs: an instance where nothing has ever parked has
        # an empty inbox, and the placeholder records that 404 honestly.
        notifications = (
            client.get("/api/notifications", headers=headers).get_json() or {}
        ).get("notifications") or []
        notification_id = (
            notifications[0].get("_id") if notifications else None
        ) or "notif-001"

        bindings = {
            "record_id": record_id,
            "template_id": template_id,
            "workflow_id": workflow_id,
            "run_id": run_id,
            "notification_id": notification_id,
        }
        # Skipped unless `--include-writes`. The workflow writes are more
        # consequential than the property ones: activating or firing a real
        # workflow can send real mail, and the delete would remove an
        # automation the instance is relying on. Their synthetic recordings
        # stand in by default.
        writes = {
            "property-create",
            "property-update",
            "property-delete",
            "workflow-create",
            "workflow-update",
            "workflow-activate",
            "workflow-run",
            "workflow-delete",
        }

        for endpoint in ENDPOINTS:
            if endpoint["key"] in writes and not include_writes:
                continue
            path = endpoint["path"]
            for name, value in bindings.items():
                path = path.replace("{" + name + "}", str(value))
            client.open(
                path,
                method=endpoint["method"],
                json=endpoint.get("body"),
                headers=headers if endpoint.get("auth", True) else None,
            )

        if include_writes:
            # Clean up after ourselves: the create above left a row behind.
            created = client.post(
                "/api/properties",
                json={"street": "1 Contract Way", "city": "Mumbai", "status": "Vacant"},
                headers=headers,
            ).get_json()
            new_id = (created or {}).get("_id")
            if new_id:
                client.delete(f"/api/properties/{new_id}", headers=headers)
    finally:
        inventdb_module.requests.request = real_request

    written = write_recordings(
        http,
        sql,
        bindings,
        source="live",
        base_url=base_url,
        captured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        out=out,
    )
    print(
        f"Captured {len(http)} HTTP responses and {len(sql)} SQL results "
        f"from {base_url} -> {written}"
    )
    if not include_writes:
        print(
            "Write endpoints were skipped; their synthetic recordings are kept. "
            "Pass --include-writes to capture them (this mutates the namespace)."
        )
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="regenerate the offline baseline instead of calling a live instance",
    )
    parser.add_argument(
        "--include-writes",
        action="store_true",
        help="also capture create/update/delete — WRITES TO THE LIVE NAMESPACE",
    )
    parser.add_argument("--out", type=Path, default=RECORDING_PATH)
    args = parser.parse_args(argv)

    if args.synthetic:
        written = write_recordings(
            _SYNTHETIC_HTTP, _SYNTHETIC_SQL, _SYNTHETIC_BINDINGS, source="synthetic", out=args.out
        )
        print(f"Wrote the synthetic baseline to {written}")
        return 0

    capture_live(include_writes=args.include_writes, out=args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
