"""Workflows — a proxy onto InventDB SOAR's workflow engine.

The automations themselves live in InventDB (``_System.Workflows``), which owns
the trigger scheduling, the step executor and the run history. This router is
the PMS's window onto that engine: it lists and reads workflows, and — the part
that makes the PMS a place to *work* rather than only watch — creates, edits,
deletes and fires them.

Workflows are instance-level, so a workflow authored here is the same record the
SOAR app's Operate room lists, and vice versa.

Two invariants shape the handlers:

* **Envelopes.** InventDB wraps some responses as ``{"ok": true, "data": …}``
  and returns others bare, and within ``data`` a collection may sit under a key
  or *be* the list. :func:`_data` and :func:`_collection` absorb every
  combination so the frontend sees one shape.
* **Validation belongs upstream.** InventDB type-checks a plan and rejects a bad
  one with 400 + ``issues`` naming the offending step. Re-implementing those
  rules here would only let the two drift, so the handlers check the shape they
  are about to send (an object, a non-empty plan) and let the engine judge the
  contents. The ``issues`` array rides back to the editor via ``ApiError.extra``.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..errors import ApiError

bp = Blueprint("workflows", __name__, url_prefix="/api/workflows")

# The fields a caller may set on create. Anything else InventDB owns —
# `active`, `pending_approval`, `version`, `next_run_at`, the timestamps — is
# engine state, and passing it through would let the UI claim a workflow is
# live without the activation step ever happening.
_CREATE_FIELDS = (
    "name",
    "trigger_kind",
    "trigger_spec",
    "trigger_intent",
    "plan",
    "tools_allowed",
    "budget",
    "sandbox",
)

# Update is a partial: only the keys present are touched. `trigger_kind` is
# absent by design — InventDB's update accepts no such field, and changing what
# fires a workflow would invalidate a plan written against the old trigger's
# payload. Re-create instead.
_UPDATE_FIELDS = (
    "name",
    "trigger_spec",
    "trigger_intent",
    "plan",
    "tools_allowed",
    "budget",
    "sandbox",
)


def _data(payload: Any) -> Any:
    """Unwrap InventDB's ``{ok, data}`` envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _collection(payload: Any, key: str) -> list[Any]:
    """Pull a named collection out of a response, whatever shape it arrived in.

    Always returns a list: the frontend maps over these directly, so ``null``
    would be a crash rather than an empty state.
    """
    data = _data(payload)
    items = data.get(key, data) if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


def _body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object body")
    return data


