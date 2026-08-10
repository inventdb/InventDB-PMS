"""``app.routers.workflows`` — read-only proxy onto InventDB's workflow engine.

All the logic here is envelope handling. InventDB wraps some responses in
``{"ok": true, "data": ...}`` and returns others bare, and within `data` the
collection may be under a key or may *be* the list. Each handler has to cope
with every combination, so that is what these cover.
"""

from __future__ import annotations

import pytest

WORKFLOWS = [{"_id": "wf-1", "name": "Weekly Lease Renewals Due"}]
RUNS = [{"_id": "run-1", "status": "success"}]


# ===========================================================================
# Listing workflows
# ===========================================================================


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {"workflows": WORKFLOWS}},  # fully wrapped
        {"data": {"workflows": WORKFLOWS}},  # envelope without `ok`
        {"ok": True, "data": WORKFLOWS},  # data *is* the list
        {"workflows": WORKFLOWS},  # bare, keyed
        WORKFLOWS,  # bare list
    ],
)
def test_every_envelope_shape_lands_on_the_same_response(api, fake, upstream):
    fake.on("GET", "/api/workflows", upstream)

    body = api.get("/api/workflows").get_json()

    assert body == {"workflows": WORKFLOWS}


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {"workflows": []}},
        {"ok": True, "data": {"workflows": None}},
        {"ok": True, "data": None},
        {"ok": True, "data": {}},
        None,
    ],
)
def test_an_absent_collection_becomes_an_empty_list_never_null(api, fake, upstream):
    """The frontend maps over this array directly, so `null` would be a crash
    rather than an empty state."""
    fake.on("GET", "/api/workflows", upstream)

    assert api.get("/api/workflows").get_json() == {"workflows": []}


def test_listing_excludes_deleted_workflows(api, fake):
    api.get("/api/workflows")
    assert fake.last_call("GET", "/api/workflows").params == {"include_deleted": "false"}


# ===========================================================================
# Runs
# ===========================================================================


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {"runs": RUNS}},
        {"ok": True, "data": RUNS},
        {"runs": RUNS},
        RUNS,
    ],
)
def test_run_history_is_normalised_the_same_way(api, fake, upstream):
    fake.on("GET", "/api/workflows/runs", upstream)
    assert api.get("/api/workflows/runs").get_json() == {"runs": RUNS}


def test_a_single_run_is_returned_unwrapped(api, fake):
    fake.on("GET", "/api/workflows/runs/run-1", {"ok": True, "data": {"_id": "run-1"}})
    assert api.get("/api/workflows/runs/run-1").get_json() == {"_id": "run-1"}


def test_runs_is_matched_before_the_workflow_id_route(api, fake):
    """`/api/workflows/runs` and `/api/workflows/<workflow_id>` overlap. Flask
    prefers the static rule, so `runs` is never read as a workflow id."""
    api.get("/api/workflows/runs")
    assert fake.calls[-1].path == "/api/workflows/runs"


def test_per_workflow_runs_are_scoped_to_that_workflow(api, fake):
    fake.on("GET", "/api/workflows/wf-1/runs", {"ok": True, "data": {"runs": RUNS}})

    body = api.get("/api/workflows/wf-1/runs").get_json()

    assert body == {"runs": RUNS}
    assert fake.calls[-1].path == "/api/workflows/wf-1/runs"


# ===========================================================================
# Single workflow
# ===========================================================================


def test_a_workflow_definition_is_unwrapped(api, fake):
    fake.on(
        "GET",
        "/api/workflows/wf-1",
        {"ok": True, "data": {"_id": "wf-1", "steps": [{"type": "sql"}]}},
    )

    body = api.get("/api/workflows/wf-1").get_json()

    assert body == {"_id": "wf-1", "steps": [{"type": "sql"}]}


def test_an_unknown_workflow_keeps_its_404(api, fake):
    fake.on("GET", "/api/workflows/nope", {"error": "Not found"}, status=404)

    resp = api.get("/api/workflows/nope")

    assert resp.status_code == 404
    assert resp.get_json()["error"] == "Not found"


@pytest.mark.parametrize(
    "path",
    [
        "/api/workflows",
        "/api/workflows/runs",
        "/api/workflows/runs/run-1",
        "/api/workflows/wf-1",
        "/api/workflows/wf-1/runs",
    ],
)
def test_every_workflow_route_requires_authentication(api, fake, path):
    assert api.get(path, token=None).status_code == 401
    assert fake.calls == []


def test_a_data_key_holding_a_falsy_value_is_still_unwrapped(api, fake):
    """`_data` checks `"data" in payload`, not truthiness — so `{"data": 0}`
    unwraps to `0` rather than returning the envelope."""
    fake.on("GET", "/api/workflows/wf-1", {"ok": True, "data": 0})
    assert api.get("/api/workflows/wf-1").get_json() == 0
