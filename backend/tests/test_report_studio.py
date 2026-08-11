"""``app.routers.reports`` — the authoring half: the Report Studio surface.

Listing and rendering are covered in ``test_reports.py``. What is protected here
is everything that *changes* a report, and the boundaries around it:

  * a rename may touch the name/description/category and nothing else — the
    layout is only ever written by InventDB's report agent, which validates the
    markup and versions the result, so a raw HTML PUT must not be a way past it;
  * the edit stream is relayed byte-for-byte, carrying its own conversation so a
    follow-up instruction has something to follow;
  * a snapshot is two files (the render and its regeneratable source) that must
    be listed as one report and deleted as one report.
"""

from __future__ import annotations

import pytest

from app.routers.reports import _snapshot_name


# ===========================================================================
# Renaming and deleting
# ===========================================================================


def test_rename_sends_only_the_changed_field(api, fake):
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True, "data": {"ok": True}})

    body = api.put(
        "/api/reports/templates/tpl-1", json={"name": "Rent Roll 2026"}
    ).get_json()

    assert body == {"ok": True, "id": "tpl-1", "name": "Rent Roll 2026"}
    assert fake.last_call("PUT", "/api/report-templates/tpl-1").body == {
        "name": "Rent Roll 2026"
    }


def test_a_rename_is_trimmed_and_bounded(api, fake):
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})

    api.put("/api/reports/templates/tpl-1", json={"name": "  " + "x" * 400 + "  "})

    sent = fake.last_call("PUT", "/api/report-templates/tpl-1").body["name"]
    assert len(sent) == 200
    assert not sent.startswith(" ")


def test_description_and_category_are_editable(api, fake):
    fake.on("PUT", "/api/report-templates/tpl-1", {"ok": True})

    api.put(
        "/api/reports/templates/tpl-1",
        json={"description": "Leases ending soon", "category": "Leasing"},
    )

    assert fake.last_call("PUT", "/api/report-templates/tpl-1").body == {
        "description": "Leases ending soon",
        "category": "Leasing",
    }


def test_the_layout_cannot_be_written_directly(api, fake):
    # Layout changes go through the report agent. A raw HTML PUT would skip the
    # validation and the version bump that make an edit reversible.
    resp = api.put("/api/reports/templates/tpl-1", json={"html": "<h1>anything</h1>"})

    assert resp.status_code == 400
    assert not fake.calls_to("PUT", "/api/report-templates/tpl-1")


@pytest.mark.parametrize("body", [{}, {"name": "   "}, {"unknown": "x"}])
def test_an_empty_rename_is_refused(api, fake, body):
    assert api.put("/api/reports/templates/tpl-1", json=body).status_code == 400
    assert not fake.calls_to("PUT", "/api/report-templates/tpl-1")


def test_delete_removes_the_template(api, fake):
    fake.on("DELETE", "/api/report-templates/tpl-1", {"ok": True})

    body = api.delete("/api/reports/templates/tpl-1").get_json()

    assert body == {"ok": True, "id": "tpl-1"}
    assert fake.calls_to("DELETE", "/api/report-templates/tpl-1")


def test_a_malformed_template_id_never_reaches_inventdb(api, fake):
    assert api.delete("/api/reports/templates/tpl-1%3Fpurge=all").status_code == 400
    assert not fake.calls_to("DELETE")


# ===========================================================================
# Edit by instruction
# ===========================================================================

EDIT_SSE = (
    b'event: start\ndata: {"template_id":"tpl-1","current_version":1}\n\n'
    b'event: reasoning\ndata: {"content":"","tokens":406}\n\n'
    b'event: html\ndata: {"html":"<h1>Rent Roll</h1>"}\n\n'
    b'event: saved\ndata: {"template_id":"tpl-1","version":2}\n\n'
    b"event: done\ndata: {}\n\n"
)


def test_the_edit_stream_is_relayed_verbatim(api, fake):
    fake.on("POST", "/api/report-templates/tpl-1/layout/stream", chunks=[EDIT_SSE])

    resp = api.post(
        "/api/reports/templates/tpl-1/edit/stream",
        json={"instruction": "Sort by amount"},
    )

    assert resp.status_code == 200
    assert resp.mimetype == "text/event-stream"
    # The studio reads InventDB's own events to know when the edit landed.
    assert resp.get_data() == EDIT_SSE


