"""Saved views — the named browse states behind every module's view switcher.

What these tests pin down, beyond the obvious CRUD:

* **Scoping.** The saved-view store is instance-wide and shared with SOAR, so the
  list has to be narrowed to the module being asked about, and an id belonging to
  another module must not be reachable through this module's URL.
* **The two-step default.** InventDB's create is typed and drops
  ``defaultForType``; only its untyped PUT keeps it. A view asked to be the
  default at creation must therefore be flagged by a follow-up call.
* **One default per module.** Promoting a view has to clear whoever held it.
* **The sort lives twice** — as the live ``sort`` field and as the ORDER BY in
  ``baseSql`` — so both have to move together.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from tests.conftest import NAMESPACE
from tests.fake_inventdb import Reply


def _summary(view_id: str, name: str) -> dict[str, Any]:
    """What InventDB's list projection actually returns — no ``baseSql``."""
    return {
        "_id": view_id,
        "name": name,
        "description": "",
        "namespace": NAMESPACE,
        "defaultMode": "table",
        "attachmentsEnabled": False,
        "version": 1,
        "createdBy": "tester",
    }


def _stored(
    view_id: str,
    name: str,
    *,
    entity: str = "properties",
    search: str = "",
    sort: dict[str, str] | None = None,
    default_for: str | None = None,
    namespace: str = NAMESPACE,
) -> dict[str, Any]:
    """A full stored view, as ``GET /api/saved-views/<id>`` returns it."""
    doc: dict[str, Any] = {
        "_id": view_id,
        "name": name,
        "namespace": namespace,
        "baseSql": f"SELECT * FROM {namespace}.{entity}",
        "defaultMode": "table",
        "search": search,
        "sort": sort,
    }
    if default_for is not None:
        doc["defaultForType"] = default_for
    return doc


def _seed(fake, views: list[dict[str, Any]]) -> None:
    """Route the list plus a hydrate call per view."""
    fake.on("GET", "/api/saved-views", {"views": [_summary(v["_id"], v["name"]) for v in views]})
    for view in views:
        fake.on("GET", f"/api/saved-views/{view['_id']}", view)


# ------------------------------------------------------------------ listing


def test_list_returns_only_this_modules_views(api, fake):
    _seed(
        fake,
        [
            _stored("v1", "Vacant", entity="properties"),
            _stored("v2", "Expiring soon", entity="leases"),
            _stored("v3", "By city", entity="properties"),
        ],
    )

    resp = api.get("/api/views/properties")

    assert resp.status_code == 200
    names = [v["name"] for v in resp.get_json()["items"]]
    assert names == ["By city", "Vacant"]  # alphabetical, leases excluded


def test_list_ignores_a_same_named_type_in_another_namespace(api, fake):
    _seed(fake, [_stored("v1", "Elsewhere", entity="properties", namespace="other")])

    resp = api.get("/api/views/properties")

    assert resp.get_json()["items"] == []


def test_a_broken_view_is_skipped_rather_than_failing_the_list(api, fake):
    fake.on(
        "GET",
        "/api/saved-views",
        {"views": [_summary("good", "Vacant"), _summary("bad", "Broken")]},
    )
    fake.on("GET", "/api/saved-views/good", _stored("good", "Vacant"))
    fake.on("GET", "/api/saved-views/bad", {"error": "gone"}, status=404)

    resp = api.get("/api/views/properties")

    assert resp.status_code == 200
    assert [v["name"] for v in resp.get_json()["items"]] == ["Vacant"]


def test_the_default_flag_is_reported_per_module(api, fake):
    _seed(
        fake,
        [
            _stored("v1", "Vacant", default_for=f"{NAMESPACE}.properties"),
            _stored("v2", "By city"),
        ],
    )

    items = api.get("/api/views/properties").get_json()["items"]

    by_name = {v["name"]: v for v in items}
    assert by_name["Vacant"]["is_default"] is True
    assert by_name["By city"]["is_default"] is False


