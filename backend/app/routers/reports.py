"""Reporting endpoints.

Two families live here.

``/templates/*`` is the real thing: a thin proxy onto **InventDB's saved report
templates** — the same reports the SOAR app's Report room lists, stored in
``_System.ReportTemplates`` and rendered by InventDB's own report engine. The
PMS neither defines nor computes these; it lists them, collects their
parameters, and asks InventDB to render. Authoring happens in SOAR.

The remaining endpoints are PMS-specific SQL rollups (P&L, rent roll, renewals
…), each computed by a query executed *inside* InventDB rather than aggregated
in Python. They are no longer surfaced by the Reports page — which now shows
the SOAR reports — but are left in place as a working API.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from flask import Blueprint, Response, jsonify, request, stream_with_context

from ..context import authed_client
from ..errors import ApiError
from ..inventdb import InventDBClient, _safe_ident
from ..sqlutil import sql_literal

bp = Blueprint("reports", __name__, url_prefix="/api/reports")

NS = "pms"


def _rows(client: InventDBClient, sql: str) -> list[dict[str, Any]]:
    return client.query_rows(sql)


def _num(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


_ACRONYMS = {"Hoa": "HOA", "Hvac": "HVAC", "Ach": "ACH", "Coi": "COI", "Co": "CO"}


def _title(v: Any) -> str:
    """Title-case a value (InventDB lowercases GROUP BY string values)."""
    s = str(v).strip() if v is not None else ""
    if not s:
        return "Other"
    return " ".join(_ACRONYMS.get(w, w) for w in s.title().split(" "))


def _distribution(rows: list[dict[str, Any]], dim: str, num: bool = False):
    """Map grouped rows -> [{name, value}], reading the dimension by its real
    column name (InventDB ignores AS aliases on grouped columns)."""
    out = []
    for r in rows:
        name = _title(r.get(dim))
        value = _num(r.get("value")) if num else int(r.get("value") or 0)
        out.append({"name": name, "value": value})
    return out


# ===========================================================================
# InventDB SOAR saved reports
# ===========================================================================

_LABEL_FIELDS = ("name", "title", "first_name", "label", "description")


def _pick_bind_field(sample: dict[str, Any] | None) -> str | None:
    """Choose the column a source-backed parameter should bind to.

    Mirrors the SOAR Report room. A template's SQL filters on a *business* key
    (``WHERE owner_id = :owner_id``), so binding InventDB's internal ``_id``
    GUID matches nothing and the report renders empty. Prefer the first
    non-internal ``*_id`` column that actually carries a value; only fall back
    to ``_id`` when the type has no business key at all.
    """
    if not sample:
        return None
    for key, value in sample.items():
        if key in ("_id", "id") or key.startswith("_"):
            continue
        if not key.lower().endswith("_id"):
            continue
        if isinstance(value, (int, float)) or (isinstance(value, str) and value):
            return key
    return None


def _param_options(client: InventDBClient, param: dict[str, Any]) -> list[dict[str, str]]:
    """Resolve the dropdown choices for a parameter that declares a `source`.

    The source names an InventDB type (``pms.owners``). It comes from a stored
    template rather than the request, but it is still interpolated into SQL, so
    each half is validated as an identifier before use.
    """
    source = str(param.get("source") or "").strip()
    if not source:
        return []
    parts = source.split(".")
    if len(parts) != 2:
        return []
    ns, type_name = (_safe_ident(parts[0], "namespace"), _safe_ident(parts[1], "type"))

    rows = client.query_rows(f"SELECT * FROM {ns}.{type_name} LIMIT 200")
    if not rows:
        return []

    bind = str(param.get("bindField") or "") or _pick_bind_field(rows[0]) or "_id"
    options: list[dict[str, str]] = []
    for row in rows:
        value = row.get(bind) if bind in row else row.get("_id")
        if value in (None, ""):
            continue
        label = next(
            (str(row[f]) for f in _LABEL_FIELDS if row.get(f) not in (None, "")),
            str(value),
        )
        options.append({"value": str(value), "label": label})
    return options


@bp.get("/templates")
def list_report_templates():
    """The saved reports defined in InventDB SOAR."""
    client = authed_client()
    data = client.list_report_templates() or {}
    templates = data.get("templates") or []
    out = [
        {
            "id": t.get("_id"),
            "name": t.get("name") or "(untitled report)",
            "description": t.get("description") or "",
            "category": t.get("category") or "",
            "mode": t.get("mode") or "",
            "version": t.get("version"),
            "created_by": t.get("createdBy") or "",
        }
        for t in templates
        if t.get("_id")
    ]
    out.sort(key=lambda t: (t["category"].lower(), t["name"].lower()))
    return jsonify({"templates": out, "count": len(out)})


@bp.get("/templates/<template_id>")
def get_report_template(template_id: str):
    """A single report's definition, with its parameter pickers pre-resolved.

    The `html` body is deliberately dropped — it is the template source, can
    run to tens of kilobytes, and the client only ever displays the *rendered*
    output.
    """
    client = authed_client()
    doc = client.get_report_template(template_id) or {}
    params = doc.get("parameters") or []

    resolved = []
    for p in params:
        if not isinstance(p, dict):
            continue
        resolved.append(
            {
                "name": p.get("name"),
                "label": p.get("label") or p.get("name"),
                "type": p.get("type") or "text",
                "required": bool(p.get("required", True)),
                "default": p.get("default"),
                "options": [],
                "_source": p,
            }
        )

    # Each source-backed picker costs its own SQL round trip, and the report
    # cannot start rendering until they all land — so resolve them
    # concurrently rather than one after another. A report with four pickers
    # went from four sequential round trips to one wall-clock round trip.
    sourced = [e for e in resolved if e["_source"].get("source")]
    if sourced:
        with ThreadPoolExecutor(max_workers=min(8, len(sourced))) as pool:
            futures = {
                pool.submit(_param_options, client, e["_source"]): e for e in sourced
            }
            for future in as_completed(futures):
                entry = futures[future]
                try:
                    entry["options"] = future.result()
                except ApiError:
                    # A bad `source` on one parameter must not take down the
                    # whole report — the field degrades to a free-text input.
                    entry["options"] = []

    for entry in resolved:
        entry.pop("_source", None)

    return jsonify(
        {
            "id": doc.get("_id") or template_id,
            "name": doc.get("name") or "(untitled report)",
            "description": doc.get("description") or "",
            "category": doc.get("category") or "",
            "mode": doc.get("mode") or "",
            "version": doc.get("version"),
            "parameters": resolved,
        }
    )


@bp.post("/templates/<template_id>/render")
def render_report_template(template_id: str):
    """Render a saved report against live data. Returns InventDB's HTML."""
    body = request.get_json(silent=True)
    params = body.get("params") if isinstance(body, dict) else None
    if params is not None and not isinstance(params, dict):
        raise ApiError(400, "params must be an object")

    client = authed_client()
    result = client.render_report_template(template_id, params or {}) or {}
    return jsonify({"html": result.get("html") or "", "meta": result.get("meta") or {}})