def test_the_edit_stream_is_not_buffered(api, fake):
    fake.on("POST", "/api/report-templates/tpl-1/layout/stream", chunks=[EDIT_SSE])

    resp = api.post(
        "/api/reports/templates/tpl-1/edit/stream", json={"instruction": "Sort it"}
    )

    # Buffering would turn a visible edit into a blank wait.
    assert resp.headers["X-Accel-Buffering"] == "no"
    assert resp.headers["Cache-Control"] == "no-cache"
    # Hop-by-hop; WSGI forbids the app from sending it and waitress 500s if it does.
    assert "Connection" not in resp.headers


def test_the_edit_carries_its_conversation(api, fake):
    fake.on("POST", "/api/report-templates/tpl-1/layout/stream", chunks=[EDIT_SSE])
    history = [{"role": "user", "content": "Add a total row"}]

    api.post(
        "/api/reports/templates/tpl-1/edit/stream",
        json={
            "instruction": "Now sort it by amount",
            "messages": history,
            "model_family": "claude-sonnet-5",
        },
    )

    sent = fake.last_call("POST", "/api/report-templates/tpl-1/layout/stream").body
    assert sent["instruction"] == "Now sort it by amount"
    # Without the prior turns, a follow-up like "undo that" has nothing to undo.
    assert sent["messages"] == history
    assert sent["conversation_mode"] is True
    assert sent["model_family"] == "claude-sonnet-5"


def test_a_missing_conversation_is_sent_as_empty(api, fake):
    fake.on("POST", "/api/report-templates/tpl-1/layout/stream", chunks=[EDIT_SSE])

    api.post(
        "/api/reports/templates/tpl-1/edit/stream",
        json={"instruction": "Sort it", "messages": "not a list"},
    )

    assert fake.last_call("POST", "/api/report-templates/tpl-1/layout/stream").body[
        "messages"
    ] == []


@pytest.mark.parametrize("body", [{}, {"instruction": "   "}, {"messages": []}])
def test_an_edit_needs_an_instruction(api, fake, body):
    resp = api.post("/api/reports/templates/tpl-1/edit/stream", json=body)

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/api/report-templates/tpl-1/layout/stream")


def test_an_edit_failure_arrives_as_json(api, fake):
    fake.on(
        "POST",
        "/api/report-templates/tpl-1/layout/stream",
        {"error": "The report agent is unavailable"},
        status=503,
    )

    resp = api.post(
        "/api/reports/templates/tpl-1/edit/stream", json={"instruction": "Sort it"}
    )

    # An empty 200 stream would read as an edit that silently did nothing.
    assert resp.status_code == 503
    assert resp.get_json()["error"] == "The report agent is unavailable"


# ===========================================================================
# Snapshots
# ===========================================================================

SNAPSHOT_ROWS = [
    {
        "_id": "att-1",
        "record_id": "report_1",
        "filename": "Rent_Roll_20260811_055342.html",
        "description": "AI-generated report: Rent Roll (2026-08-11 05:53)",
        "content_type": "text/html",
        "tags": ["ai-report", "auto-generated"],
        "created_at": "2026-08-11T05:53:42Z",
    },
    {
        # The regeneratable source behind the render above — machinery, not a
        # second report, so it must not appear in the library.
        "_id": "att-2",
        "record_id": "report_1",
        "filename": "Rent_Roll_20260811_055342.source.html",
        "description": "Source HTML for AI report: Rent Roll",
        "content_type": "text/html",
        "tags": ["ai-report-source", "auto-generated"],
        "created_at": "2026-08-11T05:53:42Z",
    },
]


def test_only_the_rendered_snapshot_is_listed(api, fake):
    fake.on_sql("_System._attachments", rows=SNAPSHOT_ROWS)

    body = api.get("/api/reports/snapshots").get_json()

    assert body["count"] == 1
    assert body["snapshots"][0]["attachment_id"] == "att-1"
    assert body["snapshots"][0]["name"] == "Rent Roll"
    assert body["snapshots"][0]["from_template"] is False


