"""``app.routers.reports`` — SOAR saved reports plus the PMS SQL rollups.

Two very different things share this blueprint. The ``/templates/*`` routes are
a proxy with real logic in front of them (parameter pickers are resolved
concurrently, and the bind-field choice decides whether a rendered report has
any rows at all). The rollups are SQL executed inside InventDB, so what matters
is the exact statement and the post-processing of grouped rows.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.routers.reports import _distribution, _num, _pick_bind_field, _title


# ===========================================================================
# Formatting helpers
# ===========================================================================


@pytest.mark.parametrize(
    "value,expected",
    [
        ("occupied", "Occupied"),
        ("in progress", "In Progress"),
        ("HOA", "HOA"),
        ("hoa", "HOA"),
        ("hoa dues", "HOA Dues"),
        ("hvac repair", "HVAC Repair"),
        ("ach transfer", "ACH Transfer"),
        ("coi renewal", "COI Renewal"),
        ("co inspection", "CO Inspection"),
        ("", "Other"),
        ("   ", "Other"),
        (None, "Other"),
    ],
)
def test_title_restores_case_that_inventdb_lowercases_on_group_by(value, expected):
    """InventDB lowercases string values in a GROUP BY, so labels have to be
    rebuilt — including the acronyms that `.title()` would otherwise mangle
    into "Hoa" and "Hvac"."""
    assert _title(value) == expected


@pytest.mark.parametrize(
    "value,expected", [(None, 0.0), ("", 0.0), ("abc", 0.0), (1.005, 1.0), (1.567, 1.57), ("12.5", 12.5)]
)
def test_num_rounds_to_cents_and_never_raises(value, expected):
    assert _num(value) == expected


def test_distribution_reads_the_dimension_by_its_real_column_name():
    """InventDB ignores `AS` aliases on grouped columns, so the dimension comes
    back under its own name while the aggregate keeps the alias."""
    rows = [{"status": "occupied", "value": 3}, {"status": "vacant", "value": 1}]

    assert _distribution(rows, "status") == [
        {"name": "Occupied", "value": 3},
        {"name": "Vacant", "value": 1},
    ]


def test_distribution_can_carry_money_instead_of_counts():
    rows = [{"account_category": "repairs", "value": "1200.5"}]
    assert _distribution(rows, "account_category", num=True) == [
        {"name": "Repairs", "value": 1200.5}
    ]


def test_distribution_coerces_a_missing_value_to_zero():
    assert _distribution([{"status": "occupied"}], "status") == [
        {"name": "Occupied", "value": 0}
    ]


# ===========================================================================
# Parameter binding
# ===========================================================================


def test_bind_field_prefers_the_business_key_over_the_internal_id():
    """A template's SQL filters on `owner_id`, so binding InventDB's `_id` GUID
    would match nothing and the report would render empty."""
    sample = {"_id": "guid-1", "owner_id": "O-001", "name": "Acme"}
    assert _pick_bind_field(sample) == "owner_id"


@pytest.mark.parametrize(
    "sample,expected",
    [
        ({"_id": "g", "property_id": "P-1"}, "property_id"),
        ({"_id": "g", "tenant_id": 42}, "tenant_id"),  # numeric keys count
        ({"_id": "g", "owner_id": "", "vendor_id": "V-1"}, "vendor_id"),  # empty skipped
        ({"_id": "g", "owner_id": None, "vendor_id": "V-1"}, "vendor_id"),
        ({"_id": "g", "name": "Acme"}, None),  # no business key at all
        ({"_id": "g", "id": "x"}, None),  # `id` is internal too
        ({"_id": "g", "_owner_id": "x"}, None),  # underscore-prefixed skipped
        ({}, None),
        (None, None),
    ],
)
def test_bind_field_selection(sample, expected):
    assert _pick_bind_field(sample) == expected


def test_bind_field_takes_the_first_business_key_in_column_order():
    sample = {"_id": "g", "owner_id": "O-1", "property_id": "P-1"}
    assert _pick_bind_field(sample) == "owner_id"


# ===========================================================================
# Saved report listing
# ===========================================================================


TEMPLATES = [
    {"_id": "t2", "name": "Rent Roll", "category": "Leasing", "mode": "sql", "version": 2},
    {"_id": "t1", "name": "Aged Receivables", "category": "Finance", "createdBy": "rohan"},
    {"_id": "t3", "name": "arrears", "category": "finance"},
]


def test_templates_are_sorted_by_category_then_name_case_insensitively(api, fake):
    fake.on("GET", "/api/report-templates", {"ok": True, "data": {"templates": TEMPLATES}})

    body = api.get("/api/reports/templates").get_json()

    assert [t["name"] for t in body["templates"]] == [
        "Aged Receivables",
        "arrears",  # lowercase sorts with its peers, not after them
        "Rent Roll",
    ]
    assert body["count"] == 3


def test_a_template_without_an_id_is_dropped(api, fake):
    """It could not be opened or rendered, so listing it would be a dead link."""
    fake.on(
        "GET",
        "/api/report-templates",
        {"ok": True, "data": {"templates": [{"name": "orphan"}, {"_id": "t1", "name": "ok"}]}},
    )

    body = api.get("/api/reports/templates").get_json()

    assert [t["id"] for t in body["templates"]] == ["t1"]
    assert body["count"] == 1


def test_listing_fills_in_defaults_for_absent_fields(api, fake):
    fake.on("GET", "/api/report-templates", {"ok": True, "data": {"templates": [{"_id": "t1"}]}})

    entry = api.get("/api/reports/templates").get_json()["templates"][0]

    assert entry == {
        "id": "t1",
        "name": "(untitled report)",
        "description": "",
        "category": "",
        "mode": "",
        "version": None,
        "created_by": "",
    }


@pytest.mark.parametrize(
    "upstream", [{"ok": True, "data": {}}, {"ok": True, "data": {"templates": []}}, None, {}]
)
def test_an_instance_with_no_saved_reports_returns_an_empty_list(api, fake, upstream):
    fake.on("GET", "/api/report-templates", upstream)
    assert api.get("/api/reports/templates").get_json() == {"templates": [], "count": 0}


# ===========================================================================
# Saved report detail and parameter resolution
# ===========================================================================


def test_the_template_html_is_never_sent_to_the_client(api, fake):
    """It is the report *source* — tens of kilobytes the UI never displays,
    since it only ever shows rendered output."""
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "name": "R", "html": "<h1>" + "x" * 5000}},
    )

    body = api.get("/api/reports/templates/t1").get_json()

    assert "html" not in body


def test_parameters_are_normalised_with_defaults(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {
            "ok": True,
            "data": {
                "_id": "t1",
                "name": "R",
                "parameters": [
                    {"name": "as_of", "type": "date", "required": False, "default": "today"},
                    {"name": "bare"},
                ],
            },
        },
    )

    params = api.get("/api/reports/templates/t1").get_json()["parameters"]

    assert params[0] == {
        "name": "as_of",
        "label": "as_of",  # falls back to the name
        "type": "date",
        "required": False,
        "default": "today",
        "options": [],
    }
    assert params[1]["type"] == "text"  # default type
    assert params[1]["required"] is True  # required unless it says otherwise


def test_malformed_parameter_entries_are_skipped(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "parameters": ["not-a-dict", None, {"name": "ok"}]}},
    )

    params = api.get("/api/reports/templates/t1").get_json()["parameters"]

    assert [p["name"] for p in params] == ["ok"]


def test_a_source_backed_parameter_is_resolved_into_dropdown_options(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {
            "ok": True,
            "data": {
                "_id": "t1",
                "parameters": [{"name": "owner", "source": "pms.owners"}],
            },
        },
    )
    fake.on_sql(
        "FROM pms.owners",
        rows=[
            {"_id": "g1", "owner_id": "O-001", "name": "Acme Holdings"},
            {"_id": "g2", "owner_id": "O-002", "name": "Vista Trust"},
        ],
    )

    options = api.get("/api/reports/templates/t1").get_json()["parameters"][0]["options"]

    assert options == [
        {"value": "O-001", "label": "Acme Holdings"},
        {"value": "O-002", "label": "Vista Trust"},
    ]
    assert "SELECT * FROM pms.owners LIMIT 200" in fake.sql_log


def test_an_explicit_bind_field_overrides_the_heuristic(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {
            "ok": True,
            "data": {
                "_id": "t1",
                "parameters": [{"name": "o", "source": "pms.owners", "bindField": "_id"}],
            },
        },
    )
    fake.on_sql("FROM pms.owners", rows=[{"_id": "g1", "owner_id": "O-001", "name": "Acme"}])

    options = api.get("/api/reports/templates/t1").get_json()["parameters"][0]["options"]

    assert options == [{"value": "g1", "label": "Acme"}]


@pytest.mark.parametrize(
    "row,expected_label",
    [
        ({"owner_id": "O-1", "name": "By name"}, "By name"),
        ({"owner_id": "O-1", "title": "By title"}, "By title"),
        ({"owner_id": "O-1", "first_name": "By first"}, "By first"),
        ({"owner_id": "O-1", "label": "By label"}, "By label"),
        ({"owner_id": "O-1", "description": "By description"}, "By description"),
        ({"owner_id": "O-1"}, "O-1"),  # nothing to label with -> the value
        ({"owner_id": "O-1", "name": "", "title": "Skips blanks"}, "Skips blanks"),
    ],
)
def test_option_labels_follow_the_declared_field_preference(api, fake, row, expected_label):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "parameters": [{"name": "o", "source": "pms.owners"}]}},
    )
    fake.on_sql("FROM pms.owners", rows=[row])

    options = api.get("/api/reports/templates/t1").get_json()["parameters"][0]["options"]

    assert options == [{"value": "O-1", "label": expected_label}]


def test_rows_with_no_bindable_value_are_skipped(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "parameters": [{"name": "o", "source": "pms.owners"}]}},
    )
    fake.on_sql(
        "FROM pms.owners",
        rows=[
            {"_id": "g1", "owner_id": "O-1", "name": "Keep"},
            {"_id": "g2", "owner_id": "", "name": "Drop"},
            {"_id": "g3", "owner_id": None, "name": "Drop"},
        ],
    )

    options = api.get("/api/reports/templates/t1").get_json()["parameters"][0]["options"]

    assert [o["label"] for o in options] == ["Keep"]


@pytest.mark.parametrize(
    "source",
    [
        "",
        "owners",  # not namespace-qualified
        "a.b.c",  # too many parts
        "pms.owners; DROP TABLE x",
        "bad-ns.owners",
        "pms.own ers",
        "../etc.owners",
    ],
)
def test_a_bad_source_degrades_the_picker_to_free_text(api, fake, source):
    """One malformed parameter must not take down the whole report — the field
    just loses its dropdown."""
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "parameters": [{"name": "o", "source": source}]}},
    )

    resp = api.get("/api/reports/templates/t1")

    assert resp.status_code == 200
    assert resp.get_json()["parameters"][0]["options"] == []
    assert fake.sql_log == [], "an invalid source must not reach SQL"


def test_several_pickers_are_resolved_concurrently(api, fake):
    """Sequential resolution meant one round trip per picker before the report
    could start rendering. Asserted by observing that every source is queried."""
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {
            "ok": True,
            "data": {
                "_id": "t1",
                "parameters": [
                    {"name": "o", "source": "pms.owners"},
                    {"name": "p", "source": "pms.properties"},
                    {"name": "v", "source": "pms.vendors"},
                    {"name": "plain"},  # no source: no query
                ],
            },
        },
    )
    fake.on_sql(rows=[{"_id": "g", "owner_id": "X-1", "name": "N"}])

    body = api.get("/api/reports/templates/t1").get_json()

    assert len(fake.sql_log) == 3
    assert {p["name"] for p in body["parameters"]} == {"o", "p", "v", "plain"}
    assert body["parameters"][3]["options"] == []


def test_the_internal_source_marker_never_leaks_to_the_client(api, fake):
    fake.on(
        "GET",
        "/api/report-templates/t1",
        {"ok": True, "data": {"_id": "t1", "parameters": [{"name": "o", "source": "pms.owners"}]}},
    )

    params = api.get("/api/reports/templates/t1").get_json()["parameters"]

    assert "_source" not in params[0]


def test_a_template_with_no_parameters_resolves_to_an_empty_list(api, fake):
    fake.on("GET", "/api/report-templates/t1", {"ok": True, "data": {"_id": "t1"}})
    assert api.get("/api/reports/templates/t1").get_json()["parameters"] == []


# ===========================================================================
# Rendering
# ===========================================================================


def test_render_forwards_the_submitted_parameters(api, fake):
    fake.on(
        "POST",
        "/api/report-templates/t1/render",
        {"ok": True, "data": {"html": "<h1>Report</h1>", "meta": {"elapsed_ms": 12}}},
    )

    body = api.post("/api/reports/templates/t1/render", json={"params": {"owner_id": "O-1"}}).get_json()

    assert body == {"html": "<h1>Report</h1>", "meta": {"elapsed_ms": 12}}
    assert fake.last_call("POST", "/api/report-templates/t1/render").body == {
        "params": {"owner_id": "O-1"},
        "email_safe_charts": False,
    }


@pytest.mark.parametrize("body", [None, {}, {"params": None}])
def test_render_without_parameters_sends_an_empty_map(api, fake, body):
    kwargs = {} if body is None else {"json": body}
    api.post("/api/reports/templates/t1/render", **kwargs)
    assert fake.last_call("POST", "/api/report-templates/t1/render").body["params"] == {}


@pytest.mark.parametrize("params", [[], "string", 7, True])
def test_render_rejects_non_object_parameters(api, fake, params):
    resp = api.post("/api/reports/templates/t1/render", json={"params": params})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "params must be an object"
    assert fake.calls == []


def test_render_normalises_a_missing_html_field(api, fake):
    fake.on("POST", "/api/report-templates/t1/render", {"ok": True, "data": {}})
    assert api.post("/api/reports/templates/t1/render", json={}).get_json() == {
        "html": "",
        "meta": {},
    }


def test_render_validates_the_template_id(api, fake):
    resp = api.post("/api/reports/templates/not a valid id/render", json={})
    assert resp.status_code == 400
    assert fake.calls == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/reports/templates"),
        ("GET", "/api/reports/templates/t1"),
        ("POST", "/api/reports/templates/t1/render"),
    ],
)
def test_report_routes_require_authentication(api, fake, method, path):
    assert api._open(method, path, token=None, json={}).status_code == 401
    assert fake.calls == []


# ===========================================================================
# SQL rollups
# ===========================================================================


def test_pnl_totals_and_category_breakdowns(api, fake):
    fake.on_sql(
        "GROUP BY type",
        rows=[{"type": "income", "total": 10000, "n": 5}, {"type": "expense", "total": 3500, "n": 8}],
    )
    fake.on_sql(
        "= 'income'",
        rows=[{"account_category": "rent", "value": 9000}, {"account_category": "fees", "value": 1000}],
    )
    fake.on_sql("= 'expense'", rows=[{"account_category": "hoa dues", "value": 3500}])

    body = api.get("/api/reports/pnl").get_json()

    assert body["income_total"] == 10000.0
    assert body["expense_total"] == 3500.0
    assert body["net_total"] == 6500.0
    assert body["income_by_category"] == [
        {"name": "Rent", "value": 9000.0},
        {"name": "Fees", "value": 1000.0},
    ]
    assert body["expense_by_category"] == [{"name": "HOA Dues", "value": 3500.0}]


def test_pnl_aggregates_inside_inventdb_not_in_python(api, fake):
    api.get("/api/reports/pnl")

    assert fake.sql_log[0] == (
        "SELECT type, SUM(amount) AS total, COUNT(*) AS n FROM pms.transactions GROUP BY type"
    )
    assert all("SUM(amount)" in statement for statement in fake.sql_log)


def test_pnl_on_an_empty_ledger_is_all_zeroes(api, fake):
    body = api.get("/api/reports/pnl").get_json()
    assert body == {
        "income_total": 0.0,
        "expense_total": 0.0,
        "net_total": 0.0,
        "income_by_category": [],
        "expense_by_category": [],
    }


def test_cashflow_groups_by_year_and_month_in_sql(api, fake):
    fake.on_sql(
        "YEAR(date)",
        rows=[
            {"y": 2024, "m": 1, "type": "income", "total": 1000},
            {"y": 2024, "m": 1, "type": "expense", "total": 400},
            {"y": 2024, "m": 2, "type": "income", "total": 1200},
        ],
    )

    series = api.get("/api/reports/cashflow").get_json()["cashflow"]

    assert series == [
        {"month": "2024-01", "income": 1000.0, "expense": 400.0, "net": 600.0},
        {"month": "2024-02", "income": 1200.0, "expense": 0.0, "net": 1200.0},
    ]


def test_cashflow_keeps_only_the_last_twelve_months(api, fake):
    fake.on_sql(
        "YEAR(date)",
        rows=[
            {"y": 2022 + (i // 12), "m": (i % 12) + 1, "type": "income", "total": 1}
            for i in range(30)
        ],
    )

    series = api.get("/api/reports/cashflow").get_json()["cashflow"]

    assert len(series) == 12
    assert series[-1]["month"] == "2024-06"


def test_cashflow_skips_rows_with_an_unparseable_period(api, fake):
    fake.on_sql(
        "YEAR(date)",
        rows=[
            {"y": None, "m": 3, "type": "income", "total": 500},
            {"y": "bad", "m": "x", "type": "income", "total": 500},
            {"y": 2024, "m": 3, "type": "income", "total": 100},
        ],
    )

    assert api.get("/api/reports/cashflow").get_json()["cashflow"] == [
        {"month": "2024-03", "income": 100.0, "expense": 0.0, "net": 100.0}
    ]


def test_cashflow_ignores_transaction_types_other_than_income_and_expense(api, fake):
    fake.on_sql(
        "YEAR(date)",
        rows=[
            {"y": 2024, "m": 3, "type": "transfer", "total": 999},
            {"y": 2024, "m": 3, "type": "income", "total": 100},
        ],
    )
    assert api.get("/api/reports/cashflow").get_json()["cashflow"][0]["income"] == 100.0


def test_rent_roll_joins_leases_to_properties_in_sql(api, fake):
    fake.on_sql(
        "JOIN",
        rows=[
            {"lease_id": "L-1", "contract_rent": 2500, "city": "Mumbai"},
            {"lease_id": "L-2", "contract_rent": 1500, "city": "Delhi"},
        ],
    )

    body = api.get("/api/reports/rent-roll").get_json()
    statement = fake.only_sql()

    assert "FROM pms.leases l JOIN pms.properties p" in statement
    assert "ON l.property_id = p.property_id" in statement
    assert "WHERE lower(l.status) = 'active'" in statement
    assert body["count"] == 2
    assert body["monthly_total"] == 4000.0


def test_the_two_num_helpers_disagree_on_formatted_currency(api, fake):
    """KNOWN INCONSISTENCY: `reports._num` and `dashboard._num` share a name and
    a purpose but not their tolerance.

    The dashboard's strips ``$`` and thousands separators before coercing; this
    one calls ``float()`` directly, so any amount stored as a formatted string
    silently becomes 0. In a schemaless store that is a live risk — the same
    lease can contribute 1500 to the dashboard's expected rent and 0 to the rent
    roll's monthly total, with nothing to show anything went wrong.
    """
    from app.routers.dashboard import _num as dashboard_num

    assert dashboard_num("1,500") == 1500.0
    assert _num("1,500") == 0.0

    fake.on_sql("JOIN", rows=[{"lease_id": "L-1", "contract_rent": "1,500"}])
    assert api.get("/api/reports/rent-roll").get_json()["monthly_total"] == 0.0


def test_rent_roll_on_no_active_leases(api, fake):
    assert api.get("/api/reports/rent-roll").get_json() == {
        "rows": [],
        "count": 0,
        "monthly_total": 0.0,
    }


def test_renewals_windows_on_todays_date(api, fake):
    api.get("/api/reports/renewals")

    today = date.today()
    statement = fake.only_sql()

    assert f"l.lease_end >= '{today.isoformat()}'" in statement
    assert f"l.lease_end <= '{(today + timedelta(days=90)).isoformat()}'" in statement


@pytest.mark.parametrize(
    "days,expected", [("30", 30), ("1", 1), ("365", 365), ("0", 1), ("-5", 1), ("9999", 365)]
)
def test_renewals_clamps_the_window_to_one_year(api, fake, days, expected):
    body = api.get("/api/reports/renewals", query_string={"days": days}).get_json()

    assert body["days"] == expected
    assert f"'{(date.today() + timedelta(days=expected)).isoformat()}'" in fake.only_sql()


@pytest.mark.parametrize("days", ["abc", "", "1; DROP TABLE x", "3.5"])
def test_a_malformed_window_falls_back_to_ninety_days(api, fake, days):
    """Contrast with `/api/<entity>?limit=abc`, which 500s — this route catches
    the coercion error and the resources router does not."""
    body = api.get("/api/reports/renewals", query_string={"days": days}).get_json()
    assert body["days"] == 90


def test_renewals_computes_the_gap_between_market_and_contract_rent(api, fake):
    fake.on_sql(
        "JOIN",
        rows=[
            {"lease_id": "L-1", "contract_rent": 2000, "market_rent": 2350},
            {"lease_id": "L-2", "contract_rent": 3000, "market_rent": 2800},  # over market
            {"lease_id": "L-3"},  # neither known
        ],
    )

    rows = api.get("/api/reports/renewals").get_json()["rows"]

    assert [r["rent_gap"] for r in rows] == [350.0, -200.0, 0.0]


def test_occupancy_distribution_and_rate(api, fake):
    fake.on_sql(
        "FROM pms.properties",
        rows=[{"status": "occupied", "value": 3}, {"status": "vacant", "value": 1}],
    )

    body = api.get("/api/reports/occupancy").get_json()

    assert body["distribution"] == [
        {"name": "Occupied", "value": 3},
        {"name": "Vacant", "value": 1},
    ]
    assert body["total"] == 4
    assert body["occupied"] == 3
    assert body["occupancy_rate"] == 75.0


def test_occupancy_on_an_empty_portfolio_does_not_divide_by_zero(api, fake):
    assert api.get("/api/reports/occupancy").get_json() == {
        "distribution": [],
        "total": 0,
        "occupied": 0,
        "occupancy_rate": 0.0,
    }


def test_work_order_report_covers_status_priority_and_category(api, fake):
    fake.on_sql("GROUP BY status", rows=[{"status": "open", "value": 4}])
    fake.on_sql("GROUP BY priority", rows=[{"priority": "high", "value": 2}])
    fake.on_sql("GROUP BY category", rows=[{"category": "hvac", "value": 3}])
    fake.on_sql("SUM(est_cost)", rows=[{"total": "4250.75"}])

    body = api.get("/api/reports/work-orders").get_json()

    assert body["by_status"] == [{"name": "Open", "value": 4}]
    assert body["by_priority"] == [{"name": "High", "value": 2}]
    assert body["by_category"] == [{"name": "HVAC", "value": 3}]
    assert body["open_cost_estimate"] == 4250.75


def test_the_open_cost_estimate_excludes_completed_work(api, fake):
    api.get("/api/reports/work-orders")
    cost_sql = [s for s in fake.sql_log if "est_cost" in s][0]
    assert "WHERE lower(status) != 'completed'" in cost_sql


def test_work_order_report_with_no_rows(api, fake):
    body = api.get("/api/reports/work-orders").get_json()
    assert body["open_cost_estimate"] == 0.0
    assert body["by_status"] == []


@pytest.mark.parametrize(
    "path",
    [
        "/api/reports/pnl",
        "/api/reports/cashflow",
        "/api/reports/rent-roll",
        "/api/reports/renewals",
        "/api/reports/occupancy",
        "/api/reports/work-orders",
    ],
)
def test_every_rollup_requires_authentication(api, fake, path):
    assert api.get(path, token=None).status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "path",
    [
        "/api/reports/pnl",
        "/api/reports/cashflow",
        "/api/reports/rent-roll",
        "/api/reports/renewals",
        "/api/reports/occupancy",
        "/api/reports/work-orders",
    ],
)
def test_rollups_hardcode_the_pms_namespace(api, fake, path):
    """`reports.py` uses a module-level `NS = "pms"` rather than the client's
    configured namespace, unlike every other router. Deploying against a
    differently-named namespace would leave these six endpoints querying a
    namespace that does not exist while the rest of the app works.
    """
    api.get(path)
    assert all("pms." in statement for statement in fake.sql_log)
