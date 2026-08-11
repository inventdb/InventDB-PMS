"""``app.routers.analyze`` — the seam onto InventDB's AI agent.

This blueprint decides very little, and that is the point: InventDB owns the
agent, its tools and its row-level security. What it *does* decide is worth
protecting, because each choice is a boundary:

  * the agent's namespace is pinned server-side, so a question cannot be steered
    at another tenant's data;
  * `/sql` is for the interface's own read-back and refuses anything else;
  * a change-set is forced into this app's namespace whatever the model authored;
  * the chat stream is relayed byte-for-byte, and a pre-stream failure comes back
    as JSON rather than as an empty stream the UI would render as a silent turn.

The rest is envelope handling, which InventDB varies by endpoint.
"""

from __future__ import annotations

import io

import pytest

from tests.conftest import NAMESPACE

SSE = (
    b'event: message\ndata: {"type":"info","content":"Analyzing"}\n\n'
    b'event: message\ndata: {"type":"done","content":"46 active leases."}\n\n'
)


# ===========================================================================
# The agent stream
# ===========================================================================


def test_stream_is_relayed_verbatim(api, fake):
    fake.on("POST", "/ai/chat/stream", chunks=[SSE[:40], SSE[40:]])

    resp = api.post(
        "/api/analyze/chat/stream",
        json={"messages": [{"role": "user", "content": "How many active leases?"}]},
    )

    assert resp.status_code == 200
    assert resp.mimetype == "text/event-stream"
    # Byte-identical: the frontend parses InventDB's own frames, so anything
    # this layer rewrote would be a bug the UI could not recover from.
    assert resp.get_data() == SSE


def test_stream_does_not_buffer(api, fake):
    fake.on("POST", "/ai/chat/stream", chunks=[SSE])

    resp = api.post(
        "/api/analyze/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}
    )

    # Without this, a proxy holds the whole turn and delivers it in one lump at
    # the end — the room would show nothing happening for minutes, then all of
    # it at once.
    assert resp.headers["X-Accel-Buffering"] == "no"
    assert resp.headers["Cache-Control"] == "no-cache"


def test_stream_never_sets_a_hop_by_hop_header(api, fake):
    fake.on("POST", "/ai/chat/stream", chunks=[SSE])

    resp = api.post(
        "/api/analyze/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}
    )

    # WSGI forbids the application from sending these, and waitress rejects the
    # whole response if it does — which surfaced as a blanket 500 on every turn.
    assert "Connection" not in resp.headers
    assert "Keep-Alive" not in resp.headers


def test_namespace_is_pinned_by_the_server(api, fake):
    fake.on("POST", "/ai/chat/stream", chunks=[SSE])

    api.post(
        "/api/analyze/chat/stream",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            # A caller trying to point the agent somewhere else.
            "namespace": "another_tenant",
        },
    )

    assert fake.last_call("POST", "/ai/chat/stream").body["namespace"] == NAMESPACE


def test_message_options_are_forwarded(api, fake):
    fake.on("POST", "/ai/chat/stream", chunks=[SSE])

    api.post(
        "/api/analyze/chat/stream",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "model_family": "claude-opus-4-8",
            "time_zone": "America/New_York",
            "focusedReportId": "tpl-9",
        },
    )

    body = fake.last_call("POST", "/ai/chat/stream").body
    assert body["model_family"] == "claude-opus-4-8"
    assert body["time_zone"] == "America/New_York"
    assert body["focusedReportId"] == "tpl-9"
    assert body["stream"] is True
    # Without conversation mode the agent treats every follow-up as a new chat.
    assert body["conversation_mode"] is True


def test_a_failure_before_the_stream_opens_is_json(api, fake):
    fake.on("POST", "/ai/chat/stream", {"error": "Anthropic credits exhausted"}, status=503)

    resp = api.post(
        "/api/analyze/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]}
    )

    # An empty 200 SSE stream would render as a turn that silently did nothing.
    assert resp.status_code == 503
    assert resp.get_json() == {"ok": False, "error": "Anthropic credits exhausted"}


@pytest.mark.parametrize("body", [{}, {"messages": []}, {"messages": "hello"}])
def test_a_turn_needs_messages(api, fake, body):
    resp = api.post("/api/analyze/chat/stream", json=body)

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/ai/chat/stream")


# ===========================================================================
# Read-only SQL
# ===========================================================================


def test_select_reaches_inventdb(api, fake):
    fake.on_sql("FROM pms.properties", rows=[{"_id": "p-1"}])

    body = api.post(
        "/api/analyze/sql", json={"sql": "SELECT _id FROM pms.properties LIMIT 1"}
    ).get_json()

    assert body["rows"] == [{"_id": "p-1"}]
    assert fake.only_sql() == "SELECT _id FROM pms.properties LIMIT 1"