def test_unknown_module_is_a_404(api, fake):
    resp = api.get("/api/views/dragons")

    assert resp.status_code == 404
    assert not fake.calls


# ------------------------------------------------------------------ creating


def test_create_composes_base_sql_and_stores_the_live_filter(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "new-1"}, status=201)

    resp = api.post(
        "/api/views/properties",
        json={"name": "Vacant", "search": "vacant", "sort": {"col": "city", "dir": "desc"}},
    )

    assert resp.status_code == 201
    sent = fake.last_call("POST", "/api/saved-views").body
    assert sent["baseSql"] == f"SELECT * FROM {NAMESPACE}.properties ORDER BY city DESC"
    assert sent["search"] == "vacant"
    assert sent["sort"] == {"col": "city", "dir": "desc"}
    assert sent["namespace"] == NAMESPACE


def test_create_accepts_the_tables_own_sort_spelling(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "new-1"}, status=201)

    api.post(
        "/api/views/properties",
        json={"name": "By city", "sort": {"field": "city", "dir": "asc"}},
    )

    # `field` is what the PMS table emits; `col` is what SOAR reads. Only one
    # of them may be stored, or the two rooms disagree about the same view.
    assert fake.last_call("POST", "/api/saved-views").body["sort"] == {
        "col": "city",
        "dir": "asc",
    }


def test_base_sql_omits_pagination(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "new-1"}, status=201)

    api.post("/api/views/properties", json={"name": "Vacant"})

    sql = fake.last_call("POST", "/api/saved-views").body["baseSql"]
    assert "LIMIT" not in sql.upper()
    assert "OFFSET" not in sql.upper()


def test_creating_a_default_view_takes_a_second_call(api, fake):
    # The upstream POST is typed and drops `defaultForType`, so asking for a
    # default at creation has to become create-then-flag.
    fake.on("POST", "/api/saved-views", {"_id": "new-1"}, status=201)
    _seed(fake, [_stored("new-1", "Vacant")])
    fake.on("PUT", "/api/saved-views/new-1", {"ok": True})

    resp = api.post("/api/views/properties", json={"name": "Vacant", "is_default": True})

    assert resp.status_code == 201
    assert fake.last_call("PUT", "/api/saved-views/new-1").body == {
        "defaultForType": f"{NAMESPACE}.properties"
    }


def test_a_nameless_view_is_refused(api, fake):
    resp = api.post("/api/views/properties", json={"name": "   "})

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/api/saved-views")


def test_an_over_long_name_is_refused(api, fake):
    resp = api.post("/api/views/properties", json={"name": "x" * 200})

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/api/saved-views")


def test_a_sort_column_that_is_not_an_identifier_is_refused(api, fake):
    resp = api.post(
        "/api/views/properties",
        json={"name": "Injected", "sort": {"col": "city; DROP TABLE pms.properties"}},
    )

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/api/saved-views")


def test_a_create_that_returns_no_id_is_reported(api, fake):
    fake.on("POST", "/api/saved-views", {"ok": True}, status=201)

    resp = api.post("/api/views/properties", json={"name": "Vacant"})

    assert resp.status_code == 502


# ------------------------------------------------------------------ updating


def test_rename_patches_only_the_name(api, fake):
    _seed(fake, [_stored("v1", "Vacant")])
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})

    resp = api.put("/api/views/properties/v1", json={"name": "Vacant units"})

    assert resp.status_code == 200
    assert fake.last_call("PUT", "/api/saved-views/v1").body == {"name": "Vacant units"}


def test_changing_the_sort_moves_base_sql_with_it(api, fake):
    _seed(fake, [_stored("v1", "Vacant")])
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})

    api.put("/api/views/properties/v1", json={"sort": {"col": "city", "dir": "desc"}})

    body = fake.last_call("PUT", "/api/saved-views/v1").body
    assert body["sort"] == {"col": "city", "dir": "desc"}
    assert body["baseSql"] == f"SELECT * FROM {NAMESPACE}.properties ORDER BY city DESC"