# ===========================================================================
# Authoring — the Report Studio surface, as SOAR has it
# ===========================================================================
# A saved report is not read-only here. It can be renamed, described, edited by
# instruction, deleted; and a frozen AI snapshot can be promoted into a live
# template. InventDB owns all of it — the report agent writes the layout, the
# engine versions it — so these routes are the same allow-listed seam the
# Analyze room uses, not a second implementation of report authoring.

# Fields the studio is allowed to change directly. The `html` body is
# deliberately not among them: layout changes go through the report agent
# (`/edit/stream`), which validates the markup and versions the result. Letting
# a client PUT arbitrary HTML would bypass both.
_EDITABLE_TEMPLATE_FIELDS = ("name", "description", "category")


@bp.put("/templates/<template_id>")
def update_report_template(template_id: str):
    """Rename a report, or change its description/category."""
    client = authed_client()
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Expected a JSON object body")

    patch = {k: body[k] for k in _EDITABLE_TEMPLATE_FIELDS if k in body}
    if not patch:
        raise ApiError(
            400, f"Nothing to update — expected one of: {', '.join(_EDITABLE_TEMPLATE_FIELDS)}"
        )
    if "name" in patch:
        name = str(patch["name"] or "").strip()
        if not name:
            raise ApiError(400, "A report needs a name")
        patch["name"] = name[:200]

    client.update_report_template(template_id, patch)
    return jsonify({"ok": True, "id": template_id, **patch})


