"""``app.routers.workflows`` — the PMS's proxy onto InventDB's workflow engine.

Two things are worth protecting here.

**Envelope handling.** InventDB wraps some responses in ``{"ok": true, "data":
...}`` and returns others bare, and within `data` the collection may be under a
key or may *be* the list. Each handler has to cope with every combination.

**The authoring boundary.** Creating and editing workflows means the router now
*sends* payloads upstream, so these also pin down what it forwards, what it
refuses to forward (engine-owned state like `active`), and the fact that
lifecycle and sandbox stay independent axes.
"""

from __future__ import annotations

import pytest

WORKFLOWS = [{"_id": "wf-1", "name": "Weekly Lease Renewals Due"}]
RUNS = [{"_id": "run-1", "status": "success"}]

PLAN = [{"idx": 0, "kind": "sql_query", "label": "Find leases", "narration": "…", "sql": "SELECT 1"}]


def draft(**overrides):
    """A minimally valid create payload."""
    return {
        "name": "Renewals due",
        "trigger_kind": "cron",
        "trigger_spec": {"expr": "0 9 * * 1", "tz": "Asia/Kolkata"},
        "trigger_intent": "Every Monday at 9 AM",
        "plan": PLAN,
        **overrides,
    }


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
        "/api/workflows/wf-1/versions",
    ],
)
def test_every_workflow_route_requires_authentication(api, fake, path):
    assert api.get(path, token=None).status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/workflows"),
        ("put", "/api/workflows/wf-1"),
        ("delete", "/api/workflows/wf-1"),
        ("post", "/api/workflows/wf-1/activate"),
        ("post", "/api/workflows/wf-1/pause"),
        ("post", "/api/workflows/wf-1/resume"),
        ("post", "/api/workflows/wf-1/run"),
        ("post", "/api/workflows/wf-1/versions/2/rollback"),
    ],
)
def test_no_workflow_can_be_changed_without_authentication(api, fake, method, path):
    """Auth is checked before the body is read, so an unauthenticated write
    never reaches InventDB at all."""
    resp = getattr(api, method)(path, json=draft(), token=None)
    assert resp.status_code == 401
    assert fake.calls == []


def test_a_data_key_holding_a_falsy_value_is_still_unwrapped(api, fake):
    """`_data` checks `"data" in payload`, not truthiness — so `{"data": 0}`
    unwraps to `0` rather than returning the envelope."""
    fake.on("GET", "/api/workflows/wf-1", {"ok": True, "data": 0})
    assert api.get("/api/workflows/wf-1").get_json() == 0


# ===========================================================================
# Creating
# ===========================================================================


def test_creating_forwards_the_definition_and_returns_the_saved_row(api, fake):
    fake.on("POST", "/api/workflows", {"ok": True, "data": {"_id": "wf-9", "name": "Renewals due"}}, status=201)

    resp = api.post("/api/workflows", json=draft())

    assert resp.status_code == 201
    assert resp.get_json() == {"_id": "wf-9", "name": "Renewals due"}
    sent = fake.last_call("POST", "/api/workflows").body
    assert sent["name"] == "Renewals due"
    assert sent["trigger_kind"] == "cron"
    assert sent["trigger_spec"] == {"expr": "0 9 * * 1", "tz": "Asia/Kolkata"}
    assert sent["plan"] == PLAN


def test_a_new_workflow_is_sandboxed_unless_the_author_says_otherwise(api, fake):
    """A workflow that emails owners should rehearse before it can reach
    anyone for real, so the safe value is the one you get by not choosing."""
    api.post("/api/workflows", json=draft())
    assert fake.last_call("POST", "/api/workflows").body["sandbox"] is True


def test_an_explicit_sandbox_choice_is_preserved(api, fake):
    api.post("/api/workflows", json=draft(sandbox=False))
    assert fake.last_call("POST", "/api/workflows").body["sandbox"] is False


def test_a_workflow_with_no_trigger_defaults_to_manual(api, fake):
    body = draft()
    del body["trigger_kind"]
    del body["trigger_spec"]

    api.post("/api/workflows", json=body)

    sent = fake.last_call("POST", "/api/workflows").body
    assert sent["trigger_kind"] == "manual"
    assert sent["trigger_spec"] == {}


@pytest.mark.parametrize(
    "field,value",
    [("active", True), ("pending_approval", False), ("version", 7), ("next_run_at", "2026-01-01T00:00:00Z")],
)
def test_engine_owned_state_cannot_be_set_by_the_caller(api, fake, field, value):
    """`active` and friends are the engine's to decide. Forwarding them would
    let the UI claim a workflow is live without the activation step ever
    happening."""
    api.post("/api/workflows", json=draft(**{field: value}))
    assert field not in fake.last_call("POST", "/api/workflows").body


