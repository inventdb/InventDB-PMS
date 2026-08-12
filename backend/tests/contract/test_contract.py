"""Replay recorded InventDB responses through the real app and pin the output.

This is the join between the two suites. It does three things:

1. **Replays** ``recordings/inventdb.json`` — ideally captured from a live
   instance — through the actual Flask app, so the responses under test are
   produced by the real routers rather than by a mock of them.
2. **Checks conformance** against ``spec.ENDPOINTS``, the shape description the
   frontend's Playwright suite validates its own mock against. When the backend
   changes shape, this fails here; when the mock drifts from it, it fails there.
3. **Publishes** ``contract/api-contract.json`` and ``contract/responses/*.json``
   at the repo root, so the frontend has something concrete to check against
   instead of hand-written fixtures.

If the app starts issuing a query the recordings do not cover, that is reported
as a failure rather than silently answered with an empty result set — an unnoticed
empty result is precisely how a contract test rots into a test of nothing.

Regenerate the published files with::

    UPDATE_CONTRACT=1 python -m pytest tests/contract
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from tests.contract import spec
from tests.contract.spec import ENDPOINTS, sql_key, validate
from tests.fake_inventdb import Reply

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_DIR = REPO_ROOT / "contract"
CONTRACT_FILE = CONTRACT_DIR / "api-contract.json"
RESPONSES_DIR = CONTRACT_DIR / "responses"
RECORDINGS = Path(__file__).resolve().parent / "recordings" / "inventdb.json"

UPDATING = os.environ.get("UPDATE_CONTRACT") == "1"

pytestmark = pytest.mark.contract


# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture(scope="module")
def recordings() -> dict[str, Any]:
    if not RECORDINGS.exists():
        pytest.skip(f"no recordings at {RECORDINGS}; run tests.contract.capture")
    return json.loads(RECORDINGS.read_text(encoding="utf-8"))


@pytest.fixture
def replay(fake, recordings):
    """Install every recording, and track statements no recording covers."""
    misses: list[str] = []

    # Registered first, so it is consulted last: anything a recording does not
    # answer lands here and is reported instead of quietly returning no rows.
    fake.on_sql(lambda statement: misses.append(sql_key(statement)) or True, rows=[])

    by_key = {entry["key"]: entry for entry in recordings["sql"]}

    def _sql_responder(call):
        entry = by_key.get(sql_key(call.sql or ""))
        rows = entry["rows"] if entry else []
        return Reply(200, {"rows": rows, "metrics": {"count": len(rows)}})

    fake.on_sql(lambda statement: sql_key(statement) in by_key)
    fake._rules[-1].responder = _sql_responder

    for entry in recordings["http"]:
        fake.on(entry["method"], entry["path"], entry["payload"], status=entry["status"])

    fake.misses = misses
    return fake


def bind(path: str, bindings: dict[str, str]) -> str:
    for name, value in bindings.items():
        path = path.replace("{" + name + "}", str(value))
    return path


def endpoint_ids(endpoint: dict[str, Any]) -> str:
    return endpoint["key"]


# ===========================================================================
# Conformance
# ===========================================================================


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=endpoint_ids)
def test_the_backend_response_matches_the_published_contract(
    api, replay, recordings, endpoint
):
    path = bind(endpoint["path"], recordings["bindings"])

    resp = api._open(
        endpoint["method"],
        path,
        token=None if endpoint.get("auth", True) is False else "contract-token",
        json=endpoint.get("body"),
    )

    assert resp.status_code == endpoint.get("status", 200), resp.get_data(as_text=True)

    errors = validate(endpoint["shape"], resp.get_json())
    assert not errors, "\n".join([f"{endpoint['key']} does not match the contract:"] + errors)


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=endpoint_ids)
def test_every_query_the_app_makes_is_covered_by_a_recording(
    api, replay, recordings, endpoint
):
    """Guards the recordings against going stale.

    A query with no recording still returns an empty result, so the shape check
    above would keep passing while testing nothing. This makes that visible.
    """
    api._open(
        endpoint["method"],
        bind(endpoint["path"], recordings["bindings"]),
        token=None if endpoint.get("auth", True) is False else "contract-token",
        json=endpoint.get("body"),
    )

    assert not replay.misses, (
        f"{endpoint['key']} issued queries no recording covers:\n  "
        + "\n  ".join(sorted(set(replay.misses)))
        + "\n\nRe-run `python -m tests.contract.capture` (or --synthetic) to refresh."
    )


def test_endpoints_that_return_data_actually_returned_some(api, replay, recordings):
    """The recordings must be substantive, not a set of empty envelopes.

    Without this, an all-empty recording file would satisfy every shape check
    while proving nothing about the aggregation, joins or merges above it.
    """
    thin: list[str] = []
    for endpoint in ENDPOINTS:
        if endpoint["key"] in {"error-envelope", "property-delete"}:
            continue
        body = api._open(
            endpoint["method"],
            bind(endpoint["path"], recordings["bindings"]),
            token="contract-token",
            json=endpoint.get("body"),
        ).get_json()
        if isinstance(body, dict) and not any(
            value for key, value in body.items() if key != "ok"
        ):
            thin.append(endpoint["key"])

    assert not thin, f"these endpoints replayed to empty responses: {thin}"


# ===========================================================================
# Sanity checks on the contract itself
# ===========================================================================


def test_endpoint_keys_are_unique():
    keys = [endpoint["key"] for endpoint in ENDPOINTS]
    assert len(keys) == len(set(keys))


def test_the_contract_covers_every_response_type_the_frontend_declares():
    """`frontend/src/types.ts` is the frontend's view of this API. Any interface
    there without a contract entry is a shape nothing checks."""
    types_file = REPO_ROOT / "frontend" / "src" / "types.ts"
    if not types_file.exists():  # pragma: no cover - backend-only checkout
        pytest.skip("frontend not present")

    declared = set()
    for line in types_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("export interface "):
            # `ListResponse<T = Record>` -> `ListResponse`
            declared.add(line.split()[2].split("<")[0].rstrip("{").strip())

    # Row/element types are validated through their containers, and AuthUser via
    # the login and /me shapes.
    covered_indirectly = {
        "NameValue",
        "CashflowPoint",
        "RentRollRow",
        "RenewalRow",
        "WorkflowStep",
        "WorkflowRun",
        "WorkflowRunStep",
        "WorkflowVersion",
        "NotificationAction",
        "NotificationFormField",
        "ReportParameter",
        "Record",
        # Element types, validated through the containers that carry them:
        # `FileRow` inside `results`, `FolderAgg` inside `folders`,
        # `FileVersion` inside `versions`.
        "FileRow",
        "FolderAgg",
        "FileVersion",
        # Not responses at all, so no endpoint can describe them: `WorkflowDraft`
        # is what the editor *sends* on create, and `PlanIssue` rides inside a
        # 400 body alongside the error message. `WorkflowFix` is a proposal
        # produced by a model call, so the contract suite — which only replays
        # reads — cannot exercise it; `tests/test_workflows.py` pins its shape.
        "WorkflowDraft",
        "PlanIssue",
        "WorkflowFix",
    }
    expected = {
        "LoginResponse",
        "AuthUser",
        "ListResponse",
        "DashboardSummary",
        "DashboardCharts",
        "ReportSummary",
        "ReportDetail",
        "ReportRender",
        "Pnl",
        "WorkOrdersReport",
        "Workflow",
        "WorkflowRunDetail",
        "AppNotification",
        # What resolving returns. Not covered by an endpoint entry because the
        # contract suite only replays reads: resolving one would resume a real
        # parked run. `tests/test_notifications.py` pins the shape instead.
        "NotificationResolution",
        "FileSearchResponse",
        "BulkDeleteResult",
    }

    missing = declared - covered_indirectly - expected
    assert not missing, (
        f"frontend/src/types.ts declares {sorted(missing)}, which no contract "
        "endpoint covers — add an entry to tests/contract/spec.py"
    )


@pytest.mark.parametrize(
    "shape,value,ok",
    [
        ("string", "x", True),
        ("string", 1, False),
        ("number", 1, True),
        ("number", 1.5, True),
        ("number", True, False),  # a bool is not a count
        ("int", 1.5, False),
        ("bool", True, True),
        ("string|null", None, True),
        ("string|null", "x", True),
        ("string|null", 1, False),
        ({"a": "int"}, {"a": 1}, True),
        ({"a": "int"}, {}, False),
        ({"a?": "int"}, {}, True),
        ({"a": "int"}, {"a": 1, "extra": 2}, True),  # extra fields are allowed
        (["int"], [1, 2], True),
        (["int"], [1, "x"], False),
        (["int"], [], True),
        (["int"], {}, False),
    ],
)
def test_the_validator_itself(shape, value, ok):
    assert (validate(shape, value) == []) is ok


@pytest.mark.parametrize(
    "statement,expected",
    [
        ("SELECT  1   FROM x", "SELECT 1 FROM x"),
        ("SELECT 1\n  FROM x", "SELECT 1 FROM x"),
        ("WHERE d >= '2026-08-10'", "WHERE d >= '<date>'"),
    ],
)
def test_sql_keys_are_normalised(statement, expected):
    assert sql_key(statement) == expected


# ===========================================================================
# Publishing
# ===========================================================================


def _contract_document() -> dict[str, Any]:
    return {
        "_comment": (
            "Generated by backend/tests/contract/test_contract.py from "
            "backend/tests/contract/spec.py. Do not edit by hand — regenerate "
            "with `UPDATE_CONTRACT=1 python -m pytest tests/contract`."
        ),
        "version": 1,
        "endpoints": [
            {
                "key": endpoint["key"],
                "method": endpoint["method"],
                "path": endpoint["path"],
                "status": endpoint.get("status", 200),
                "auth": endpoint.get("auth", True),
                "body": endpoint.get("body"),
                "shape": endpoint["shape"],
            }
            for endpoint in ENDPOINTS
        ],
    }


def test_the_published_contract_is_up_to_date():
    """The frontend reads the published JSON, not `spec.py`, so a change to the
    spec that is not published would leave the two suites checking different
    things."""
    document = json.dumps(_contract_document(), indent=2) + "\n"

    if UPDATING:
        CONTRACT_DIR.mkdir(parents=True, exist_ok=True)
        CONTRACT_FILE.write_text(document, encoding="utf-8")

    assert CONTRACT_FILE.exists(), (
        f"{CONTRACT_FILE} is missing — run "
        "`UPDATE_CONTRACT=1 python -m pytest tests/contract`"
    )
    assert CONTRACT_FILE.read_text(encoding="utf-8") == document, (
        f"{CONTRACT_FILE} is stale — run "
        "`UPDATE_CONTRACT=1 python -m pytest tests/contract`"
    )


def test_the_published_example_responses_are_up_to_date(api, replay, recordings):
    """Snapshots of what the backend really returns for the recorded upstream.

    These are the files that replace hand-written frontend fixtures: they are
    the app's own output, not somebody's recollection of it.
    """
    snapshots: dict[str, Any] = {}
    for endpoint in ENDPOINTS:
        resp = api._open(
            endpoint["method"],
            bind(endpoint["path"], recordings["bindings"]),
            token=None if endpoint.get("auth", True) is False else "contract-token",
            json=endpoint.get("body"),
        )
        snapshots[endpoint["key"]] = resp.get_json()

    stale: list[str] = []
    for key, body in snapshots.items():
        target = RESPONSES_DIR / f"{key}.json"
        rendered = json.dumps(body, indent=2, sort_keys=True) + "\n"
        if UPDATING:
            RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
            target.write_text(rendered, encoding="utf-8")
        elif not target.exists() or target.read_text(encoding="utf-8") != rendered:
            stale.append(key)

    assert not stale, (
        f"contract/responses is stale for {stale} — run "
        "`UPDATE_CONTRACT=1 python -m pytest tests/contract`"
    )


def test_no_recording_carries_a_credential(recordings):
    """`capture.py` redacts before writing; this is the check that it worked,
    since these files are committed."""
    blob = json.dumps(recordings).lower()
    for needle in ("bearer ", "eyj", "password\": \"", "authorization"):
        assert needle not in blob.replace('"password": "<redacted>"', ""), (
            f"the recordings appear to contain a credential ({needle!r})"
        )


def test_generated_keys_are_stable_between_the_spec_and_the_module():
    assert {e["key"] for e in ENDPOINTS} == {e["key"] for e in spec.ENDPOINTS}