@bp.delete("/templates/<template_id>")
def delete_report_template(template_id: str):
    authed_client().delete_report_template(template_id)
    return jsonify({"ok": True, "id": template_id})


@bp.post("/templates/<template_id>/edit/stream")
def edit_report_template(template_id: str):
    """Edit a report by describing the change, streamed as it happens.

    Relayed rather than awaited: the report agent emits `reasoning` while it
    thinks, then `html`, then `saved` with the new version number. Buffering
    would turn a visible edit into a blank wait, and the events are what tell
    the studio when to re-render.

    The endpoint saves the new version itself, which is why nothing here writes
    back — a `saved` event means the template has already changed.
    """
    client = authed_client()
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Expected a JSON object body")
    instruction = str(body.get("instruction") or "").strip()
    if not instruction:
        raise ApiError(400, "Describe the change you want")

    payload: dict[str, Any] = {
        "instruction": instruction,
        # Prior instructions for THIS report, so a follow-up ("now drop the
        # decimals too", "undo that") builds on the last one instead of
        # starting over.
        "messages": body.get("messages") if isinstance(body.get("messages"), list) else [],
        "conversation_mode": True,
    }
    if body.get("model_family"):
        payload["model_family"] = body["model_family"]

    upstream = client.stream_report_layout_edit(template_id, payload)

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
        # No `Connection` header: it is hop-by-hop, which WSGI forbids the
        # application from sending and waitress rejects outright.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------- snapshots
# A snapshot is a report the assistant rendered once and stored as an HTML
# attachment on `_System.AIReports`. Its figures are frozen — unlike a template,
# it does not re-query — so the studio shows both but says which is which.

_SNAPSHOT_NS = "_System"
_SNAPSHOT_TYPE = "AIReports"

_SNAPSHOT_SQL = (
    "SELECT _id, record_id, filename, description, content_type, tags, created_at "
    "FROM _System._attachments WHERE record_type = 'AIReports' "
    "ORDER BY created_at DESC LIMIT 500"
)