def test_a_snapshot_rendered_from_a_template_says_so(api, fake):
    row = dict(SNAPSHOT_ROWS[0], tags=["ai-report", "template-rendered"])
    fake.on_sql("_System._attachments", rows=[row])

    body = api.get("/api/reports/snapshots").get_json()

    # The library hides these when the live template still exists — the same
    # report twice is confusing, and the live one is the canonical copy.
    assert body["snapshots"][0]["from_template"] is True


def test_a_non_html_attachment_is_not_a_report(api, fake):
    row = dict(SNAPSHOT_ROWS[0], content_type="application/pdf")
    fake.on_sql("_System._attachments", rows=[row])

    assert api.get("/api/reports/snapshots").get_json()["count"] == 0


@pytest.mark.parametrize(
    "description,filename,expected",
    [
        ("AI-generated report: Vacancy (2026-08-11 05:53)", "x.html", "Vacancy"),
        (
            "Report rendered from template 'Owner Statement' (2026-01-01)",
            "x.html",
            "Owner Statement",
        ),
        ("", "Rent_Roll_20260811_055342.html", "Rent Roll"),
        ("", "Rent_Roll_20260811_055342.source.html", "Rent Roll"),
        (None, None, "Report"),
    ],
)
def test_a_snapshots_title_is_recovered_from_what_the_agent_wrote(
    description, filename, expected
):
    assert _snapshot_name(description, filename) == expected


def test_a_snapshot_delete_takes_its_source_with_it(api, fake):
    fake.on_sql("record_id", rows=[{"_id": "att-1"}, {"_id": "att-2"}])
    fake.on(
        "DELETE",
        lambda c: c.path.startswith("/attach/_System/AIReports/"),
        {"ok": True},
    )

    body = api.delete("/api/reports/snapshots/report_1").get_json()

    assert body["deleted"] == 2
    assert len(fake.calls_to("DELETE")) == 2


def test_one_stubborn_attachment_does_not_abandon_the_rest(api, fake):
    fake.on_sql("record_id", rows=[{"_id": "att-1"}, {"_id": "att-2"}])
    fake.on("DELETE", "/attach/_System/AIReports/report_1/att-1", {"error": "locked"}, status=409)
    fake.on("DELETE", "/attach/_System/AIReports/report_1/att-2", {"ok": True})

    body = api.delete("/api/reports/snapshots/report_1").get_json()

    assert body["deleted"] == 1


def test_fetching_a_snapshots_html_goes_through_the_token(api, fake):
    # A plain <a href> can't carry the bearer, so the bytes are proxied.
    fake.on(
        "GET",
        "/attach/_System/AIReports/report_1/att-1/download",
        raw="<h1>Rent Roll</h1>",
    )

    body = api.get("/api/reports/snapshots/report_1/att-1").get_json()

    assert body == {"html": "<h1>Rent Roll</h1>"}


def test_promoting_a_snapshot_returns_the_new_template(api, fake):
    fake.on(
        "POST",
        "/api/report-templates/promote-from-report",
        {"ok": True, "data": {"id": "tpl-new"}},
    )

    body = api.post(
        "/api/reports/snapshots/report_1/att-1/promote", json={"name": "Rent Roll"}
    ).get_json()

    assert body == {"ok": True, "id": "tpl-new"}
    assert fake.last_call("POST", "/api/report-templates/promote-from-report").body == {
        "recordId": "report_1",
        "attachmentId": "att-1",
        "name": "Rent Roll",
    }


# ===========================================================================
# Authentication
# ===========================================================================


@pytest.mark.parametrize(
    "method,path",
    [
        ("PUT", "/api/reports/templates/tpl-1"),
        ("DELETE", "/api/reports/templates/tpl-1"),
        ("POST", "/api/reports/templates/tpl-1/edit/stream"),
        ("GET", "/api/reports/snapshots"),
        ("GET", "/api/reports/snapshots/report_1/att-1"),
        ("DELETE", "/api/reports/snapshots/report_1"),
        ("POST", "/api/reports/snapshots/report_1/att-1/promote"),
    ],
)
def test_authoring_needs_a_bearer_token(api, fake, method, path):
    resp = api._open(method, path, token=None, json={})

    assert resp.status_code == 401
    assert not fake.calls