def test_clearing_the_sort_drops_the_order_by(api, fake):
    _seed(fake, [_stored("v1", "Vacant", sort={"col": "city", "dir": "asc"})])
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})

    api.put("/api/views/properties/v1", json={"sort": None})

    body = fake.last_call("PUT", "/api/saved-views/v1").body
    assert body["sort"] is None
    assert body["baseSql"] == f"SELECT * FROM {NAMESPACE}.properties"


def test_an_empty_patch_writes_nothing(api, fake):
    _seed(fake, [_stored("v1", "Vacant")])

    resp = api.put("/api/views/properties/v1", json={})

    assert resp.status_code == 200
    assert not fake.calls_to("PUT", "/api/saved-views/v1")


def test_a_view_belonging_to_another_module_is_not_reachable(api, fake):
    _seed(fake, [_stored("v1", "Expiring", entity="leases")])

    resp = api.put("/api/views/properties/v1", json={"name": "Hijacked"})

    assert resp.status_code == 404
    assert not fake.calls_to("PUT", "/api/saved-views/v1")


# ------------------------------------------------------------------ deleting


def test_delete_removes_the_view(api, fake):
    _seed(fake, [_stored("v1", "Vacant")])
    fake.on("DELETE", "/api/saved-views/v1", {"deleted": "v1"})

    resp = api.delete("/api/views/properties/v1")

    assert resp.status_code == 200
    assert fake.calls_to("DELETE", "/api/saved-views/v1")


def test_delete_refuses_another_modules_view(api, fake):
    _seed(fake, [_stored("v1", "Expiring", entity="leases")])

    resp = api.delete("/api/views/properties/v1")

    assert resp.status_code == 404
    assert not fake.calls_to("DELETE", "/api/saved-views/v1")


# ------------------------------------------------------------------ defaults


def test_promoting_a_view_clears_the_previous_default(api, fake):
    _seed(
        fake,
        [
            _stored("v1", "Vacant", default_for=f"{NAMESPACE}.properties"),
            _stored("v2", "By city"),
        ],
    )
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})
    fake.on("PUT", "/api/saved-views/v2", {"ok": True})

    resp = api.put("/api/views/properties/v2/default")

    assert resp.status_code == 200
    assert fake.last_call("PUT", "/api/saved-views/v2").body == {
        "defaultForType": f"{NAMESPACE}.properties"
    }
    assert fake.last_call("PUT", "/api/saved-views/v1").body == {"defaultForType": None}


def test_promoting_the_current_default_is_a_no_op(api, fake):
    _seed(fake, [_stored("v1", "Vacant", default_for=f"{NAMESPACE}.properties")])

    resp = api.put("/api/views/properties/v1/default")

    assert resp.status_code == 200
    assert not fake.calls_to("PUT", "/api/saved-views/v1")


def test_clearing_the_default_leaves_the_views_alone(api, fake):
    _seed(
        fake,
        [
            _stored("v1", "Vacant", default_for=f"{NAMESPACE}.properties"),
            _stored("v2", "By city"),
        ],
    )
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})

    resp = api.delete("/api/views/properties/default")

    assert resp.status_code == 200
    assert fake.last_call("PUT", "/api/saved-views/v1").body == {"defaultForType": None}
    assert not fake.calls_to("PUT", "/api/saved-views/v2")


def test_another_modules_default_is_never_touched(api, fake):
    _seed(
        fake,
        [
            _stored("v1", "Vacant"),
            _stored("v2", "Expiring", entity="leases", default_for=f"{NAMESPACE}.leases"),
        ],
    )
    fake.on("PUT", "/api/saved-views/v1", {"ok": True})

    api.put("/api/views/properties/v1/default")

    assert not fake.calls_to("PUT", "/api/saved-views/v2")


