"""Analyze — the AI canvas, ported from InventDB SOAR's Analyze room.

InventDB owns the agent: the model, the tool loop, the SQL it writes, and the
row-level security that decides what any of it can see. This blueprint is the
thin, allow-listed seam that lets the PMS frontend reach that agent with the
signed-in user's own bearer token, exactly as SOAR does — nothing here decides
what the assistant may do.

Every route is a deliberate forward of one InventDB endpoint the Analyze room
needs. There is no catch-all proxy on purpose: the set below *is* the feature's
blast radius, and adding to it is a visible decision.

  chat/stream            POST    the streaming agent turn (SSE, passed through)
  config, models         GET     the workspace default + enabled model catalog
  threads                GET/PUT per-user thread history (InventDB stores it)
  threads/<id>           DELETE
  websearch/status       GET     the persisted web-search gate
  websearch/enable|…     POST
  sql                    POST    read-only SELECT, for the UI's own follow-ups
  change-set/apply       POST    atomic apply of a proposed record change-set
  records/<type>         POST/PUT/DELETE — single-record mutation-card applies
  uploads/stage          POST    ephemeral LLM input (30-min TTL, no DB write)
  uploads/<id>           DELETE
  gmail/*, calendar/*    POST    the action cards' send/save, user-initiated
  saved-views/<id>       GET
"""

from __future__ import annotations

import re
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context

from ..context import authed_client
from ..errors import ApiError

bp = Blueprint("analyze", __name__, url_prefix="/api/analyze")

# The agent's own queries run server-side inside InventDB and come back on the
# stream already executed. This endpoint exists for the *interface's* queries —
# resolving a result row to its record, learning a type's columns to offer
# follow-up chips, re-running a saved view. All of those read. Writes have their
# own reviewed routes (change-set / records), so anything but a SELECT here is a
# bug or an abuse, and is refused either way.
_READ_ONLY_RE = re.compile(r"^\s*(?:select|with)\b", re.IGNORECASE)
_MAX_SQL_LEN = 20_000
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# Types whose names start with an underscore are InventDB's own system tables
# (`_System.ReportTemplates`, the thread store, …). The mutation cards target
# business records; a proposal aimed at a system table is refused rather than
# quietly applied.
_TYPE_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*")


def _body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object body")
    return data


def _business_type(type_name: str) -> str:
    if not _TYPE_RE.fullmatch(type_name or ""):
        raise ApiError(400, f"Invalid type: {type_name!r}")
    return type_name


def _unwrap(payload: Any) -> Any:
    """Peel InventDB's ``{"ok": true, "data": …}`` success envelope."""
    if isinstance(payload, dict) and "data" in payload and payload.get("ok") is True:
        return payload["data"]
    return payload


# --------------------------------------------------------------- the agent


@bp.post("/chat/stream")
def chat_stream():
    """Stream one agent turn straight through to the browser as SSE.

    The response is forwarded chunk-by-chunk with no buffering and no parsing:
    the frontend understands InventDB's ``AgentStep`` frames natively, and
    re-assembling them here would only add latency to a surface whose whole
    point is watching the work happen. Sending ``messages`` verbatim is what
    makes follow-ups keep their context.
    """
    # Authentication first, always: an unauthenticated caller should learn
    # nothing about what a well-formed body looks like. Every handler below
    # follows the same order.
    client = authed_client()
    body = _body()
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ApiError(400, "messages must be a non-empty array")

    payload: dict[str, Any] = {
        "messages": messages,
        # The namespace this app's data lives in — the agent reasons over it
        # rather than the whole instance. Not client-supplied: a PMS user asking
        # a question should never be able to steer the agent at another tenant's
        # namespace, so the server pins it.
        "namespace": client.namespace,
        "stream": True,
        "conversation_mode": body.get("conversation_mode", True),
    }
    for key in ("time_zone", "model_family", "focusedReportId"):
        value = body.get(key)
        if value:
            payload[key] = value

    upstream = client.stream_chat(payload)

    # A failure before the stream opens is an ordinary JSON error, not an empty
    # SSE stream the UI would render as a turn that silently did nothing.
    if upstream.status_code >= 400:
        try:
            detail = upstream.json()
            detail = detail.get("error") or detail.get("detail") or detail
        except ValueError:
            detail = upstream.text or f"InventDB returned {upstream.status_code}"
        finally:
            upstream.close()
        raise ApiError(upstream.status_code, detail)

    def relay():
        try:
            for chunk in upstream.iter_content(chunk_size=None):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(
        stream_with_context(relay()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Tells nginx (and friends) not to buffer, which would otherwise
            # hold the whole turn back and deliver it in one lump at the end.
            # `Connection: keep-alive` is deliberately NOT set: it is a
            # hop-by-hop header, which WSGI forbids the application from
            # sending, and waitress rejects the response outright if it is.
            "X-Accel-Buffering": "no",
        },
    )


