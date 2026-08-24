"""Saved views — a named, reusable filter over one PMS module's list.

A view is nothing more than a remembered browse state: a free-text term, a sort,
and the module it belongs to. Opening one re-runs the query against current data
rather than replaying a frozen result, which is why ``search`` and ``sort`` are
stored as *live* fields instead of being baked into the SQL.

These live in InventDB's own ``/api/saved-views`` store (the ``_System`` namespace),
which is the same store **SOAR's Store room** reads. A view saved here shows up
there and vice versa, exactly as threads, reports and workflows already do. That
interoperability is the reason this module speaks InventDB's field names --
``baseSql``, ``defaultForType``, ``sort: {col, dir}`` -- rather than the PMS's own.

Two upstream behaviours shape the code below, and both are load-bearing:

* **Create is typed, update is not.** InventDB deserialises a POST into a struct,
  so any field outside its schema is silently dropped -- ``defaultForType`` among
  them. PUT merges raw JSON instead. So a view is created first and flagged as the
  default second; there is no way to do it in one call.
* **The list projection has no ``baseSql``.** ``GET /api/saved-views`` returns
  summaries only, so nothing in it says which module a view belongs to. Scoping a
  list to one module means fetching each view and reading its query. Views are few
  and the fetches run per request, so this stays cheap.

The router owns one invariant the upstream store does not: **at most one default
per module**. Setting a default clears whichever view previously held it, in the
same request, so two views can never both claim it.
"""

from __future__ import annotations

import re
from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..entities import Entity, get_entity
from ..errors import ApiError
from ..inventdb import InventDBClient
from ..sqlutil import ident

bp = Blueprint("views", __name__, url_prefix="/api/views")

#: Cap on a view name. Long enough for a sentence, short enough that the
#: switcher's rows stay one line.
_MAX_NAME = 120
#: Cap on the remembered search term, mirroring what the search box can hold.
_MAX_SEARCH = 500


def _require_entity(entity_name: str) -> Entity:
    entity = get_entity(entity_name)
    if not entity:
        raise ApiError(404, f"Unknown entity: {entity_name}")
    return entity


def _default_key(client: InventDBClient, entity: Entity) -> str:
    """The tag marking a view as its module's default -- ``"<namespace>.<type>"``.

    Namespaced because the saved-view store is instance-wide: two namespaces can
    each hold a ``properties`` type, and their defaults must not collide.
    """
    return f"{client.namespace}.{entity.name}"


def _base_sql(client: InventDBClient, entity: Entity, sort: dict[str, Any] | None) -> str:
    """The query a view stands for, without pagination.

    ``LIMIT``/``OFFSET`` are deliberately absent: the list endpoint pages the
    result, and a view that froze a window would show the same rows forever.
    Identifiers go through :func:`ident`, so a sort column that is not a plain
    identifier is refused rather than concatenated.
    """
    table = f"{ident(client.namespace, 'namespace')}.{ident(entity.name, 'type')}"
    stmt = f"SELECT * FROM {table}"
    if sort and sort.get("col"):
        direction = "DESC" if str(sort.get("dir", "asc")).lower() == "desc" else "ASC"
        stmt += f" ORDER BY {ident(str(sort['col']), 'sort column')} {direction}"
    return stmt


#: A designed query has to be a read. The designer only ever writes SELECTs, but
#: the SQL reaches this router via the browser, so it is re-checked here rather
#: than trusted for having come back from InventDB a moment earlier.
_READ_ONLY_RE = re.compile(r"^\s*(?:select|with)\b", re.IGNORECASE)


def _designed_sql(
    client: InventDBClient, entity: Entity, raw: Any, sort: dict[str, Any] | None
) -> str:
    """The query a designed view runs, validated.

    Falls back to the plain module query when the designer returned nothing --
    a pure styling instruction ("make the badges green") legitimately has no
    query of its own, and the view should still show this module's rows.

    Two things are refused rather than corrected: a statement that is not a
    read, and one that reads from somewhere other than this module. The second
    matters because the router scopes every other operation by the ``FROM``
    clause -- a view whose query pointed elsewhere would be created here and
    then be invisible to the list, the rename and the delete.
    """
    if not isinstance(raw, str) or not raw.strip():
        return _base_sql(client, entity, sort)
    stmt = raw.strip().rstrip(";").strip()
    if not _READ_ONLY_RE.match(stmt):
        raise ApiError(400, "A view's query must be a SELECT")
    if not _targets(stmt, client, entity):
        raise ApiError(400, f"A {entity.name} view must read from {entity.name}")
    return stmt