# ------------------------------------------------------------------ auth


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/views/properties"),
        ("POST", "/api/views/properties"),
        ("PUT", "/api/views/properties/v1"),
        ("DELETE", "/api/views/properties/v1"),
        ("PUT", "/api/views/properties/v1/default"),
        ("DELETE", "/api/views/properties/default"),
    ],
)
def test_every_view_route_needs_a_bearer_token(api, fake, method, path):
    resp = api._open(method, path, token=None, json={})

    assert resp.status_code == 401
    assert not fake.calls


def test_every_module_has_a_view_list(api, fake):
    """Views are a property of the module registry, not a per-page feature."""
    fake.on("GET", "/api/saved-views", {"views": []})

    for entity in json.loads(api.get("/api/meta/entities").data)["entities"]:
        resp = api.get(f"/api/views/{entity['name']}")
        assert resp.status_code == 200, entity["name"]
        assert resp.get_json()["items"] == []


# ------------------------------------------------------------ designed views
#
# The "New view" flow. Describe a view; InventDB's designer returns a layout and
# the query to drive it. Three upstream facts shape this:
#
#   * `render-layout` needs a template id, so a candidate layout has to be
#     STORED before it can be checked. An abandoned design therefore leaves a
#     template behind -- the same trade SOAR makes, for the same reason.
#   * A template whose server-side SQL uses an unsupported function only fails
#     at RENDER time, and the engine's error names the supported ones. Handing
#     that text back to the model is what turns a dead layout into a working one.
#   * Nothing becomes a *view* until the user saves, so a design they dislike
#     costs nothing and leaves no view behind.


def _design_ok(fake, html="<html>cards</html>", sql=None, template_id="tpl-1"):
    """Route a clean design: generate, store, render-check."""
    payload = {"html": html}
    if sql is not None:
        payload["sql"] = sql
    fake.on("POST", "/api/saved-views/generate-layout", payload)
    fake.on("POST", "/api/report-templates", {"_id": template_id}, status=201)
    fake.on("POST", "/api/saved-views/render-layout", {"html": "<div/>", "total": 3})


def test_design_generates_stores_and_proves_the_layout_renders(api, fake):
    _design_ok(fake, sql=f"SELECT * FROM {NAMESPACE}.properties ORDER BY city ASC")

    resp = api.post(
        "/api/views/properties/design", json={"instruction": "a card per property"}
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["template_id"] == "tpl-1"
    assert body["html"] == "<html>cards</html>"
    assert body["sql"] == f"SELECT * FROM {NAMESPACE}.properties ORDER BY city ASC"

    sent = fake.last_call("POST", "/api/saved-views/generate-layout").body
    assert sent["baseSql"] == f"SELECT * FROM {NAMESPACE}.properties"
    assert sent["namespace"] == NAMESPACE
    assert sent["instruction"] == "a card per property"
    # Stored, then rendered -- in that order, because the render needs the id.
    assert fake.calls_to("POST", "/api/report-templates")
    assert (
        fake.last_call("POST", "/api/saved-views/render-layout").body["templateId"]
        == "tpl-1"
    )


def test_design_without_an_instruction_is_refused(api, fake):
    resp = api.post("/api/views/properties/design", json={"instruction": "  "})

    assert resp.status_code == 400
    assert not fake.calls


def test_editing_a_design_amends_the_template_source(api, fake):
    # The model edits the template SOURCE, never the rendered output -- which
    # inlines every record and would blow past its context window.
    fake.on(
        "GET", "/api/report-templates/tpl-1", {"_id": "tpl-1", "html": "<html>v1</html>"}
    )
    fake.on("POST", "/api/saved-views/generate-layout", {"html": "<html>v2</html>"})
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})
    fake.on("POST", "/api/saved-views/render-layout", {"html": "<div/>", "total": 1})

    resp = api.post(
        "/api/views/properties/design",
        json={
            "instruction": "make the rent bold",
            "template_id": "tpl-1",
            "history": ["a card per property"],
        },
    )

    assert resp.status_code == 200
    sent = fake.last_call("POST", "/api/saved-views/generate-layout").body
    assert sent["currentHtml"] == "<html>v1</html>"
    assert sent["history"] == ["a card per property"]
    # Amended in place, not duplicated.
    assert fake.last_call("PUT", "/api/report-templates/tpl-1").body == {
        "html": "<html>v2</html>"
    }
    assert not fake.calls_to("POST", "/api/report-templates")