@bp.get("/config")
def ai_config():
    """The workspace's default model. The API key/base URL are not forwarded."""
    data = _unwrap(authed_client().ai_config()) or {}
    if not isinstance(data, dict):
        data = {}
    return jsonify(
        {
            "configured": bool(data.get("configured")),
            "model": data.get("model"),
            "modelFamily": data.get("modelFamily"),
        }
    )


@bp.get("/models")
def ai_models():
    data = _unwrap(authed_client().ai_models())
    return jsonify({"models": data if isinstance(data, list) else []})


# ------------------------------------------------------------------ threads


@bp.get("/threads")
def list_threads():
    data = _unwrap(authed_client().list_threads())
    threads = data.get("threads", []) if isinstance(data, dict) else data
    return jsonify({"threads": threads or []})


@bp.put("/threads")
def save_thread():
    client = authed_client()
    body = _body()
    thread_id = str(body.get("id") or "").strip()
    if not thread_id:
        raise ApiError(400, "id is required")
    exchanges = body.get("exchanges")
    if not isinstance(exchanges, list):
        raise ApiError(400, "exchanges must be an array")
    # InventDB stamps user_id from the JWT and enforces ownership, so there is
    # nothing to check here beyond the shape.
    payload = {
        "id": thread_id,
        "label": str(body.get("label") or "Chat")[:80],
        "created": body.get("created") or "",
        "exchanges": exchanges,
    }
    return jsonify(_unwrap(client.save_thread(payload)) or {"ok": True})


@bp.delete("/threads/<thread_id>")
def delete_thread(thread_id: str):
    authed_client().delete_thread(thread_id)
    return jsonify({"ok": True, "id": thread_id})


# ---------------------------------------------------------------- web search


@bp.get("/websearch/status")
def websearch_status():
    data = _unwrap(authed_client().websearch_status()) or {}
    if not isinstance(data, dict):
        data = {}
    return jsonify(
        {"enabled": bool(data.get("enabled")), "consented": bool(data.get("consented"))}
    )


@bp.post("/websearch/<action>")
def websearch_set(action: str):
    if action not in ("enable", "disable"):
        raise ApiError(404, f"Unknown web-search action: {action}")
    authed_client().websearch_set(action == "enable")
    return jsonify({"ok": True, "enabled": action == "enable"})


# ----------------------------------------------------------------- read SQL


@bp.post("/sql")
def run_sql():
    client = authed_client()
    statement = (_body().get("sql") or "").strip()
    if not statement:
        raise ApiError(400, "sql is required")
    if len(statement) > _MAX_SQL_LEN:
        raise ApiError(400, "Query is too long")
    # Strip one trailing semicolon, then refuse any that remain: a second
    # statement after a legitimate SELECT is the classic way to smuggle a write
    # past a prefix check.
    trimmed = statement.rstrip().rstrip(";").rstrip()
    if ";" in trimmed:
        raise ApiError(400, "Only a single statement is allowed")
    if not _READ_ONLY_RE.match(trimmed):
        raise ApiError(403, "Only SELECT queries are allowed here")
    result = client.sql(trimmed)
    return jsonify({"rows": result.get("rows", []), "metrics": result.get("metrics", {})})


# ---------------------------------------------------- record-change proposals


@bp.post("/change-set/apply")
def apply_change_set():
    """Apply a proposed change-set atomically (all of it lands, or none).

    Reached only from a mutation card the user has reviewed and clicked Apply
    on — the agent never applies its own proposals. Each step's namespace is
    forced to this app's, so a proposal cannot reach outside it however it was
    authored.
    """
    client = authed_client()
    body = _body()
    steps = body.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ApiError(400, "steps must be a non-empty array")

    safe_steps: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            raise ApiError(400, "Each step must be an object")
        op = str(step.get("op") or "insert").lower()
        if op not in ("insert", "update", "delete", "attach"):
            raise ApiError(400, f"Unsupported operation: {op}")
        safe = dict(step)
        safe["op"] = op
        safe["namespace"] = client.namespace
        safe["typeName"] = _business_type(str(step.get("typeName") or ""))
        safe_steps.append(safe)

    result = client.apply_change_set(str(body.get("title") or "Proposed changes"), safe_steps)
    data = _unwrap(result) or {}
    if not isinstance(data, dict):
        data = {}
    return jsonify({"ok": True, "results": data.get("results", [])})