def _snapshot_name(description: Any, filename: Any) -> str:
    """Recover the report's title from what the agent wrote on the attachment.

    It stores one of two forms — ``AI-generated report: <Title> (<when>)`` or
    ``Report rendered from template '<Title>' (<when>)`` — and falls back to the
    filename, which is the title slugified with a timestamp appended.
    """
    text = str(description or "").strip()
    match = re.search(r"template ['\"]([^'\"]+)['\"]", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"report:\s*(.+?)\s*\([^)]*\)\s*$", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    if text:
        return re.sub(r"\s*\([^)]*\)\s*$", "", text).strip()
    name = re.sub(
        r"_\d{8}_\d{6}(?:\.source)?\.html$", "", str(filename or "Report"), flags=re.IGNORECASE
    )
    return name.replace("_", " ").strip() or "Report"


def _tags_of(row: dict[str, Any]) -> list[str]:
    tags = row.get("tags")
    if isinstance(tags, list):
        return [str(t) for t in tags]
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    return []


@bp.get("/snapshots")
def list_report_snapshots():
    """Every stored AI snapshot, newest first.

    Only the rendered report is listed. Each one has a sibling `.source.html`
    tagged `ai-report-source` — the regeneratable source that promotion reads —
    which is machinery, not a second report.
    """
    client = authed_client()
    out = []
    for row in client.query_rows(_SNAPSHOT_SQL):
        tags = _tags_of(row)
        if "ai-report" not in tags:
            continue
        if "html" not in str(row.get("content_type") or "").lower():
            continue
        record_id = str(row.get("record_id") or "")
        attachment_id = str(row.get("_id") or "")
        if not record_id or not attachment_id:
            continue
        out.append(
            {
                "record_id": record_id,
                "attachment_id": attachment_id,
                "name": _snapshot_name(row.get("description"), row.get("filename")),
                "created_at": row.get("created_at"),
                # Rendered from a saved template, rather than authored one-off.
                "from_template": "template-rendered" in tags,
            }
        )
    return jsonify({"snapshots": out, "count": len(out)})


@bp.get("/snapshots/<record_id>/<attachment_id>")
def get_report_snapshot(record_id: str, attachment_id: str):
    """The stored HTML of one snapshot.

    Proxied rather than linked: the attachment endpoint needs the bearer token,
    which a plain `<a href>` cannot carry.
    """
    html = authed_client().attachment_text(
        _SNAPSHOT_NS, _SNAPSHOT_TYPE, record_id, attachment_id
    )
    return jsonify({"html": html})


@bp.delete("/snapshots/<record_id>")
def delete_report_snapshot(record_id: str):
    """Delete a snapshot — both the rendered HTML and its `.source.html`.

    They are one report in two files; leaving the source behind would orphan it
    where nothing in the UI can reach it.
    """
    client = authed_client()
    rows = client.query_rows(
        f"SELECT _id FROM _System._attachments WHERE record_id = {sql_literal(record_id)}"
    )
    deleted = 0
    for row in rows:
        attachment_id = str(row.get("_id") or "")
        if not attachment_id:
            continue
        try:
            client.delete_attachment(
                _SNAPSHOT_NS, _SNAPSHOT_TYPE, record_id, attachment_id
            )
            deleted += 1
        except ApiError:
            # One stubborn attachment should not abandon the rest.
            continue
    return jsonify({"ok": True, "record_id": record_id, "deleted": deleted})


@bp.post("/snapshots/<record_id>/<attachment_id>/promote")
def promote_report_snapshot(record_id: str, attachment_id: str):
    """Turn a frozen snapshot into a live template that re-queries on render."""
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip() or "Report"
    result = authed_client().promote_report_snapshot(record_id, attachment_id, name)
    template_id = None
    if isinstance(result, dict):
        template_id = result.get("id") or result.get("_id")
    return jsonify({"ok": True, "id": template_id})


# ===========================================================================
# PMS SQL rollups (retained API; not surfaced by the Reports page)
# ===========================================================================


@bp.get("/pnl")
def profit_and_loss():
    """Income vs. expense totals and category breakdowns (all computed in SQL)."""
    client = authed_client()
    by_type = _rows(
        client,
        f"SELECT type, SUM(amount) AS total, COUNT(*) AS n "
        f"FROM {NS}.transactions GROUP BY type",
    )
    income = expense = 0.0
    for r in by_type:
        if str(r.get("type", "")).lower() == "income":
            income = _num(r.get("total"))
        elif str(r.get("type", "")).lower() == "expense":
            expense = _num(r.get("total"))

    income_by_cat = _rows(
        client,
        f"SELECT account_category, SUM(amount) AS value "
        f"FROM {NS}.transactions WHERE lower(type) = 'income' "
        f"GROUP BY account_category ORDER BY value DESC",
    )
    expense_by_cat = _rows(
        client,
        f"SELECT account_category, SUM(amount) AS value "
        f"FROM {NS}.transactions WHERE lower(type) = 'expense' "
        f"GROUP BY account_category ORDER BY value DESC",
    )
    return jsonify(
        {
            "income_total": income,
            "expense_total": expense,
            "net_total": round(income - expense, 2),
            "income_by_category": _distribution(income_by_cat, "account_category", num=True),
            "expense_by_category": _distribution(expense_by_cat, "account_category", num=True),
        }
    )


@bp.get("/cashflow")
def cashflow():
    """Monthly income/expense using SQL YEAR()/MONTH() grouping."""
    client = authed_client()
    rows = _rows(
        client,
        f"SELECT YEAR(date) AS y, MONTH(date) AS m, type, SUM(amount) AS total "
        f"FROM {NS}.transactions GROUP BY y, m, type",
    )
    buckets: dict[str, dict[str, float]] = {}
    for r in rows:
        try:
            y = int(r.get("y"))
            m = int(r.get("m"))
        except (TypeError, ValueError):
            continue
        key = f"{y:04d}-{m:02d}"
        b = buckets.setdefault(key, {"income": 0.0, "expense": 0.0})
        kind = str(r.get("type", "")).lower()
        if kind in ("income", "expense"):
            b[kind] += _num(r.get("total"))

    months = sorted(buckets.keys())[-12:]
    series = [
        {
            "month": mk,
            "income": round(buckets[mk]["income"], 2),
            "expense": round(buckets[mk]["expense"], 2),
            "net": round(buckets[mk]["income"] - buckets[mk]["expense"], 2),
        }
        for mk in months
    ]
    return jsonify({"cashflow": series})


@bp.get("/rent-roll")
def rent_roll():
    """Active leases joined to their property (SQL JOIN)."""
    client = authed_client()
    rows = _rows(
        client,
        "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, "
        "l.property_id AS property_id, p.city AS city, p.state AS state, "
        "l.contract_rent AS contract_rent, l.market_rent AS market_rent, "
        "l.lease_start AS lease_start, l.lease_end AS lease_end, l.status AS status "
        f"FROM {NS}.leases l JOIN {NS}.properties p "
        "ON l.property_id = p.property_id "
        "WHERE lower(l.status) = 'active' "
        "ORDER BY l.contract_rent DESC",
    )
    total = round(sum(_num(r.get("contract_rent")) for r in rows), 2)
    return jsonify({"rows": rows, "count": len(rows), "monthly_total": total})


@bp.get("/renewals")
def renewals():
    """Lease Renewals Due — leases ending within N days (default 90).

    Mirrors the InventDB saved report used by the 'Weekly Lease Renewals Due'
    workflow.
    """
    client = authed_client()
    try:
        days = max(1, min(int(request.args.get("days", 90)), 365))
    except (TypeError, ValueError):
        days = 90
    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=days)
    rows = _rows(
        client,
        "SELECT l.lease_id AS lease_id, l.tenant_name AS tenant_name, "
        "l.property_id AS property_id, p.city AS city, "
        "l.lease_end AS lease_end, l.contract_rent AS contract_rent, "
        "l.market_rent AS market_rent, l.renewal_type AS renewal_type "
        f"FROM {NS}.leases l JOIN {NS}.properties p "
        "ON l.property_id = p.property_id "
        f"WHERE l.lease_end >= '{today.isoformat()}' "
        f"AND l.lease_end <= '{end.isoformat()}' "
        "ORDER BY l.lease_end ASC",
    )
    for r in rows:
        delta = _num(r.get("market_rent")) - _num(r.get("contract_rent"))
        r["rent_gap"] = round(delta, 2)
    return jsonify({"rows": rows, "count": len(rows), "days": days})