def test_a_trailing_semicolon_is_fine(api, fake):
    fake.on_sql(rows=[])

    api.post("/api/analyze/sql", json={"sql": "SELECT 1;"})

    assert fake.only_sql() == "SELECT 1"


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM pms.properties",
        "UPDATE pms.leases SET rent = 0",
        "DROP TABLE pms.vendors",
        "INSERT INTO pms.vendors (company) VALUES ('x')",
        "  \n TRUNCATE pms.vendors",
    ],
)
def test_writes_are_refused(api, fake, statement):
    resp = api.post("/api/analyze/sql", json={"sql": statement})

    assert resp.status_code == 403
    assert not fake.sql_log


def test_a_second_statement_is_refused(api, fake):
    # The classic way past a prefix check: a legitimate SELECT, then the payload.
    resp = api.post(
        "/api/analyze/sql", json={"sql": "SELECT 1; DROP TABLE pms.vendors"}
    )

    assert resp.status_code == 400
    assert not fake.sql_log


def test_an_empty_statement_is_refused(api, fake):
    assert api.post("/api/analyze/sql", json={"sql": "   "}).status_code == 400
    assert not fake.sql_log


def test_an_oversized_statement_is_refused(api, fake):
    resp = api.post("/api/analyze/sql", json={"sql": "SELECT " + "x" * 20_001})

    assert resp.status_code == 400
    assert not fake.sql_log


# ===========================================================================
# Applying a proposed change
# ===========================================================================


def test_change_set_is_forced_into_this_namespace(api, fake):
    fake.on("POST", "/ai/change-set/apply", {"ok": True, "data": {"results": []}})

    api.post(
        "/api/analyze/change-set/apply",
        json={
            "title": "Add a vendor",
            "steps": [
                {
                    "op": "insert",
                    # Whatever the model authored, the target is this app's.
                    "namespace": "somewhere_else",
                    "typeName": "vendors",
                    "fields": {"company": "Blue Ridge"},
                }
            ],
        },
    )

    step = fake.last_call("POST", "/ai/change-set/apply").body["steps"][0]
    assert step["namespace"] == NAMESPACE
    assert step["typeName"] == "vendors"


def test_change_set_results_are_unwrapped(api, fake):
    results = [{"ok": True, "recordId": "v-9"}]
    fake.on("POST", "/ai/change-set/apply", {"ok": True, "data": {"results": results}})

    body = api.post(
        "/api/analyze/change-set/apply",
        json={"steps": [{"op": "insert", "typeName": "vendors", "fields": {}}]},
    ).get_json()

    assert body == {"ok": True, "results": results}


@pytest.mark.parametrize(
    "step",
    [
        {"op": "insert", "typeName": "_System"},  # a system table
        {"op": "insert", "typeName": "pms.vendors"},  # a dotted escape attempt
        {"op": "insert", "typeName": ""},
        {"op": "wipe", "typeName": "vendors"},  # not an operation we forward
    ],
)
def test_a_change_set_step_that_isnt_a_business_write_is_refused(api, fake, step):
    resp = api.post("/api/analyze/change-set/apply", json={"steps": [step]})

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/ai/change-set/apply")


@pytest.mark.parametrize("body", [{}, {"steps": []}, {"steps": {}}])
def test_a_change_set_needs_steps(api, fake, body):
    assert api.post("/api/analyze/change-set/apply", json=body).status_code == 400
    assert not fake.calls_to("POST", "/ai/change-set/apply")


# ===========================================================================
# Single-record applies
# ===========================================================================


def test_create_record_strips_internal_fields(api, fake):
    fake.on("POST", f"/db/{NAMESPACE}/vendors", {"id": "v-1"})

    body = api.post(
        "/api/analyze/records/vendors",
        json={"company": "Blue Ridge", "_id": "spoofed", "_createdBy": "someone"},
    ).get_json()

    assert body == {"ok": True, "recordId": "v-1", "type": "vendors"}
    assert fake.last_call("POST", f"/db/{NAMESPACE}/vendors").body == {
        "company": "Blue Ridge"
    }


def test_update_merges_over_the_stored_document(api, fake):
    # Fields the card never showed must survive the save, whether InventDB's PUT
    # replaces or merges.
    fake.on_record("vendors", "v-1", {"_id": "v-1", "company": "Old", "trade": "Roofing"})
    fake.on("PUT", f"/db/{NAMESPACE}/vendors", {"ok": True})

    api.put("/api/analyze/records/vendors/v-1", json={"company": "New"})

    sent = fake.last_call("PUT", f"/db/{NAMESPACE}/vendors").body
    assert sent == {"_id": "v-1", "company": "New", "trade": "Roofing"}