@bp.post("/records/<type_name>")
def create_record(type_name: str):
    client = authed_client()
    t = _business_type(type_name)
    data = {k: v for k, v in _body().items() if not k.startswith("_")}
    result = client.create_record(t, data)
    record_id = result.get("id") if isinstance(result, dict) else None
    return jsonify({"ok": True, "recordId": record_id, "type": t}), 201


@bp.put("/records/<type_name>/<record_id>")
def update_record(type_name: str, record_id: str):
    client = authed_client()
    t = _business_type(type_name)
    # Merge over the stored document so fields the card didn't show survive a
    # save, whether InventDB's PUT replaces or merges.
    merged: dict[str, Any] = {}
    try:
        existing = client.get_record(t, record_id)
        if isinstance(existing, dict):
            merged = {k: v for k, v in existing.items() if not k.startswith("_")}
    except ApiError:
        pass
    merged.update({k: v for k, v in _body().items() if not k.startswith("_")})
    merged["_id"] = record_id
    client.update_record(t, merged)
    return jsonify({"ok": True, "recordId": record_id, "type": t})


@bp.delete("/records/<type_name>/<record_id>")
def delete_record(type_name: str, record_id: str):
    client = authed_client()
    t = _business_type(type_name)
    client.delete_record(t, record_id)
    return jsonify({"ok": True, "recordId": record_id, "type": t})


@bp.get("/records/<type_name>/<record_id>")
def get_record(type_name: str, record_id: str):
    client = authed_client()
    t = _business_type(type_name)
    return jsonify(client.get_record(t, record_id))


# --------------------------------------------------------- staged AI inputs


@bp.post("/uploads/stage")
def stage_upload():
    """Stage a pasted/attached file as an ephemeral input for the next message.

    These are LLM inputs, not record attachments: InventDB holds the bytes for
    30 minutes, indexes nothing, and writes no row. The composer references the
    returned id in a ``[attached: … — pending: <id>]`` marker on the message.
    """
    client = authed_client()
    upload = request.files.get("file")
    if upload is None:
        raise ApiError(400, "A file part named 'file' is required")
    content = upload.read()
    if not content:
        raise ApiError(400, "The uploaded file is empty")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise ApiError(413, "File is larger than the 25 MB limit")
    data = _unwrap(
        client.stage_upload(
            upload.filename or "upload",
            content,
            upload.mimetype or "application/octet-stream",
        )
    )
    return jsonify(data if isinstance(data, dict) else {"ok": True})


@bp.delete("/uploads/<pending_id>")
def unstage_upload(pending_id: str):
    authed_client().unstage_upload(pending_id)
    return jsonify({"ok": True})


# ------------------------------------------------------------- action cards


@bp.post("/gmail/send")
def gmail_send():
    client = authed_client()
    body = _body()
    if not str(body.get("to") or "").strip():
        raise ApiError(400, "A recipient is required")
    return jsonify(_unwrap(client.send_email(body)) or {"ok": True})


@bp.post("/gmail/bulk-send")
def gmail_bulk_send():
    client = authed_client()
    emails = _body().get("emails")
    if not isinstance(emails, list) or not emails:
        raise ApiError(400, "emails must be a non-empty array")
    data = _unwrap(client.bulk_send_email(emails)) or {}
    return jsonify(data if isinstance(data, dict) else {"ok": True})


@bp.post("/calendar/events")
def calendar_event():
    client = authed_client()
    body = _body()
    if not str(body.get("summary") or "").strip():
        raise ApiError(400, "An event title is required")
    return jsonify(_unwrap(client.create_event(body)) or {"ok": True})


@bp.post("/calendar/bulk-events")
def calendar_bulk_events():
    client = authed_client()
    events = _body().get("events")
    if not isinstance(events, list) or not events:
        raise ApiError(400, "events must be a non-empty array")
    data = _unwrap(client.bulk_create_events(events)) or {}
    return jsonify(data if isinstance(data, dict) else {"ok": True})


@bp.get("/saved-views/<view_id>")
def saved_view(view_id: str):
    return jsonify(authed_client().get_saved_view(view_id))