def test_a_styling_only_edit_returns_no_query(api, fake):
    # The designer omits `sql` when the instruction implied no new query. Not an
    # error: the view keeps whatever query it already had.
    _design_ok(fake)

    resp = api.post(
        "/api/views/properties/design", json={"instruction": "make the badges green"}
    )

    assert resp.status_code == 200
    assert resp.get_json()["sql"] is None


def test_a_query_that_wandered_to_another_module_is_ignored(api, fake):
    _design_ok(fake, sql=f"SELECT * FROM {NAMESPACE}.leases")

    resp = api.post("/api/views/properties/design", json={"instruction": "cards"})

    # Dropped rather than kept: a view is found, renamed and deleted by its FROM
    # clause, so one pointing elsewhere would vanish from its own list.
    assert resp.get_json()["sql"] is None


def test_a_layout_that_fails_to_render_is_retried_with_the_engine_error(api, fake):
    generated: list[dict[str, Any]] = []

    def _generate(call):
        generated.append(call.body)
        return Reply(200, {"html": f"<html>v{len(generated)}</html>"})

    rendered = {"n": 0}

    def _render(call):
        rendered["n"] += 1
        if rendered["n"] == 1:
            return Reply(422, {"error": "unsupported function DATEDIFF"})
        return Reply(200, {"html": "<div/>", "total": 2})

    fake.on("POST", "/api/saved-views/generate-layout", error=_generate)
    fake.on("POST", "/api/report-templates", {"_id": "tpl-1"}, status=201)
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})
    fake.on("POST", "/api/saved-views/render-layout", error=_render)

    resp = api.post("/api/views/properties/design", json={"instruction": "cards"})

    assert resp.status_code == 200
    assert len(generated) == 2, "the failing render should have driven a second attempt"
    # The engine's exact words go back to the model -- they name the functions it
    # may use, which is what makes the retry more than a coin flip.
    assert "DATEDIFF" in generated[1]["instruction"]
    assert generated[1]["currentHtml"] == "<html>v1</html>"


def test_a_layout_that_never_renders_is_reported_rather_than_saved(api, fake):
    fake.on("POST", "/api/saved-views/generate-layout", {"html": "<html>bad</html>"})
    fake.on("POST", "/api/report-templates", {"_id": "tpl-1"}, status=201)
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})
    fake.on(
        "POST",
        "/api/saved-views/render-layout",
        {"error": "unsupported function DATEDIFF"},
        status=422,
    )

    resp = api.post("/api/views/properties/design", json={"instruction": "cards"})

    assert resp.status_code == 502
    assert "DATEDIFF" in str(resp.get_json()["error"])


def test_a_designer_that_returns_no_layout_is_reported(api, fake):
    fake.on("POST", "/api/saved-views/generate-layout", {"sql": "SELECT 1"})

    resp = api.post("/api/views/properties/design", json={"instruction": "cards"})

    assert resp.status_code == 502
    assert not fake.calls_to("POST", "/api/report-templates")


@pytest.mark.parametrize(
    "sql",
    ["DELETE FROM pms.properties", "UPDATE pms.properties SET city = 'x'"],
)
def test_a_starting_query_that_is_not_a_read_is_refused(api, fake, sql):
    resp = api.post(
        "/api/views/properties/design", json={"instruction": "cards", "base_sql": sql}
    )

    assert resp.status_code == 400
    assert not fake.calls


# ------------------------------------------------------ saving a designed view