@bp.get("/occupancy")
def occupancy():
    """Property status distribution (SQL GROUP BY)."""
    client = authed_client()
    rows = _rows(
        client,
        f"SELECT status, COUNT(*) AS value FROM {NS}.properties "
        "GROUP BY status ORDER BY value DESC",
    )
    total = sum(int(r.get("value") or 0) for r in rows)
    occupied = sum(
        int(r.get("value") or 0)
        for r in rows
        if str(r.get("status", "")).lower() == "occupied"
    )
    return jsonify(
        {
            "distribution": _distribution(rows, "status"),
            "total": total,
            "occupied": occupied,
            "occupancy_rate": round((occupied / total) * 100, 1) if total else 0.0,
        }
    )


@bp.get("/work-orders")
def work_orders_report():
    """Work order pipeline by status & priority, plus open cost estimate (SQL)."""
    client = authed_client()
    by_status = _rows(
        client,
        f"SELECT status, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY status ORDER BY value DESC",
    )
    by_priority = _rows(
        client,
        f"SELECT priority, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY priority ORDER BY value DESC",
    )
    by_category = _rows(
        client,
        f"SELECT category, COUNT(*) AS value FROM {NS}.work_orders "
        "GROUP BY category ORDER BY value DESC",
    )
    open_cost = _rows(
        client,
        f"SELECT SUM(est_cost) AS total FROM {NS}.work_orders "
        "WHERE lower(status) != 'completed'",
    )
    return jsonify(
        {
            "by_status": _distribution(by_status, "status"),
            "by_priority": _distribution(by_priority, "priority"),
            "by_category": _distribution(by_category, "category"),
            "open_cost_estimate": _num(open_cost[0].get("total")) if open_cost else 0.0,
        }
    )


# ===========================================================================
# Dashboard widgets — the "describe a mini-report" surface
# ===========================================================================
# A dashboard widget of kind `report` is a report-engine template like any
# other; what differs is that it is authored by description, is compact, and may
# read several types rather than one module's rows. So it uses the same
# generate -> persist -> prove-it-renders loop the view designer uses, without
# the entity scoping: a widget is not "a layout for Properties", it is whatever
# the person asked for.