@pytest.mark.parametrize("type_name", ["_System", "9lives", "with-dash"])
def test_a_non_business_type_is_refused(api, fake, type_name):
    assert api.post(f"/api/analyze/records/{type_name}", json={}).status_code == 400
    assert not fake.calls_to("POST")


# ===========================================================================
# Threads, models and the web-search gate
# ===========================================================================


def test_threads_are_read_from_inventdbs_own_store(api, fake):
    stored = [{"_id": "t-1", "label": "Rent roll", "_exchanges": []}]
    fake.on("GET", "/ai/threads", {"ok": True, "threads": stored})

    assert api.get("/api/analyze/threads").get_json() == {"threads": stored}


def test_saving_a_thread_caps_the_label(api, fake):
    fake.on("PUT", "/ai/threads", {"ok": True})

    api.put(
        "/api/analyze/threads",
        json={"id": "t-1", "label": "x" * 200, "created": "", "exchanges": []},
    )

    assert len(fake.last_call("PUT", "/ai/threads").body["label"]) == 80


@pytest.mark.parametrize(
    "body",
    [{"exchanges": []}, {"id": "  ", "exchanges": []}, {"id": "t-1"}, {"id": "t-1", "exchanges": {}}],
)
def test_an_ill_formed_thread_is_refused(api, fake, body):
    assert api.put("/api/analyze/threads", json=body).status_code == 400
    assert not fake.calls_to("PUT", "/ai/threads")


def test_config_does_not_leak_the_provider_credentials(api, fake):
    fake.on(
        "GET",
        "/ai/config",
        {
            "configured": True,
            "model": "claude-sonnet-5",
            "modelFamily": "claude",
            "maskedKey": "2BVN...GchL",
            "baseUrl": "http://ai-gateway.inventdb.local:4300",
        },
    )

    body = api.get("/api/analyze/config").get_json()

    assert body == {
        "configured": True,
        "model": "claude-sonnet-5",
        "modelFamily": "claude",
    }


def test_models_are_returned_as_a_list(api, fake):
    models = [{"key": "claude-sonnet-5", "display": "Claude Sonnet 5"}]
    fake.on("GET", "/ai/models", models)

    assert api.get("/api/analyze/models").get_json() == {"models": models}


@pytest.mark.parametrize("action,enabled", [("enable", True), ("disable", False)])
def test_the_web_search_gate_is_the_instances_own_flag(api, fake, action, enabled):
    fake.on("POST", f"/api/websearch/{action}", {"ok": True})

    body = api.post(f"/api/analyze/websearch/{action}").get_json()

    assert body == {"ok": True, "enabled": enabled}
    assert fake.calls_to("POST", f"/api/websearch/{action}")


def test_an_unknown_web_search_action_is_a_404(api, fake):
    assert api.post("/api/analyze/websearch/wipe").status_code == 404
    assert not fake.calls_to("POST")


def test_web_search_status_is_coerced_to_booleans(api, fake):
    fake.on("GET", "/api/websearch/status", {"enabled": 1, "consented_at": 123})

    assert api.get("/api/analyze/websearch/status").get_json() == {
        "enabled": True,
        "consented": False,
    }


# ===========================================================================
# Staged AI inputs
# ===========================================================================


def test_staging_a_file_forwards_it_as_multipart(api, fake):
    fake.on("POST", "/ai/uploads/stage", {"pending_id": "pend-1", "filename": "lease.pdf"})

    body = api.post(
        "/api/analyze/uploads/stage",
        data={"file": (io.BytesIO(b"%PDF-1.7 lease"), "lease.pdf")},
        content_type="multipart/form-data",
    ).get_json()

    assert body["pending_id"] == "pend-1"


def test_staging_needs_a_file(api, fake):
    resp = api.post(
        "/api/analyze/uploads/stage", data={}, content_type="multipart/form-data"
    )

    assert resp.status_code == 400
    assert not fake.calls_to("POST", "/ai/uploads/stage")


def test_an_oversized_upload_is_refused(api, fake):
    resp = api.post(
        "/api/analyze/uploads/stage",
        data={"file": (io.BytesIO(b"x" * (25 * 1024 * 1024 + 1)), "big.bin")},
        content_type="multipart/form-data",
    )

    assert resp.status_code == 413
    assert not fake.calls_to("POST", "/ai/uploads/stage")


# ===========================================================================
# Authentication
# ===========================================================================


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/analyze/chat/stream"),
        ("GET", "/api/analyze/threads"),
        ("POST", "/api/analyze/sql"),
        ("GET", "/api/analyze/models"),
        ("POST", "/api/analyze/change-set/apply"),
    ],
)
def test_every_route_needs_a_bearer_token(api, fake, method, path):
    resp = api._open(method, path, token=None, json={})

    assert resp.status_code == 401
    assert not fake.calls
