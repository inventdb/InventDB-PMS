"""Workflows — read-only proxy to InventDB SOAR's workflow engine.

Surfaces the automations defined in InventDB (e.g. scheduled report emails) along
with their execution history, so the UI can render a run timeline and per-step
plan. Responses from InventDB are wrapped as ``{"ok": true, "data": {...}}``;
these handlers unwrap the useful payload for the frontend.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify

from ..context import authed_client

bp = Blueprint("workflows", __name__, url_prefix="/api/workflows")


def _data(payload: Any) -> Any:
    """Unwrap InventDB's ``{ok, data}`` envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


@bp.get("")
def list_workflows():
    data = _data(authed_client().list_workflows())
    workflows = data.get("workflows", data) if isinstance(data, dict) else data
    return jsonify({"workflows": workflows or []})


@bp.get("/runs")
def list_runs():
    data = _data(authed_client().list_runs())
    runs = data.get("runs", data) if isinstance(data, dict) else data
    return jsonify({"runs": runs or []})


@bp.get("/runs/<run_id>")
def get_run(run_id: str):
    return jsonify(_data(authed_client().get_run(run_id)))


@bp.get("/<workflow_id>")
def get_workflow(workflow_id: str):
    return jsonify(_data(authed_client().get_workflow(workflow_id)))


@bp.get("/<workflow_id>/runs")
def workflow_runs(workflow_id: str):
    data = _data(authed_client().list_workflow_runs(workflow_id))
    runs = data.get("runs", data) if isinstance(data, dict) else data
    return jsonify({"runs": runs or []})