@pytest.mark.parametrize(
    "body,message",
    [
        ({}, "name is required"),
        ({"name": "   ", "trigger_intent": "x", "plan": PLAN}, "name is required"),
        ({"name": "x", "plan": PLAN}, "trigger_intent is required"),
        ({"name": "x", "trigger_intent": "  ", "plan": PLAN}, "trigger_intent is required"),
        ({"name": "x", "trigger_intent": "y"}, "plan must contain at least one step"),
        ({"name": "x", "trigger_intent": "y", "plan": []}, "plan must contain at least one step"),
        ({"name": "x", "trigger_intent": "y", "plan": "nope"}, "plan must contain at least one step"),
        ({"name": "x", "trigger_intent": "y", "plan": ["nope"]}, "Every plan step must be an object"),
    ],
)
def test_an_unusable_draft_is_refused_before_it_reaches_inventdb(api, fake, body, message):
    resp = api.post("/api/workflows", json=body)

    assert resp.status_code == 400
    assert resp.get_json()["error"] == message
    assert fake.calls == []


def test_a_non_object_body_is_refused(api, fake):
    assert api.post("/api/workflows", json=["nope"]).status_code == 400
    assert fake.calls == []


def test_names_are_trimmed_before_being_saved(api, fake):
    api.post("/api/workflows", json=draft(name="  Renewals due  "))
    assert fake.last_call("POST", "/api/workflows").body["name"] == "Renewals due"


def test_a_rejected_plan_reports_which_step_is_wrong(api, fake):
    """InventDB names the offending step in `issues`; "plan validation failed"
    on its own would leave the editor with nothing to point at."""
    issues = [{"step_idx": 1, "severity": "error", "message": "unknown template_id"}]
    fake.on(
        "POST",
        "/api/workflows",
        {"ok": False, "error": "plan validation failed", "issues": issues},
        status=400,
    )

    resp = api.post("/api/workflows", json=draft())

    assert resp.status_code == 400
    body = resp.get_json()
    assert body["error"] == "plan validation failed"
    assert body["issues"] == issues


# ===========================================================================
# Editing
# ===========================================================================


def test_an_edit_forwards_only_the_fields_that_changed(api, fake):
    """The update is a partial — sending the whole row back would rewrite
    fields the user never touched."""
    fake.on("PUT", "/api/workflows/wf-1", {"ok": True, "data": {"_id": "wf-1", "name": "Renamed"}})

    resp = api.put("/api/workflows/wf-1", json={"name": "Renamed"})

    assert resp.get_json() == {"_id": "wf-1", "name": "Renamed"}
    assert fake.last_call("PUT", "/api/workflows/wf-1").body == {"name": "Renamed"}


def test_a_plan_can_be_replaced_wholesale(api, fake):
    api.put("/api/workflows/wf-1", json={"plan": PLAN})
    assert fake.last_call("PUT", "/api/workflows/wf-1").body == {"plan": PLAN}


def test_omitting_the_plan_leaves_the_saved_one_alone(api, fake):
    """Absent and empty are different: absent means "keep it"."""
    api.put("/api/workflows/wf-1", json={"trigger_intent": "Every Tuesday"})
    assert "plan" not in fake.last_call("PUT", "/api/workflows/wf-1").body


def test_an_edit_cannot_empty_the_plan(api, fake):
    resp = api.put("/api/workflows/wf-1", json={"plan": []})
    assert resp.status_code == 400
    assert fake.calls == []


def test_an_edit_cannot_blank_the_name(api, fake):
    resp = api.put("/api/workflows/wf-1", json={"name": "  "})
    assert resp.status_code == 400
    assert fake.calls == []


def test_changing_the_trigger_kind_is_not_an_edit(api, fake):
    """A plan is written against the payload its trigger produces, so swapping
    the trigger under it would leave a plan referring to variables that no
    longer exist. InventDB's update has no such field either."""
    api.put("/api/workflows/wf-1", json={"name": "Renamed", "trigger_kind": "manual"})
    assert "trigger_kind" not in fake.last_call("PUT", "/api/workflows/wf-1").body


def test_an_edit_that_changes_nothing_is_refused(api, fake):
    """An update with no editable field would still mint a version upstream."""
    resp = api.put("/api/workflows/wf-1", json={"active": True})
    assert resp.status_code == 400
    assert fake.calls == []