def _pick(body: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {k: body[k] for k in fields if k in body}


def _require_plan(payload: dict[str, Any]) -> None:
    """A workflow with no steps would activate and do nothing on every trigger.

    Only the shape is checked here; what the steps *say* is InventDB's call.
    """
    plan = payload.get("plan")
    if not isinstance(plan, list) or not plan:
        raise ApiError(400, "plan must contain at least one step")
    if any(not isinstance(step, dict) for step in plan):
        raise ApiError(400, "Every plan step must be an object")


# ===========================================================================
# Reading
# ===========================================================================


@bp.get("")
def list_workflows():
    return jsonify({"workflows": _collection(authed_client().list_workflows(), "workflows")})


@bp.get("/runs")
def list_runs():
    return jsonify({"runs": _collection(authed_client().list_runs(), "runs")})


@bp.get("/runs/<run_id>")
def get_run(run_id: str):
    return jsonify(_data(authed_client().get_run(run_id)))


@bp.get("/<workflow_id>")
def get_workflow(workflow_id: str):
    return jsonify(_data(authed_client().get_workflow(workflow_id)))


@bp.get("/<workflow_id>/runs")
def workflow_runs(workflow_id: str):
    return jsonify({"runs": _collection(authed_client().list_workflow_runs(workflow_id), "runs")})


@bp.get("/<workflow_id>/versions")
def workflow_versions(workflow_id: str):
    payload = authed_client().list_workflow_versions(workflow_id)
    return jsonify({"versions": _collection(payload, "versions")})


# ===========================================================================
# Authoring
# ===========================================================================


@bp.post("")
def create_workflow():
    body = _body()
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ApiError(400, "name is required")
    intent = body.get("trigger_intent")
    if not isinstance(intent, str) or not intent.strip():
        raise ApiError(400, "trigger_intent is required")

    payload = _pick(body, _CREATE_FIELDS)
    payload["name"] = name.strip()
    payload["trigger_intent"] = intent.strip()
    payload.setdefault("trigger_kind", "manual")
    payload.setdefault("trigger_spec", {})
    # Sandboxed unless the author says otherwise: a workflow that emails owners
    # should rehearse before it can reach anyone for real.
    payload.setdefault("sandbox", True)
    _require_plan(payload)

    return jsonify(_data(authed_client().create_workflow(payload))), 201


@bp.put("/<workflow_id>")
def update_workflow(workflow_id: str):
    body = _body()
    payload = _pick(body, _UPDATE_FIELDS)
    if not payload:
        raise ApiError(400, "No editable fields in the request body")
    if "name" in payload:
        name = payload["name"]
        if not isinstance(name, str) or not name.strip():
            raise ApiError(400, "name cannot be empty")
        payload["name"] = name.strip()
    # `plan` is optional on an update — omitting it keeps the saved one — but
    # sending an empty one is the same mistake as creating without steps.
    if "plan" in payload:
        _require_plan(payload)

    return jsonify(_data(authed_client().update_workflow(workflow_id, payload)))


@bp.delete("/<workflow_id>")
def delete_workflow(workflow_id: str):
    return jsonify(_data(authed_client().delete_workflow(workflow_id)))


# ===========================================================================
# Lifecycle
#
# Two independent axes, and conflating them is the easy mistake to make:
#   * active / paused — does it fire on its trigger at all?
#   * sandbox         — when it fires, are the side effects real or mocked?
# A workflow can be active *and* sandboxed, which is how one is iterated on
# safely against live data. So activate/pause/resume never touch `sandbox`;
# that flag is set through the ordinary update, or once at activation.
# ===========================================================================


@bp.post("/<workflow_id>/activate")
def activate_workflow(workflow_id: str):
    body = request.get_json(silent=True)
    sandbox = body.get("sandbox") if isinstance(body, dict) else None
    if sandbox is not None and not isinstance(sandbox, bool):
        raise ApiError(400, "sandbox must be true or false")
    return jsonify(_data(authed_client().activate_workflow(workflow_id, sandbox)))


@bp.post("/<workflow_id>/pause")
def pause_workflow(workflow_id: str):
    return jsonify(_data(authed_client().pause_workflow(workflow_id)))


@bp.post("/<workflow_id>/resume")
def resume_workflow(workflow_id: str):
    return jsonify(_data(authed_client().resume_workflow(workflow_id)))


@bp.post("/<workflow_id>/run")
def run_workflow(workflow_id: str):
    """Fire once, now.

    ``sandbox_override`` makes this single run mock its side effects regardless
    of the workflow's own setting — the rehearsal that comes before activating.
    """
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    payload: dict[str, Any] = {}
    override = body.get("sandbox_override")
    if override is not None:
        if not isinstance(override, bool):
            raise ApiError(400, "sandbox_override must be true or false")
        payload["sandbox_override"] = override
    if "sample_payload" in body:
        payload["sample_payload"] = body["sample_payload"]
    version = body.get("version")
    if version is not None:
        if isinstance(version, bool) or not isinstance(version, int):
            raise ApiError(400, "version must be an integer")
        payload["version"] = version

    return jsonify(_data(authed_client().run_workflow(workflow_id, payload))), 202


@bp.post("/<workflow_id>/versions/<int:version>/rollback")
def rollback_workflow(workflow_id: str, version: int):
    """Restore an earlier definition as a new latest version."""
    return jsonify(_data(authed_client().rollback_workflow(workflow_id, version)))
