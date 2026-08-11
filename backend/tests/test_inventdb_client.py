"""``app.inventdb.InventDBClient`` — URL construction and response parsing.

Everything the backend knows about InventDB is encoded here: which path each
operation hits, which calls carry the bearer token, and how an upstream failure
is turned into an :class:`ApiError`. The routers are only as correct as this is.
"""

from __future__ import annotations

import pytest
import requests

from app.errors import ApiError
from app.inventdb import InventDBClient, _safe_id, _safe_ident

TOKEN = "jwt-abc"


@pytest.fixture
def db(fake) -> InventDBClient:
    """An authenticated client wired to the fake transport."""
    return InventDBClient(token=TOKEN)


@pytest.fixture
def anon(fake) -> InventDBClient:
    return InventDBClient(token=None)


# ===========================================================================
# Identifier guards
# ===========================================================================


@pytest.mark.parametrize("value", ["pms", "_x", "work_orders", "A9"])
def test_safe_ident_accepts_identifiers(value):
    assert _safe_ident(value) == value


@pytest.mark.parametrize(
    "value",
    ["", "1x", "a-b", "a.b", "a/b", "../etc", "a b", "a\n", None, 7, "pms;DROP"],
)
def test_safe_ident_rejects_everything_else(value):
    with pytest.raises(ApiError) as exc:
        _safe_ident(value)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "value",
    ["abc", "9f3c-11ee-8c90-0242ac120002", "A_b-9", "x", "y" * 128],
)
def test_safe_id_accepts_uuid_shaped_values(value):
    assert _safe_id(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "",
        "z" * 129,  # length cap
        "../../api/auth/me",
        "abc/def",
        "abc?admin=1",
        "abc#frag",
        "a b",
        "abc\n",
        "abc%2f",
        None,
        7,
    ],
)
def test_safe_id_rejects_anything_that_could_escape_a_path_segment(value):
    with pytest.raises(ApiError) as exc:
        _safe_id(value)
    assert exc.value.status_code == 400


# ===========================================================================
# Headers and transport
# ===========================================================================


def test_authenticated_calls_carry_the_bearer_token(db, fake):
    db.me()
    assert fake.calls[0].headers["Authorization"] == f"Bearer {TOKEN}"


def test_calls_declare_json_content_and_accept(db, fake):
    db.me()
    headers = fake.calls[0].headers
    assert headers["Content-Type"] == "application/json"
    assert headers["Accept"] == "application/json"


def test_an_authenticated_call_without_a_token_is_a_401_before_any_request(anon, fake):
    with pytest.raises(ApiError) as exc:
        anon.me()
    assert exc.value.status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "operation",
    [
        lambda c: c.login("u", "p"),
        lambda c: c.forgot_password("a@b.c"),
        lambda c: c.health(),
    ],
)
def test_public_endpoints_work_without_a_token(anon, fake, operation):
    operation(anon)
    assert "Authorization" not in fake.calls[0].headers


def test_a_transport_failure_becomes_a_502_naming_the_instance(db, fake):
    fake.on("GET", "/api/auth/me", error=requests.ConnectionError("refused"))

    with pytest.raises(ApiError) as exc:
        db.me()

    assert exc.value.status_code == 502
    assert "https://inventdb.test" in str(exc.value.detail)
    assert "refused" in str(exc.value.detail)


@pytest.mark.parametrize(
    "exc_type",
    [requests.Timeout, requests.ConnectionError, requests.TooManyRedirects],
)
def test_every_requests_failure_mode_maps_to_502(db, fake, exc_type):
    fake.on("GET", "/api/auth/me", error=exc_type("boom"))
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.status_code == 502


def test_the_configured_timeout_is_applied(db):
    assert db.timeout == 5.0  # INVENTDB_TIMEOUT, pinned in conftest


# ===========================================================================
# Response parsing
# ===========================================================================


def test_a_json_body_is_returned_as_is(db, fake):
    fake.on("GET", "/api/auth/me", {"username": "rohan", "role": "manager"})
    assert db.me() == {"username": "rohan", "role": "manager"}


