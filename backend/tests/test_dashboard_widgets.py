"""Dashboard widgets — designing a mini-report and rendering it.

The interesting behaviour is not the proxying, it is the loop: a generated
template is stored, then *proved* by rendering it, and a render failure is fed
back to the model as the next instruction. A widget that only fails when someone
opens the dashboard is worse than one that was never created, so this route
refuses to hand back a template it has not seen render.
"""

from __future__ import annotations

from tests.fake_inventdb import FakeInventDB

GENERATE = "/api/saved-views/generate-layout"
CREATE = "/api/report-templates"


def design(api, **body):
    return api.post("/api/reports/widgets/design", json={"instruction": "open work orders", **body})


def _layout(fake: FakeInventDB, html: str = "<div class='kpi'>22</div>"):
    fake.on("POST", GENERATE, {"html": html})


def _created(fake: FakeInventDB, template_id: str = "tpl-1"):
    fake.on("POST", CREATE, {"_id": template_id})


# ===========================================================================
# Designing
# ===========================================================================


def test_a_described_widget_comes_back_with_a_template_that_renders(api, fake: FakeInventDB):
    _layout(fake)
    _created(fake)
    resp = design(api)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["template_id"] == "tpl-1"
    assert "kpi" in body["html"]


def test_the_generated_template_is_stored_before_it_is_rendered(api, fake: FakeInventDB):
    """Rendering needs an id, so the candidate has to be saved to be proved."""
    _layout(fake)
    _created(fake)
    design(api)
    paths = [c.path for c in fake.calls_to("POST")]
    assert paths.index(CREATE) < paths.index("/api/report-templates/tpl-1/render")


def test_the_widget_is_proved_by_rendering_it(api, fake: FakeInventDB):
    _layout(fake)
    _created(fake)
    design(api)
    assert any("/render" in c.path for c in fake.calls_to("POST"))


def test_an_instruction_is_required(api, fake: FakeInventDB):
    resp = api.post("/api/reports/widgets/design", json={"instruction": "   "})
    assert resp.status_code == 400
    assert fake.calls_to("POST") == []


def test_a_generator_that_returns_nothing_is_a_bad_gateway(api, fake: FakeInventDB):
    """An empty reply is upstream's failure, not the caller's."""
    fake.on("POST", GENERATE, {"html": ""})
    resp = design(api)
    assert resp.status_code == 502


def test_a_render_failure_is_fed_back_and_retried(api, fake: FakeInventDB):
    """The engine's error names the functions it does support, so handing that
    text back is what turns a dead widget into a working one."""
    _created(fake)
    _layout(fake)

    seen = {"renders": 0}

    def render_call(call) -> bool:
        if "/render" not in call.path:
            return False
        seen["renders"] += 1
        return seen["renders"] == 1

    fake.on("POST", render_call, {"error": "DATE_TRUNC is not supported"}, status=400)

    resp = design(api)
    assert resp.status_code == 200

    # The second design call carries the engine's complaint as its steer.
    designs = [c for c in fake.calls_to("POST") if c.path == GENERATE]
    assert len(designs) == 2
    assert "DATE_TRUNC is not supported" in designs[1].body["instruction"]
    assert designs[1].body["currentHtml"]


def test_a_widget_that_never_renders_is_refused_rather_than_returned(api, fake: FakeInventDB):
    """Three attempts, then say so — a broken widget must not reach the grid."""
    _created(fake)
    _layout(fake)
    fake.on("POST", lambda c: "/render" in c.path, {"error": "still broken"}, status=400)

    resp = design(api)
    assert resp.status_code == 502
    assert "still broken" in resp.get_json()["error"]
    assert len([c for c in fake.calls_to("POST") if c.path == GENERATE]) == 3


def test_editing_an_existing_widget_updates_it_rather_than_creating_another(
    api, fake: FakeInventDB
):
    _layout(fake)
    fake.on("GET", "/api/report-templates/tpl-9", {"html": "<div>old</div>"})
    design(api, template_id="tpl-9")

    assert CREATE not in [c.path for c in fake.calls_to("POST")]
    assert any(c.path == "/api/report-templates/tpl-9" for c in fake.calls_to("PUT"))


def test_an_edit_sends_the_templates_source_not_its_rendered_output(api, fake: FakeInventDB):
    """The render inlines every row it read; sending that would swamp the model."""
    _layout(fake)
    fake.on("GET", "/api/report-templates/tpl-9", {"html": "<div>source</div>"})
    design(api, template_id="tpl-9")
    sent = [c for c in fake.calls_to("POST") if c.path == GENERATE][0]
    assert sent.body["currentHtml"] == "<div>source</div>"


def test_the_design_conversation_is_carried_forward(api, fake: FakeInventDB):
    """Editing continues the thread instead of restarting the design."""
    _layout(fake)
    _created(fake)
    design(api, history=["make it a donut", "now sort by value"])
    sent = [c for c in fake.calls_to("POST") if c.path == GENERATE][0]
    assert sent.body["history"] == ["make it a donut", "now sort by value"]


def test_the_namespace_is_pinned_server_side(api, fake: FakeInventDB):
    _layout(fake)
    _created(fake)
    design(api)
    sent = [c for c in fake.calls_to("POST") if c.path == GENERATE][0]
    assert sent.body["namespace"] == "pms"


def test_designing_requires_a_token(api):
    resp = api.post(
        "/api/reports/widgets/design", json={"instruction": "x"}, token=None
    )
    assert resp.status_code == 401


# ===========================================================================
# Rendering
# ===========================================================================


def test_a_widget_renders_live(api, fake: FakeInventDB):
    fake.on("POST", "/api/report-templates/tpl-1/render", {"html": "<div>47</div>"})
    resp = api.post("/api/reports/widgets/tpl-1/render", json={"base_sql": "SELECT 1"})
    assert resp.status_code == 200
    assert resp.get_json()["html"] == "<div>47</div>"


def test_the_render_passes_the_widgets_own_query(api, fake: FakeInventDB):
    """The template's primary query reads params.viewSql; extra query() calls in
    the template carry their own SQL."""
    api.post("/api/reports/widgets/tpl-1/render", json={"base_sql": "SELECT * FROM pms.leases"})
    sent = fake.last_call("POST", "/api/report-templates/tpl-1/render")
    assert sent.body["params"]["viewSql"] == "SELECT * FROM pms.leases"


def test_rendering_requires_a_token(api):
    resp = api.post("/api/reports/widgets/tpl-1/render", json={}, token=None)
    assert resp.status_code == 401