def test_saving_a_designed_view_points_it_at_the_layout(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "view-1"}, status=201)
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})

    resp = api.post(
        "/api/views/properties",
        json={
            "name": "Property cards",
            "template_id": "tpl-1",
            "base_sql": f"SELECT * FROM {NAMESPACE}.properties ORDER BY city ASC",
        },
    )

    assert resp.status_code == 201
    view = fake.last_call("POST", "/api/saved-views").body
    assert view["defaultMode"] == "custom"
    assert view["customTemplateId"] == "tpl-1"
    assert view["baseSql"] == f"SELECT * FROM {NAMESPACE}.properties ORDER BY city ASC"

    body = resp.get_json()
    assert body["mode"] == "custom"
    assert body["template_id"] == "tpl-1"


def test_saving_names_the_layout_after_the_view(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "view-1"}, status=201)
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})

    api.post(
        "/api/views/properties", json={"name": "Property cards", "template_id": "tpl-1"}
    )

    assert (
        "Property cards"
        in fake.last_call("PUT", "/api/report-templates/tpl-1").body["name"]
    )


def test_a_cosmetic_rename_failure_never_loses_the_view(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "view-1"}, status=201)
    fake.on("PUT", "/api/report-templates/tpl-1", {"error": "nope"}, status=500)

    resp = api.post(
        "/api/views/properties", json={"name": "Property cards", "template_id": "tpl-1"}
    )

    assert resp.status_code == 201


def test_a_designed_views_query_must_still_read_this_module(api, fake):
    resp = api.post(
        "/api/views/properties",
        json={
            "name": "Wrong",
            "template_id": "tpl-1",
            "base_sql": f"SELECT * FROM {NAMESPACE}.leases",
        },
    )

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/api/saved-views")


def test_a_view_saved_without_a_layout_stays_a_table(api, fake):
    fake.on("POST", "/api/saved-views", {"_id": "view-1"}, status=201)

    resp = api.post("/api/views/properties", json={"name": "Vacant"})

    assert fake.last_call("POST", "/api/saved-views").body["defaultMode"] == "table"
    assert resp.get_json()["mode"] == "table"
    assert not fake.calls_to("POST", "/api/report-templates")


def test_a_custom_view_is_listed_with_its_template(api, fake):
    stored = _stored("v1", "Property cards")
    stored["customTemplateId"] = "tpl-1"
    _seed(fake, [stored])

    item = api.get("/api/views/properties").get_json()["items"][0]

    assert item["mode"] == "custom"
    assert item["template_id"] == "tpl-1"


# ------------------------------------------------------------------ rendering


def test_render_pages_the_layout_upstream(api, fake):
    fake.on(
        "POST", "/api/saved-views/render-layout", {"html": "<div>page</div>", "total": 42}
    )

    resp = api.post(
        "/api/views/properties/render",
        json={"template_id": "tpl-1", "page": 2, "page_size": 10},
    )

    assert resp.status_code == 200
    assert resp.get_json() == {"html": "<div>page</div>", "total": 42}
    sent = fake.last_call("POST", "/api/saved-views/render-layout").body
    assert sent["templateId"] == "tpl-1"
    assert sent["page"] == 2
    assert sent["pageSize"] == 10
    # The engine windows the query itself; composing LIMIT/OFFSET here would mean
    # re-parsing SQL it already understands.
    assert "LIMIT" not in sent["baseSql"].upper()


def test_render_needs_a_template(api, fake):
    resp = api.post("/api/views/properties/render", json={"page": 0})

    assert resp.status_code == 400
    assert not fake.calls


def test_render_falls_back_to_sane_paging(api, fake):
    fake.on("POST", "/api/saved-views/render-layout", {"html": "", "total": 0})

    api.post(
        "/api/views/properties/render",
        json={"template_id": "tpl-1", "page": -5, "page_size": 9999},
    )

    sent = fake.last_call("POST", "/api/saved-views/render-layout").body
    assert sent["page"] == 0
    assert sent["pageSize"] == 25


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/views/properties/design"),
        ("POST", "/api/views/properties/render"),
    ],
)
def test_the_designer_routes_need_a_bearer_token(api, fake, method, path):
    resp = api._open(method, path, token=None, json={"instruction": "x"})

    assert resp.status_code == 401
    assert not fake.calls