def _targets(base_sql: str, client: InventDBClient, entity: Entity) -> bool:
    """Whether ``base_sql`` reads from this module's table.

    The saved-view store is shared with SOAR and holds views for every type on
    the instance, so this is what keeps one module's switcher from listing
    another's. Matching the ``FROM`` clause is how SOAR scopes its own list, and
    matching it the same way is what keeps the two rooms agreeing on which views
    belong where.
    """
    pattern = rf"\bfrom\s+{re.escape(client.namespace)}\.{re.escape(entity.name)}\b"
    return bool(re.search(pattern, base_sql or "", re.IGNORECASE))


def _clean_sort(raw: Any) -> dict[str, str] | None:
    """Normalise a sort into InventDB's ``{col, dir}``, or ``None``.

    The PMS's own tables speak ``{field, dir}``; both spellings are accepted so a
    caller can hand over its table state unchanged, but only ``col`` is stored --
    that is what SOAR reads.
    """
    if not isinstance(raw, dict):
        return None
    col = raw.get("col") or raw.get("field")
    if not col or not isinstance(col, str) or not col.strip():
        return None
    direction = "desc" if str(raw.get("dir", "asc")).lower() == "desc" else "asc"
    return {"col": col.strip(), "dir": direction}


def _clean_name(raw: Any) -> str:
    name = (raw or "").strip() if isinstance(raw, str) else ""
    if not name:
        raise ApiError(400, "A view needs a name")
    if len(name) > _MAX_NAME:
        raise ApiError(400, f"A view name cannot exceed {_MAX_NAME} characters")
    return name


def _clean_search(raw: Any) -> str:
    """The remembered term. ``""`` is meaningful -- it is what marks a view as
    browse-derived -- so an absent term becomes an empty string, not ``None``."""
    term = raw if isinstance(raw, str) else ""
    if len(term) > _MAX_SEARCH:
        raise ApiError(400, f"A search term cannot exceed {_MAX_SEARCH} characters")
    return term


def _body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object body")
    return data


def _shape(view: dict[str, Any], default_key: str) -> dict[str, Any]:
    """One view, as the PMS front end wants it.

    Upstream carries a dozen fields this app has no use for (``customScope``,
    ``attachmentsEnabled``, ``tags``…). Narrowing here means the client is not
    handed state it might round-trip back and accidentally rewrite.
    """
    mode = "custom" if view.get("customTemplateId") else "table"
    return {
        "id": str(view.get("_id") or ""),
        "name": view.get("name") or "",
        "search": view.get("search") if isinstance(view.get("search"), str) else "",
        "sort": _clean_sort(view.get("sort")),
        "is_default": view.get("defaultForType") == default_key,
        # A *table* view is the module's own grid, narrowed. A *custom* view is
        # a layout InventDB's designer built, rendered by the report engine --
        # so the page has to know which surface to draw before it draws either.
        "mode": mode,
        "template_id": str(view.get("customTemplateId") or "") or None,
        "base_sql": str(view.get("baseSql") or ""),
    }


def _views_for(client: InventDBClient, entity: Entity) -> list[dict[str, Any]]:
    """Every stored view whose query targets this module, newest name order.

    A view that cannot be fetched is skipped rather than failing the list: one
    broken document upstream should not take the whole switcher down with it.
    """
    default_key = _default_key(client, entity)
    out: list[dict[str, Any]] = []
    for summary in client.list_saved_views():
        view_id = str(summary.get("_id") or summary.get("id") or "")
        if not view_id:
            continue
        try:
            full = client.get_saved_view(view_id)
        except ApiError:
            continue
        if not isinstance(full, dict):
            continue
        if not _targets(str(full.get("baseSql") or ""), client, entity):
            continue
        full.setdefault("_id", view_id)
        out.append(_shape(full, default_key))
    out.sort(key=lambda v: v["name"].lower())
    return out


def _find(client: InventDBClient, entity: Entity, view_id: str) -> dict[str, Any]:
    """Fetch one view and prove it belongs to this module.

    Scoping every route by entity is what stops a caller renaming or deleting a
    Tenants view through the Properties URL -- the id alone would happily
    address either.
    """
    try:
        full = client.get_saved_view(view_id)
    except ApiError as exc:
        if exc.status_code == 404:
            raise ApiError(404, "View not found") from None
        raise
    if not isinstance(full, dict) or not _targets(
        str(full.get("baseSql") or ""), client, entity
    ):
        raise ApiError(404, "View not found")
    full.setdefault("_id", view_id)
    return full


# ------------------------------------------------------------------ the routes


