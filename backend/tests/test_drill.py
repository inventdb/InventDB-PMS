"""``app.routers.drill`` — the records behind a number, and per-record access.

As in ``test_resources``, the drill listing is asserted on the SQL the app sends
upstream: the interesting behaviour is which filter reaches the statement, and
which never may. Access is asserted on the answer, with the upstream calls that
justify it.
"""

from __future__ import annotations

import pytest

from app.errors import ApiError
from app.sqlutil import safe_where


# ===========================================================================
# safe_where: what a WHERE fragment may be
# ===========================================================================


@pytest.mark.parametrize(
    "fragment",
    [
        "status = 'Open'",
        "(status = 'Open' OR priority = 'High') AND actual_cost > 100",
        "YEAR(date_opened) = 2026 AND category IN ('HVAC', 'Plumbing')",
        "t.account_category = 'Late Fee' AND t.date >= '2026-10-01'",
        "memo LIKE '%insurance%'",
        # Keywords inside a string are data, not SQL.
        "party_tenant_vendor = 'O''Drop; Update -- set'",
        "property_id IN (SELECT property_id FROM pms.properties WHERE city = 'Norfolk')",
        "REPLACE(city, ' ', '') = 'VirginiaBeach'",
    ],
)
def test_safe_where_accepts_filters(fragment):
    assert safe_where(fragment) == fragment


@pytest.mark.parametrize(
    "fragment",
    [
        "1=1; DELETE FROM pms.leases",
        "status = 'Open' -- trailing",
        "status = 'Open' /* c */",
        "1=1) UNION ALL SELECT * FROM pms.owners WHERE (1=1",  # unbalanced after the wrap
        "status = 'Open",
        "1=1) OR (1=1",
        "id IN (SELECT 1 INTO x)",
        "x = 1 AND (UPDATE pms.leases SET rent = 0)",
        "DROP TABLE pms.leases",
        "a" * 4001,
    ],
)
def test_safe_where_refuses_anything_but_one_condition(fragment):
    with pytest.raises(ApiError) as err:
        safe_where(fragment)
    assert err.value.status_code == 400


def test_safe_where_treats_blank_as_no_filter():
    assert safe_where("   ") == ""


# ===========================================================================
# POST /api/drill/<entity>
# ===========================================================================


def test_drill_composes_where_filters_order_and_page(api, fake):
    fake.on_sql("COUNT(*)", rows=[{"c": 23}])
    fake.on_sql("SELECT * FROM", rows=[{"_id": "a", "wo": "WO-1"}])

    resp = api.post(
        "/api/drill/work_orders",
        json={"where": "status = 'Open'", "filters": {"category": "HVAC"}, "limit": 10, "offset": 20},
    )

    assert resp.status_code == 200
    assert resp.get_json() == {"items": [{"_id": "a", "wo": "WO-1"}], "total": 23, "limit": 10, "offset": 20}
    assert fake.sql_log == [
        "SELECT * FROM pms.work_orders WHERE (status = 'Open') AND category = 'HVAC' "
        "ORDER BY date_opened ASC LIMIT 10 OFFSET 20",
        "SELECT COUNT(*) AS c FROM pms.work_orders WHERE (status = 'Open') AND category = 'HVAC'",
    ]


def test_drill_keeps_the_query_alias_so_its_where_still_binds(api, fake):
    api.post(
        "/api/drill/transactions",
        json={"alias": "t", "where": "t.type = 'Income'", "order_by": "amount", "order_dir": "desc"},
    )
    assert fake.sql_log[0] == (
        "SELECT * FROM pms.transactions t WHERE (t.type = 'Income') "
        "ORDER BY t.amount DESC LIMIT 10 OFFSET 0"
    )


def test_drill_with_nothing_lists_the_whole_module(api, fake):
    api.post("/api/drill/vendors", json={})
    assert fake.sql_log == [
        "SELECT * FROM pms.vendors ORDER BY company ASC LIMIT 10 OFFSET 0",
        "SELECT COUNT(*) AS c FROM pms.vendors",
    ]


def test_drill_null_filter_becomes_is_null(api, fake):
    api.post("/api/drill/work_orders", json={"filters": {"vendor": None}})
    assert "WHERE vendor IS NULL" in fake.sql_log[0]


def test_drill_escapes_filter_values(api, fake):
    api.post("/api/drill/tenants", json={"filters": {"last": "O'Brien"}})
    assert "WHERE last = 'O''Brien'" in fake.sql_log[0]


def test_drill_clamps_the_page(api, fake):
    api.post("/api/drill/leases", json={"limit": 100000, "offset": -5})
    assert fake.sql_log[0].endswith("LIMIT 200 OFFSET 0")