def test_an_empty_body_becomes_none(db, fake):
    fake.on("DELETE", "/db/pms/properties/abc", empty=True)
    assert db.delete_record("properties", "abc") is None


def test_a_non_json_success_body_is_returned_as_text(db, fake):
    fake.on("GET", "/api/auth/me", raw="plain text")
    assert db.me() == "plain text"


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"error": "Invalid credentials"}, "Invalid credentials"),
        ({"detail": "Nope"}, "Nope"),
        ({"error": None, "detail": "fallback"}, "fallback"),
        ({"message": "odd shape"}, {"message": "odd shape"}),  # whole body
    ],
)
def test_error_bodies_are_unwrapped_to_the_useful_field(db, fake, payload, expected):
    fake.on("GET", "/api/auth/me", payload, status=400)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.detail == expected


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 422, 500, 503])
def test_the_upstream_status_is_preserved(db, fake, status):
    fake.on("GET", "/api/auth/me", {"error": "x"}, status=status)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.status_code == status


def test_a_non_json_error_body_falls_back_to_the_raw_text(db, fake):
    fake.on("GET", "/api/auth/me", raw="<html>502 Bad Gateway</html>", status=502)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.detail == "<html>502 Bad Gateway</html>"


def test_an_empty_error_body_falls_back_to_the_status_code(db, fake):
    fake.on("GET", "/api/auth/me", raw="", status=503)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.detail == "InventDB returned 503"


def test_a_json_array_error_body_still_surfaces_the_upstream_status(db, fake):
    """`_parse` reads the error body with `.get()`, which a JSON *array* does
    not have. Catching the AttributeError alongside ValueError keeps the real
    upstream status instead of letting it surface as an internal 500."""
    fake.on("GET", "/api/auth/me", [{"field": "username", "msg": "required"}], status=422)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.status_code == 422
    # Falls back to the raw text, so the upstream detail is not simply dropped.
    assert "username" in str(exc.value.detail)


def test_plan_validation_issues_ride_along_with_the_error(db, fake):
    """InventDB rejects a bad plan with 400 + `issues` naming the step at
    fault. The message alone ("plan validation failed") cannot say which step,
    so the array is carried on the error and re-emitted in the JSON body."""
    fake.on(
        "POST",
        "/api/workflows",
        {
            "ok": False,
            "error": "plan validation failed",
            "issues": [{"step_idx": 1, "severity": "error", "message": "unknown template"}],
        },
        status=400,
    )

    with pytest.raises(ApiError) as exc:
        db.create_workflow({"name": "x"})

    assert exc.value.detail == "plan validation failed"
    assert exc.value.to_dict()["issues"] == [
        {"step_idx": 1, "severity": "error", "message": "unknown template"}
    ]


def test_an_error_body_cannot_dress_a_failure_up_as_a_success(db, fake):
    """`extra` is merged *under* `ok`/`error`, so an upstream body that happens
    to carry those keys cannot flip the response the client sees."""
    fake.on("GET", "/api/auth/me", {"error": "nope", "issues": [{"ok": True}]}, status=400)
    with pytest.raises(ApiError) as exc:
        db.me()
    assert exc.value.to_dict()["ok"] is False


# ===========================================================================
# Auth endpoints
# ===========================================================================


def test_login_posts_credentials_to_the_login_endpoint(anon, fake):
    anon.login("rohan", "hunter2")
    call = fake.last_call("POST", "/api/auth/login")
    assert call.body == {"username": "rohan", "password": "hunter2"}


def test_me_scopes_the_lookup_to_this_app(db, fake):
    db.me()
    assert fake.last_call("GET", "/api/auth/me").params == {"app": "pms"}


def test_change_password_uses_snake_case_field_names(db, fake):
    db.change_password("old", "new")
    assert fake.last_call("POST", "/api/auth/change-password").body == {
        "current_password": "old",
        "new_password": "new",
    }


def test_forgot_password_sends_only_the_email(anon, fake):
    anon.forgot_password("a@b.c")
    assert fake.last_call("POST", "/api/auth/forgot-password").body == {"email": "a@b.c"}


# ===========================================================================
# Discovery
# ===========================================================================