@bp.get("/<entity_name>")
def list_views(entity_name: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    return jsonify({"items": _views_for(client, entity)})


@bp.post("/<entity_name>")
def create_view(entity_name: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    body = _body()

    name = _clean_name(body.get("name"))
    sort = _clean_sort(body.get("sort"))
    search = _clean_search(body.get("search"))
    default_key = _default_key(client, entity)

    # A designed view points at the layout the designer already stored, so
    # saving is just the SavedView row -- which is also how SOAR stores one, so
    # a view designed here opens in its Store room.
    template_id = body.get("template_id")
    template_id = template_id.strip() if isinstance(template_id, str) else ""
    payload: dict[str, Any] = {
        "name": name,
        "namespace": client.namespace,
        "defaultMode": "table",
        "search": search,
        "sort": sort,
    }
    if template_id:
        payload["defaultMode"] = "custom"
        payload["customTemplateId"] = template_id
        # A designed view's query comes from the designer, not from the module's
        # sort: the instruction may have chosen columns, an order or a bound the
        # grid knows nothing about. It still has to read from this module, or the
        # view would not belong to the list it was created from.
        payload["baseSql"] = _designed_sql(client, entity, body.get("base_sql"), sort)
        # The layout was stored under a placeholder name while it was still a
        # candidate; now that it has one, say so in the report library too.
        try:
            client.update_report_template(template_id, {"name": f"View layout — {name}"})
        except ApiError:
            pass  # cosmetic — never fail a save over the template's label
    else:
        payload["baseSql"] = _base_sql(client, entity, sort)

    created = client.create_saved_view(payload)
    view_id = ""
    if isinstance(created, dict):
        view_id = str(created.get("_id") or created.get("id") or "")
    if not view_id:
        raise ApiError(502, "InventDB did not return an id for the new view")

    # `defaultForType` cannot ride along on the create -- the upstream POST is
    # typed and drops it -- so a view asked to be the default is flagged by the
    # same follow-up PUT that the dedicated endpoint uses.
    if body.get("is_default"):
        _apply_default(client, entity, view_id)

    # Shaped from what was sent, overlaid with whatever InventDB echoed back.
    # The echo is the better source when it is a full document, but it is not
    # contractually one -- so the reply must not depend on it being complete.
    stored = created if isinstance(created, dict) else {}
    return jsonify(_shape({**payload, **stored, "_id": view_id}, default_key)), 201


@bp.post("/<entity_name>/design")
def design_view(entity_name: str):
    """Ask InventDB's designer for a layout, and the query to drive it.

    Nothing is saved here. The browser holds the returned HTML, shows it as a
    preview, and only a follow-up create turns it into a view -- so describing
    something and disliking it costs nothing and leaves nothing behind.

    Passing ``current_html`` makes the next turn an *edit* of that layout rather
    than a fresh design, which is what lets "now make the rent bold" build on
    what is already on screen instead of starting over.
    """
    entity = _require_entity(entity_name)
    client = authed_client()
    body = _body()

    instruction = body.get("instruction")
    if not isinstance(instruction, str) or not instruction.strip():
        raise ApiError(400, "Describe the view you want")
    instruction = instruction.strip()

    base_sql = _designed_sql(client, entity, body.get("base_sql"), None)
    history = body.get("history")
    history = (
        [str(h) for h in history if isinstance(h, str)][-20:]
        if isinstance(history, list)
        else []
    )
    family = body.get("model_family")

    # Editing an existing design: the template's *source* is what the model
    # amends. Deliberately not the rendered output -- that inlines every record
    # and a base64 image per card, and would blow past the model's context.
    template_id = body.get("template_id")
    template_id = template_id.strip() if isinstance(template_id, str) else ""
    current_html = ""
    if template_id:
        existing = client.get_report_template(template_id)
        if isinstance(existing, dict):
            current_html = str(existing.get("html") or "")

    html = ""
    sql: str | None = None
    render_error = ""
    steer = instruction

    # Generate, persist, then prove it renders. A template whose server-side SQL
    # uses an unsupported function only fails at render time, and the engine's
    # error names the supported ones -- so handing that text back to the model
    # is what turns a dead layout into a working one. Three attempts: past that
    # the model is not converging and the error is worth showing the user.
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

        result = client.generate_view_layout(payload)
        data = result if isinstance(result, dict) else {}
        inner = data.get("data") if isinstance(data.get("data"), dict) else {}
        candidate = data.get("html") or inner.get("html")
        if not candidate:
            if attempt == 0:
                raise ApiError(502, "The designer returned no layout")
            break

        html = candidate
        raw_sql = data.get("sql") or inner.get("sql")
        sql = raw_sql.strip() if isinstance(raw_sql, str) and raw_sql.strip() else None

        # render-layout needs a template id, so the candidate has to be stored
        # before it can be checked. An abandoned design therefore leaves a
        # template behind -- the same trade SOAR makes for the same reason.
        if template_id:
            client.update_report_template(template_id, {"html": html})
        else:
            created = client.create_report_template(
                f"View layout — {entity.label_plural}", html
            )
            new_id = ""
            if isinstance(created, dict):
                new_id = str(created.get("_id") or created.get("id") or "")
            if not new_id:
                raise ApiError(502, "Could not store the generated layout")
            template_id = new_id

        check_sql = sql if sql and _targets(sql, client, entity) else base_sql
        try:
            client.render_view_layout(
                {
                    "templateId": template_id,
                    "baseSql": check_sql,
                    "page": 0,
                    "pageSize": 12,
                }
            )
            render_error = ""
            break
        except ApiError as exc:
            render_error = str(exc.detail)
            current_html = html
            steer = (
                f"{instruction}\n\nThe layout you produced FAILED to render with "
                f"this InventDB engine error. Fix the template so it renders "
                f"cleanly — for example by replacing an unsupported SQL function "
                f"with a supported one from the list in the error — without "
                f"changing the intended design:\n\n{render_error}"
            )

    if render_error:
        raise ApiError(502, f"The generated layout could not render: {render_error}")

    return jsonify(
        {
            "template_id": template_id,
            "html": html,
            # Only adopt a query that actually reads this module; a designer that
            # wandered elsewhere gets ignored rather than saved and then lost.
            "sql": sql if sql and _targets(sql, client, entity) else None,
        }
    )


@bp.post("/<entity_name>/render")
def render_view(entity_name: str):
    """Render one page of a custom layout, for the preview and for the list.

    ``base_sql`` is optional: a preview renders the query the designer just
    returned, while a saved view renders its own.
    """
    entity = _require_entity(entity_name)
    client = authed_client()
    body = _body()

    template_id = body.get("template_id")
    if not isinstance(template_id, str) or not template_id.strip():
        raise ApiError(400, "template_id is required")

    page = body.get("page")
    page_size = body.get("page_size")
    result = client.render_view_layout(
        {
            "templateId": template_id.strip(),
            "baseSql": _designed_sql(client, entity, body.get("base_sql"), None),
            "page": page if isinstance(page, int) and page >= 0 else 0,
            "pageSize": page_size if isinstance(page_size, int) and 0 < page_size <= 200 else 25,
        }
    )
    data = result if isinstance(result, dict) else {}
    return jsonify({"html": data.get("html") or "", "total": data.get("total")})


@bp.put("/<entity_name>/<view_id>")
def update_view(entity_name: str, view_id: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    existing = _find(client, entity, view_id)
    body = _body()

    patch: dict[str, Any] = {}
    if "name" in body:
        patch["name"] = _clean_name(body.get("name"))
    if "search" in body:
        patch["search"] = _clean_search(body.get("search"))
    if "sort" in body:
        sort = _clean_sort(body.get("sort"))
        patch["sort"] = sort
        # The sort lives in two places -- as the live `sort` field and as the
        # ORDER BY inside `baseSql` -- because SOAR reads the SQL and the PMS
        # reads the field. Rewriting only one would let the two rooms disagree
        # about the same view.
        patch["baseSql"] = _base_sql(client, entity, sort)
    if not patch:
        return jsonify(_shape(existing, _default_key(client, entity)))

    client.update_saved_view(view_id, patch)
    return jsonify(_shape({**existing, **patch}, _default_key(client, entity)))


@bp.delete("/<entity_name>/<view_id>")
def delete_view(entity_name: str, view_id: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    _find(client, entity, view_id)
    client.delete_saved_view(view_id)
    return jsonify({"ok": True, "deleted": view_id})


def _apply_default(client: InventDBClient, entity: Entity, view_id: str | None) -> None:
    """Make ``view_id`` the module's default, or clear the default when ``None``.

    Every other view still claiming the tag is cleared in the same request. Doing
    it here rather than in the client is what makes "exactly one default" a
    property of the system instead of a convention the UI is trusted to keep.
    """
    default_key = _default_key(client, entity)
    for view in _views_for(client, entity):
        if view["id"] == view_id:
            if not view["is_default"]:
                client.update_saved_view(view["id"], {"defaultForType": default_key})
        elif view["is_default"]:
            client.update_saved_view(view["id"], {"defaultForType": None})


@bp.put("/<entity_name>/<view_id>/default")
def set_default(entity_name: str, view_id: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    _find(client, entity, view_id)
    _apply_default(client, entity, view_id)
    return jsonify({"items": _views_for(client, entity)})


@bp.delete("/<entity_name>/default")
def clear_default(entity_name: str):
    entity = _require_entity(entity_name)
    client = authed_client()
    _apply_default(client, entity, None)
    return jsonify({"items": _views_for(client, entity)})