def test_deleting_forwards_to_the_soft_delete(api, fake):
    fake.on("DELETE", "/api/workflows/wf-1", {"ok": True, "data": {"deleted": "wf-1"}})

    resp = api.delete("/api/workflows/wf-1")

    assert resp.get_json() == {"deleted": "wf-1"}
    assert fake.last_call("DELETE", "/api/workflows/wf-1").path == "/api/workflows/wf-1"


# ===========================================================================
# Lifecycle — active/paused and sandbox are independent axes
# ===========================================================================


@pytest.mark.parametrize("action", ["activate", "pause", "resume"])
def test_lifecycle_actions_hit_their_own_endpoint(api, fake, action):
    fake.on("POST", f"/api/workflows/wf-1/{action}", {"ok": True, "data": {"_id": "wf-1"}})

    resp = api.post(f"/api/workflows/wf-1/{action}", json={})

    assert resp.get_json() == {"_id": "wf-1"}
    assert fake.calls[-1].path == f"/api/workflows/wf-1/{action}"


@pytest.mark.parametrize("action", ["pause", "resume"])
def test_pausing_and_resuming_never_touch_sandbox(api, fake, action):
    """Whether a workflow fires is a separate question from whether its side
    effects are real. Bundling them would silently un-mock a paused workflow on
    resume."""
    api.post(f"/api/workflows/wf-1/{action}", json={"sandbox": False})
    assert fake.calls[-1].body == {}


def test_activation_can_carry_the_final_sandbox_choice(api, fake):
    """Activate is the one click where both axes are decided at once, so the
    engine accepts the flag here to avoid a second round trip."""
    api.post("/api/workflows/wf-1/activate", json={"sandbox": False})
    assert fake.calls[-1].body == {"sandbox": False}


def test_activation_without_a_choice_leaves_sandbox_as_it_was(api, fake):
    api.post("/api/workflows/wf-1/activate", json={})
    assert fake.calls[-1].body == {}


def test_a_non_boolean_sandbox_flag_is_refused(api, fake):
    assert api.post("/api/workflows/wf-1/activate", json={"sandbox": "yes"}).status_code == 400
    assert fake.calls == []


# ===========================================================================
# Running
# ===========================================================================


def test_running_queues_the_workflow_and_reports_it_as_accepted(api, fake):
    """The engine queues an event rather than executing inline, so the honest
    answer is 202 — the run has not finished by the time this returns."""
    fake.on("POST", "/api/workflows/wf-1/run", {"ok": True, "data": {"event_id": "ev-1"}}, status=201)

    resp = api.post("/api/workflows/wf-1/run", json={})

    assert resp.status_code == 202
    assert resp.get_json() == {"event_id": "ev-1"}


def test_a_rehearsal_forces_side_effects_to_be_mocked_for_that_run_only(api, fake):
    api.post("/api/workflows/wf-1/run", json={"sandbox_override": True})
    assert fake.calls[-1].body == {"sandbox_override": True}


def test_running_an_earlier_version_names_it(api, fake):
    api.post("/api/workflows/wf-1/run", json={"version": 3})
    assert fake.calls[-1].body == {"version": 3}


@pytest.mark.parametrize("body", [{"version": "3"}, {"version": True}, {"sandbox_override": "yes"}])
def test_a_malformed_run_request_is_refused(api, fake, body):
    assert api.post("/api/workflows/wf-1/run", json=body).status_code == 400
    assert fake.calls == []


def test_running_with_no_body_at_all_still_works(api, fake):
    """"Run now" sends nothing; only the rehearsal path has options."""
    assert api.post("/api/workflows/wf-1/run").status_code == 202
    assert fake.calls[-1].body == {}


# ===========================================================================
# Versions
# ===========================================================================


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {"versions": [{"version": 2}]}},
        {"ok": True, "data": [{"version": 2}]},
        {"versions": [{"version": 2}]},
    ],
)
def test_version_history_is_normalised_like_every_other_collection(api, fake, upstream):
    fake.on("GET", "/api/workflows/wf-1/versions", upstream)
    assert api.get("/api/workflows/wf-1/versions").get_json() == {"versions": [{"version": 2}]}


def test_rolling_back_restores_an_earlier_definition(api, fake):
    fake.on(
        "POST",
        "/api/workflows/wf-1/versions/2/rollback",
        {"ok": True, "data": {"_id": "wf-1", "version": 5}},
    )

    resp = api.post("/api/workflows/wf-1/versions/2/rollback", json={})

    assert resp.get_json() == {"_id": "wf-1", "version": 5}


def test_a_non_numeric_version_is_not_a_route(api, fake):
    """`<int:version>` keeps a crafted segment out of the upstream URL."""
    assert api.post("/api/workflows/wf-1/versions/x/rollback", json={}).status_code == 404
    assert fake.calls == []