def test_list_types_requests_metadata_for_the_namespace(db, fake):
    db.list_types()
    call = fake.last_call("GET", "/api/namespaces/pms/types")
    assert call.params == {"metadata": "true"}


def test_relationships_is_namespace_scoped(db, fake):
    db.relationships()
    assert fake.last_call("GET", "/api/relationships/pms")


# ===========================================================================
# Record endpoints
# ===========================================================================


def test_record_paths_are_namespace_and_type_qualified(db, fake):
    db.get_record("properties", "abc")
    assert fake.calls[-1].path == "/db/pms/properties/abc"


@pytest.mark.parametrize(
    "operation,method,path",
    [
        (lambda c: c.create_record("properties", {"a": 1}), "POST", "/db/pms/properties"),
        (lambda c: c.update_record("properties", {"a": 1}), "PUT", "/db/pms/properties"),
        (lambda c: c.delete_record("properties", "abc"), "DELETE", "/db/pms/properties/abc"),
    ],
)
def test_write_operations_hit_the_documented_endpoints(db, fake, operation, method, path):
    operation(db)
    assert fake.calls[-1].method == method
    assert fake.calls[-1].path == path


@pytest.mark.parametrize("type_name", ["../secrets", "a b", "pms.users", "", "1x"])
def test_an_invalid_type_name_is_rejected_before_the_request(db, fake, type_name):
    with pytest.raises(ApiError) as exc:
        db.get_record(type_name, "abc")
    assert exc.value.status_code == 400
    assert fake.calls == []


@pytest.mark.parametrize(
    "record_id,leak",
    [
        ("abc?disableIndexing=true", "?"),
        ("abc#truncated", "#"),
        ("abc def", " "),
    ],
)
@pytest.mark.xfail(
    reason=(
        "KNOWN GAP: record ids are interpolated into the upstream URL without "
        "passing through `_safe_id`, so a caller controls characters that change "
        "the request — `?` appends query parameters to the internal API call, `#` "
        "truncates the path. `_safe_id` already exists and rejects all of them; "
        "it is simply not applied to record ids (only to report-template ids). "
        "Path traversal via %2f is separately blocked by Werkzeug's router."
    ),
)
def test_record_ids_should_be_validated_like_template_ids(db, fake, record_id, leak):
    with pytest.raises(ApiError):
        db.get_record("properties", record_id)


def test_bulk_insert_targets_the_bulk_endpoint(db, fake):
    db.bulk_insert("properties", [{"a": 1}, {"a": 2}])
    call = fake.last_call("POST", "/api/pms/properties/bulk")
    assert call.params == {"disableIndexing": "false"}
    assert call.body == [{"a": 1}, {"a": 2}]


def test_delete_by_filter_wraps_the_filter(db, fake):
    db.delete_by_filter("properties", {"city": "Mumbai"})
    assert fake.last_call("POST", "/api/pms/properties/delete").body == {
        "filter": {"city": "Mumbai"}
    }


def test_truncate_requires_the_confirmation_token(db, fake):
    """A destructive call that InventDB gates behind an explicit confirmation —
    the client must send it, and must not send it anywhere else."""
    db.truncate("properties")
    assert fake.last_call("POST", "/api/pms/properties/deleteAll").body == {
        "confirm": "CONFIRM"
    }


def test_filter_records_posts_to_the_query_endpoint(db, fake):
    db.filter_records("properties", {"where": {"city": "Mumbai"}})
    assert fake.last_call("POST", "/query/pms/properties/filter").body == {
        "where": {"city": "Mumbai"}
    }


# ===========================================================================
# SQL
# ===========================================================================


def test_sql_posts_the_statement_and_asks_for_metrics(db, fake):
    db.sql("SELECT 1")
    call = fake.last_call("POST", "/sql")
    assert call.body == {"sql": "SELECT 1"}
    assert call.params == {"metrics": "1"}


def test_sql_passes_through_a_result_that_already_has_rows(db, fake):
    fake.on_sql(payload={"rows": [{"a": 1}], "metrics": {"count": 1}})
    assert db.sql("SELECT 1") == {"rows": [{"a": 1}], "metrics": {"count": 1}}