@pytest.mark.parametrize(
    "body",
    [
        {"where": "1=1; DROP TABLE pms.leases"},
        {"filters": {"bad col": "x"}},
        {"filters": {"x": {"nested": 1}}},
        {"filters": ["x"]},
        {"alias": "t; --"},
        {"order_by": "street; DROP"},
        {"limit": "ten"},
        {"limit": True},
    ],
)
def test_drill_refuses_a_hostile_body_before_any_sql(api, fake, body):
    resp = api.post("/api/drill/leases", json=body)
    assert resp.status_code == 400
    assert fake.sql_log == []


def test_drill_unknown_module_is_404(api, fake):
    assert api.post("/api/drill/payroll", json={}).status_code == 404
    assert fake.sql_log == []


def test_drill_reports_a_failing_query_instead_of_an_empty_page(api, fake):
    """'Nothing behind this number' and 'could not re-run it' must differ."""
    fake.on_sql("SELECT * FROM", status=400, payload={"error": "unknown column cost"})
    resp = api.post("/api/drill/work_orders", json={"where": "cost > 1"})
    assert resp.status_code == 400
    assert "unknown column" in resp.get_json()["error"]


def test_drill_needs_a_token(api, fake):
    assert api.post("/api/drill/leases", json={}, token=None).status_code == 401
    assert fake.calls == []


# ===========================================================================
# GET /api/drill/<entity>/<id>/access
# ===========================================================================

ME = "/api/auth/me"
CHECK = "/api/permissions/check"


def _me(fake, role):
    fake.on("GET", ME, {"ok": True, "user": {"id": "u1", "username": "x", "role": role}})


def test_admin_may_edit_any_visible_record(api, fake):
    fake.on_record("leases", "lease-1", {"_id": "lease-1", "lease_id": "L-7001"})
    _me(fake, "superadmin")

    body = api.get("/api/drill/leases/lease-1/access").get_json()

    assert body["can_view"] is True and body["can_edit"] is True
    assert body["row_rules"] == "bypassed"
    assert fake.calls_to("GET", CHECK) == []  # no grant lookup needed


def test_writer_may_edit_and_is_told_row_rules_apply_on_save(api, fake):
    fake.on_record("leases", "lease-1", {"_id": "lease-1"})
    _me(fake, "user")
    fake.on("GET", CHECK, {"ok": True, "has_permission": True})

    body = api.get("/api/drill/leases/lease-1/access").get_json()

    assert body["can_edit"] is True
    assert body["row_rules"] == "enforced_on_save"
    check = fake.last_call("GET", CHECK)
    assert check.params == {"resource": "pms.leases", "level": "write"}


def test_reader_sees_the_record_but_may_not_edit(api, fake):
    fake.on_record("leases", "lease-1", {"_id": "lease-1"})
    _me(fake, "user")
    fake.on("GET", CHECK, {"ok": True, "has_permission": False})

    body = api.get("/api/drill/leases/lease-1/access").get_json()

    assert body == {
        "can_view": True,
        "can_edit": False,
        "reason": "You can view leases but not change them.",
        "row_rules": "n/a",
    }


def test_grant_answer_wrapped_in_data_is_read_too(api, fake):
    fake.on_record("vendors", "v1", {"_id": "v1"})
    _me(fake, "user")
    fake.on("GET", CHECK, {"ok": True, "data": {"has_permission": True}})
    assert api.get("/api/drill/vendors/v1/access").get_json()["can_edit"] is True


@pytest.mark.parametrize("status", [403, 404])
def test_a_record_hidden_by_row_rules_is_neither_viewable_nor_editable(api, fake, status):
    fake.on_record("leases", "lease-9", {"error": "not found"}, status=status)
    _me(fake, "superadmin")

    body = api.get("/api/drill/leases/lease-9/access").get_json()

    assert body["can_view"] is False and body["can_edit"] is False
    # Never asks about grants for a record it couldn't see.
    assert fake.calls_to("GET", ME) == [] and fake.calls_to("GET", CHECK) == []


@pytest.mark.parametrize("bad", ["abc?x=1", "a b", "..", "a" * 129])
def test_access_refuses_ids_that_could_change_the_upstream_url(api, fake, bad):
    resp = api.get(f"/api/drill/leases/{bad}/access")
    assert resp.status_code in (400, 404)
    assert fake.calls == []


def test_access_on_an_unknown_module_is_404(api, fake):
    assert api.get("/api/drill/payroll/x1/access").status_code == 404