def _widget_html(result: Any) -> str:
    """The HTML out of a layout-generator reply, whichever shape it arrives in."""
    data = result if isinstance(result, dict) else {}
    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    return str(data.get("html") or inner.get("html") or "")


@bp.post("/widgets/design")
def design_widget():
    """Design (or edit) one dashboard widget, and return a template that renders.

    Nothing about this is entity-scoped. The generator is told which types exist
    and may query any of them, because a widget is frequently a figure drawn
    from two or three at once -- occupancy against rent, say.
    """
    client = authed_client()
    body = request.get_json(silent=True) or {}

    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ApiError(400, "Describe the widget you want")
    instruction = instruction.strip()

    base_sql = body.get("base_sql")
    base_sql = (
        base_sql.strip()
        if isinstance(base_sql, str) and base_sql.strip()
        else f"SELECT * FROM {NS}.properties"
    )

    history = body.get("history")
    history = (
        [str(h) for h in history if isinstance(h, str)][-20:]
        if isinstance(history, list)
        else []
    )
    family = body.get("model_family")

    # Editing an existing widget amends the template's *source*, never its
    # rendered output -- the render inlines every row it read and would swamp
    # the model's context for no benefit.
    template_id = body.get("template_id")
    template_id = template_id.strip() if isinstance(template_id, str) else ""
    current_html = ""
    if template_id:
        existing = client.get_report_template(template_id)
        if isinstance(existing, dict):
            current_html = str(existing.get("html") or "")

    title = body.get("title")
    title = title.strip() if isinstance(title, str) and title.strip() else "untitled"

    html = ""
    render_error = ""
    steer = instruction

    # Three attempts. A template whose server-side SQL uses an unsupported
    # function only fails at render, and the engine's error names the functions
    # it does support -- feeding that back is what turns a dead widget into a
    # working one. Past three the model is not converging and the error is worth
    # showing rather than hiding behind another retry.
    for attempt in range(3):
        payload: dict[str, Any] = {
            "baseSql": base_sql,
            "namespace": client.namespace,
            "instruction": steer,
        }
        if current_html:
            payload["currentHtml"] = current_html
        if history:
            payload["history"] = history
        if isinstance(family, str) and family.strip():
            payload["model_family"] = family.strip()

        candidate = _widget_html(client.generate_view_layout(payload))
        if not candidate:
            if attempt == 0:
                raise ApiError(502, "The assistant returned no widget")
            break
        html = candidate

        # Rendering needs a stored template, so the candidate has to be saved
        # before it can be proved. An abandoned design therefore leaves a
        # template behind -- the same trade SOAR makes, for the same reason.
        if template_id:
            client.update_report_template(template_id, {"html": html})
        else:
            created = client.create_report_template(f"Widget — {title}", html)
            new_id = ""
            if isinstance(created, dict):
                new_id = str(created.get("_id") or created.get("id") or "")
            if not new_id:
                raise ApiError(502, "Could not store the generated widget")
            template_id = new_id

        try:
            client.render_report_template(template_id, {"viewSql": base_sql})
            render_error = ""
            break
        except ApiError as exc:
            render_error = str(exc.detail)
            current_html = html
            steer = (
                f"{instruction}\n\nThe widget you produced FAILED to render with "
                f"this InventDB engine error. Fix the template so it renders "
                f"cleanly -- for example by replacing an unsupported SQL function "
                f"with a supported one from the list in the error -- without "
                f"changing the intended design:\n\n{render_error}"
            )

    if render_error:
        raise ApiError(502, f"The generated widget could not render: {render_error}")

    return jsonify({"template_id": template_id, "html": html, "base_sql": base_sql})


@bp.post("/widgets/<template_id>/render")
def render_widget(template_id: str):
    """Re-run a widget's queries and return its HTML. Live on every open."""
    body = request.get_json(silent=True) or {}
    view_sql = body.get("base_sql")
    view_sql = view_sql.strip() if isinstance(view_sql, str) else ""

    client = authed_client()
    result = client.render_report_template(template_id, {"viewSql": view_sql}) or {}
    return jsonify({"html": result.get("html") or ""})