def test_a_bare_list_result_is_wrapped_in_the_rows_envelope(db, fake):
    """Some InventDB builds return the rows directly rather than an envelope."""
    fake.on_sql(payload=[{"a": 1}, {"a": 2}])
    assert db.sql("SELECT 1") == {"rows": [{"a": 1}, {"a": 2}], "metrics": {"count": 2}}


@pytest.mark.parametrize("payload", [None, "text", {"unexpected": True}, 42])
def test_an_unrecognised_result_shape_becomes_an_empty_result_set(db, fake, payload):
    fake.on_sql(payload=payload)
    assert db.sql("SELECT 1") == {"rows": [], "metrics": {}}


def test_query_rows_swallows_sql_errors(db, fake):
    """A type that does not exist yet is an SQL error on a fresh instance. The
    dashboard renders zeroes rather than failing, which is what makes an empty
    namespace usable."""
    fake.on_sql(status=500, payload={"error": "no such table: pms.properties"})
    assert db.query_rows("SELECT * FROM pms.properties") == []


def test_query_rows_treats_a_null_rows_field_as_empty(db, fake):
    fake.on_sql(payload={"rows": None})
    assert db.query_rows("SELECT 1") == []


# ===========================================================================
# The {ok, data} success envelope
# ===========================================================================


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"ok": True, "data": {"templates": []}}, {"templates": []}),
        ({"ok": True, "data": [1, 2]}, [1, 2]),
        # `data` must be a dict or list to be unwrapped — a scalar stays wrapped,
        # which is what keeps `render`'s bare `{html: ...}` reply intact.
        ({"ok": True, "data": "html"}, {"ok": True, "data": "html"}),
        ({"ok": False, "data": {}}, {"ok": False, "data": {}}),
        ({"templates": []}, {"templates": []}),  # already bare
        (None, None),
    ],
)
def test_unwrap_peels_the_success_envelope_only_when_it_is_really_there(
    db, fake, payload, expected
):
    fake.on("GET", "/api/report-templates", payload)
    assert db.list_report_templates() == expected


# ===========================================================================
# Report templates
# ===========================================================================


def test_report_templates_live_outside_the_namespace(db, fake):
    """They are instance-level (`_System.ReportTemplates`), so the path carries
    no namespace — the same set the SOAR Report room lists."""
    db.list_report_templates()
    assert fake.calls[-1].path == "/api/report-templates"


def test_get_report_template_validates_the_id(db, fake):
    with pytest.raises(ApiError) as exc:
        db.get_report_template("../../api/auth/me")
    assert exc.value.status_code == 400
    assert fake.calls == []


def test_render_asks_for_real_charts_not_the_email_safe_fallback(db, fake):
    """`email_safe_charts=False` is what gets SVG charts instead of the
    HTML-table fallback the POST endpoint defaults to."""
    db.render_report_template("tpl-1", {"owner_id": "O-1"})

    call = fake.last_call("POST", "/api/report-templates/tpl-1/render")
    assert call.body == {"params": {"owner_id": "O-1"}, "email_safe_charts": False}


def test_render_sends_an_empty_param_map_when_given_none(db, fake):
    db.render_report_template("tpl-1")
    assert fake.calls[-1].body["params"] == {}


def test_render_validates_the_template_id(db, fake):
    with pytest.raises(ApiError):
        db.render_report_template("tpl/../..")
    assert fake.calls == []


# ===========================================================================
# Workflows
# ===========================================================================


def test_listing_workflows_excludes_deleted_ones(db, fake):
    db.list_workflows()
    assert fake.last_call("GET", "/api/workflows").params == {"include_deleted": "false"}


@pytest.mark.parametrize(
    "operation,path",
    [
        (lambda c: c.get_workflow("wf-1"), "/api/workflows/wf-1"),
        (lambda c: c.list_runs(), "/api/workflows/runs"),
        (lambda c: c.list_workflow_runs("wf-1"), "/api/workflows/wf-1/runs"),
        (lambda c: c.get_run("run-1"), "/api/workflows/runs/run-1"),
    ],
)
def test_workflow_read_paths(db, fake, operation, path):
    operation(db)
    assert fake.calls[-1].path == path
