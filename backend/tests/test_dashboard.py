"""``app.routers.dashboard`` — the aggregates behind the landing page.

Unlike the reports, these are computed in Python from ``SELECT *`` snapshots, so
the arithmetic is the app's own and worth pinning: occupancy, the expiring-lease
window, the month split on cash flow, and the coercion helpers that absorb
whatever InventDB hands back for a schemaless column.

Dates are expressed relative to "now" rather than frozen, because the handlers
call ``datetime.now`` directly. Cases sit well clear of the boundaries so the
suite does not depend on the wall clock.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.routers.dashboard import _month_key, _num, _parse_date

NOW = datetime.now(timezone.utc).replace(tzinfo=None)
THIS_MONTH = NOW.strftime("%Y-%m")


def day(offset: int) -> str:
    return (NOW + timedelta(days=offset)).strftime("%Y-%m-%d")


def seed(fake, **tables):
    """Answer each `SELECT * FROM pms.<type>` with the given rows."""
    for type_name, rows in tables.items():
        fake.on_sql(f"FROM pms.{type_name} ", rows=rows)


# ===========================================================================
# Coercion helpers
# ===========================================================================


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, 0.0),
        (0, 0.0),
        (12, 12.0),
        (12.5, 12.5),
        ("12.5", 12.5),
        ("$1,200.50", 1200.5),  # currency strings from a schemaless column
        ("  42  ", 42.0),
        ("1,000", 1000.0),
        ("", 0.0),
        ("abc", 0.0),
        ("$", 0.0),
        ([], 0.0),
        ({}, 0.0),
        (True, 1.0),  # bool is a number to isinstance
        ("-500", -500.0),
    ],
)
def test_num_never_raises_on_a_schemaless_column(value, expected):
    assert _num(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("2024-03-15", datetime(2024, 3, 15)),
        ("03/15/2024", datetime(2024, 3, 15)),
        ("2024/03/15", datetime(2024, 3, 15)),
        ("2024-03-15T10:30:00", datetime(2024, 3, 15)),
        ("2024-03-15T10:30:00Z", datetime(2024, 3, 15)),
        ("2024-03-15 10:30:00", datetime(2024, 3, 15)),
        (datetime(2024, 3, 15, 10), datetime(2024, 3, 15, 10)),
    ],
)
def test_parse_date_handles_the_formats_inventdb_returns(value, expected):
    assert _parse_date(value) == expected


@pytest.mark.parametrize("value", [None, "", 0, "not a date", "15-03-2024", "N/A"])
def test_parse_date_returns_none_rather_than_raising(value):
    assert _parse_date(value) is None


def test_parse_date_reads_the_first_ten_characters_for_known_formats():
    """`%Y-%m-%d` is matched against `text[:10]`, which is how ISO timestamps
    with a time component parse without a dedicated format."""
    assert _parse_date("2024-03-15T23:59:59.999+05:30") == datetime(2024, 3, 15)


def test_month_key_format():
    assert _month_key(datetime(2024, 3, 5)) == "2024-03"


# ===========================================================================
# Summary: properties and occupancy
# ===========================================================================


def test_occupancy_counts_and_rate(api, fake):
    seed(
        fake,
        properties=[
            {"status": "Occupied"},
            {"status": "occupied"},  # case-insensitive
            {"status": "OCCUPIED"},
            {"status": "Vacant"},
        ],
    )

    body = api.get("/api/dashboard/summary").get_json()

    assert body["properties"] == {
        "total": 4,
        "occupied": 3,
        "vacant": 1,
        "occupancy_rate": 75.0,
    }


def test_statuses_outside_occupied_and_vacant_count_toward_the_total_only(api, fake):
    """A property under renovation is neither occupied nor vacant, but it is
    still a property — so it dilutes the rate."""
    seed(fake, properties=[{"status": "Occupied"}, {"status": "Renovation"}])

    body = api.get("/api/dashboard/summary").get_json()

    assert body["properties"]["total"] == 2
    assert body["properties"]["occupied"] == 1
    assert body["properties"]["vacant"] == 0
    assert body["properties"]["occupancy_rate"] == 50.0


def test_occupancy_rate_on_an_empty_portfolio_is_zero_not_a_crash(api, fake):
    """The `denom = total or 1` guard — a fresh instance has no properties."""
    seed(fake, properties=[])

    assert api.get("/api/dashboard/summary").get_json()["properties"] == {
        "total": 0,
        "occupied": 0,
        "vacant": 0,
        "occupancy_rate": 0.0,
    }


def test_occupancy_rate_is_rounded_to_one_decimal(api, fake):
    seed(fake, properties=[{"status": "Occupied"}] + [{"status": "Vacant"}] * 2)
    # 1/3 -> 33.333... -> 33.3
    assert api.get("/api/dashboard/summary").get_json()["properties"]["occupancy_rate"] == 33.3


def test_a_missing_status_column_is_neither_occupied_nor_vacant(api, fake):
    seed(fake, properties=[{}, {"status": None}])

    props = api.get("/api/dashboard/summary").get_json()["properties"]

    assert props == {"total": 2, "occupied": 0, "vacant": 0, "occupancy_rate": 0.0}


# ===========================================================================
# Summary: leases
# ===========================================================================


def test_only_active_leases_count_as_active(api, fake):
    seed(
        fake,
        leases=[
            {"status": "Active"},
            {"status": "active"},
            {"status": "Expired"},
            {"status": "Pending"},
        ],
    )

    body = api.get("/api/dashboard/summary").get_json()

    assert body["leases"]["total"] == 4
    assert body["leases"]["active"] == 2


def test_expiring_soon_counts_active_leases_ending_within_ninety_days(api, fake):
    seed(
        fake,
        leases=[
            {"status": "Active", "lease_end": day(1)},
            {"status": "Active", "lease_end": day(45)},
            {"status": "Active", "lease_end": day(200)},  # too far out
            {"status": "Active", "lease_end": day(-1)},  # already ended
            {"status": "Expired", "lease_end": day(10)},  # not active
            {"status": "Active", "lease_end": None},  # unknown end date
            {"status": "Active"},  # column absent
        ],
    )

    assert api.get("/api/dashboard/summary").get_json()["leases"]["expiring_soon"] == 2


def test_a_lease_that_already_ended_is_not_expiring_soon(api, fake):
    """The window is `0 <= days <= 90`, so past end dates are excluded.

    Worth noting the shape of that lower bound: `lease_end` parses to midnight
    while `now` carries a time, so a lease ending *today* yields a negative
    delta and is excluded too. Defensible — it has expired — but it means
    "expiring soon" never includes today.
    """
    seed(fake, leases=[{"status": "Active", "lease_end": day(-30)}])
    assert api.get("/api/dashboard/summary").get_json()["leases"]["expiring_soon"] == 0


def test_expected_rent_sums_contract_rent_over_active_leases_only(api, fake):
    seed(
        fake,
        leases=[
            {"status": "Active", "contract_rent": 1000},
            {"status": "Active", "contract_rent": "1,500.50"},
            {"status": "Expired", "contract_rent": 9999},
        ],
    )

    assert api.get("/api/dashboard/summary").get_json()["financials"]["expected_rent"] == 2500.5


# ===========================================================================
# Summary: maintenance
# ===========================================================================


def test_open_work_orders_include_both_open_and_new(api, fake):
    seed(
        fake,
        work_orders=[
            {"status": "Open"},
            {"status": "New"},
            {"status": "In Progress"},
            {"status": "Completed"},
        ],
    )

    assert api.get("/api/dashboard/summary").get_json()["maintenance"] == {
        "total": 4,
        "open": 2,
        "in_progress": 1,
    }


# ===========================================================================
# Summary: financials
# ===========================================================================


def test_income_and_expense_cover_the_current_month_only(api, fake):
    seed(
        fake,
        transactions=[
            {"type": "Income", "amount": 1000, "date": day(0)},
            {"type": "income", "amount": "500", "date": day(0)},
            {"type": "Expense", "amount": 300, "date": day(0)},
            {"type": "Income", "amount": 99999, "date": "2020-01-15"},  # old
            {"type": "Transfer", "amount": 50, "date": day(0)},  # neither
            {"type": "Income", "amount": 42, "date": "not a date"},
        ],
    )

    financials = api.get("/api/dashboard/summary").get_json()["financials"]

    assert financials["income_month"] == 1500.0
    assert financials["expense_month"] == 300.0
    assert financials["net_month"] == 1200.0


def test_financials_are_rounded_to_cents(api, fake):
    seed(
        fake,
        transactions=[
            {"type": "Income", "amount": 0.1, "date": day(0)},
            {"type": "Income", "amount": 0.2, "date": day(0)},
        ],
    )
    assert api.get("/api/dashboard/summary").get_json()["financials"]["income_month"] == 0.3


def test_net_can_be_negative(api, fake):
    seed(fake, transactions=[{"type": "Expense", "amount": 500, "date": day(0)}])
    assert api.get("/api/dashboard/summary").get_json()["financials"]["net_month"] == -500.0


# ===========================================================================
# Summary: shape and resilience
# ===========================================================================


def test_summary_reads_each_type_once(api, fake):
    api.get("/api/dashboard/summary")

    assert fake.sql_log == [
        "SELECT * FROM pms.properties LIMIT 5000",
        "SELECT * FROM pms.tenants LIMIT 5000",
        "SELECT * FROM pms.leases LIMIT 5000",
        "SELECT * FROM pms.work_orders LIMIT 5000",
        "SELECT * FROM pms.transactions LIMIT 5000",
    ]


def test_summary_on_a_completely_empty_instance_returns_zeroes(api, fake):
    """Every type errors on a fresh namespace; the page must still render."""
    fake.on_sql(status=500, payload={"error": "no such table"})

    body = api.get("/api/dashboard/summary").get_json()

    assert body["properties"]["total"] == 0
    assert body["leases"]["expiring_soon"] == 0
    assert body["financials"]["net_month"] == 0.0


def test_summary_requires_authentication(api, fake):
    assert api.get("/api/dashboard/summary", token=None).status_code == 401
    assert fake.calls == []


# ===========================================================================
# Charts
# ===========================================================================


def test_cashflow_covers_six_months_ending_with_the_current_one(api, fake):
    body = api.get("/api/dashboard/charts").get_json()
    months = [point["month"] for point in body["cashflow"]]

    assert len(months) == 6
    assert months[-1] == THIS_MONTH
    assert months == sorted(months), "months must run oldest to newest"


def test_cashflow_month_labels_are_contiguous_across_a_year_boundary(api, fake):
    months = [p["month"] for p in api.get("/api/dashboard/charts").get_json()["cashflow"]]

    parsed = [datetime.strptime(m, "%Y-%m") for m in months]
    for earlier, later in zip(parsed, parsed[1:]):
        step = (later.year - earlier.year) * 12 + (later.month - earlier.month)
        assert step == 1


def test_transactions_land_in_their_month_bucket(api, fake):
    seed(
        fake,
        transactions=[
            {"type": "Income", "amount": 1000, "date": day(0)},
            {"type": "Expense", "amount": 400, "date": day(0)},
        ],
    )

    current = api.get("/api/dashboard/charts").get_json()["cashflow"][-1]

    assert current == {"month": THIS_MONTH, "income": 1000.0, "expense": 400.0, "net": 600.0}


def test_transactions_outside_the_window_are_dropped(api, fake):
    seed(fake, transactions=[{"type": "Income", "amount": 5000, "date": "2019-01-05"}])

    cashflow = api.get("/api/dashboard/charts").get_json()["cashflow"]

    assert all(point["income"] == 0 for point in cashflow)


def test_months_with_no_activity_are_present_as_zeroes(api, fake):
    """The chart needs a continuous x-axis, so gaps are filled rather than
    omitted."""
    body = api.get("/api/dashboard/charts").get_json()
    assert all(set(p) == {"month", "income", "expense", "net"} for p in body["cashflow"])


def test_distributions_are_ordered_most_common_first(api, fake):
    seed(
        fake,
        properties=[{"status": "Occupied"}] * 3 + [{"status": "Vacant"}] * 5,
    )

    dist = api.get("/api/dashboard/charts").get_json()["property_status"]

    assert dist == [{"name": "Vacant", "value": 5}, {"name": "Occupied", "value": 3}]


def test_expense_breakdown_sums_by_category_descending(api, fake):
    seed(
        fake,
        transactions=[
            {"type": "Expense", "amount": 100, "account_category": "Repairs"},
            {"type": "Expense", "amount": 250, "account_category": "Utilities"},
            {"type": "Expense", "amount": 50, "account_category": "Repairs"},
            {"type": "Income", "amount": 9999, "account_category": "Rent"},
        ],
    )

    breakdown = api.get("/api/dashboard/charts").get_json()["expense_breakdown"]

    assert breakdown == [
        {"name": "Utilities", "value": 250.0},
        {"name": "Repairs", "value": 150.0},
    ]


def test_an_expense_with_no_category_is_bucketed_as_other(api, fake):
    seed(
        fake,
        transactions=[
            {"type": "Expense", "amount": 100},
            {"type": "Expense", "amount": 25, "account_category": ""},
            {"type": "Expense", "amount": 25, "account_category": None},
        ],
    )

    breakdown = api.get("/api/dashboard/charts").get_json()["expense_breakdown"]

    assert breakdown == [{"name": "Other", "value": 150.0}]


def test_a_blank_status_is_labelled_unknown(api, fake):
    seed(fake, properties=[{"status": ""}, {"status": "   "}])
    assert api.get("/api/dashboard/charts").get_json()["property_status"] == [
        {"name": "Unknown", "value": 2}
    ]


def test_a_missing_status_column_is_labelled_none_not_unknown(api, fake):
    """KNOWN WART: `_dist` does `str(r.get(field)).strip() or "Unknown"`, so an
    absent column stringifies to the literal text `"None"` — which is truthy and
    therefore never reaches the `"Unknown"` fallback. The chart legend shows a
    slice called "None" next to one called "Unknown", meaning the same thing.
    """
    seed(fake, properties=[{}, {"status": None}])

    assert api.get("/api/dashboard/charts").get_json()["property_status"] == [
        {"name": "None", "value": 2}
    ]


def test_charts_expose_every_series_the_frontend_renders(api, fake):
    body = api.get("/api/dashboard/charts").get_json()

    assert set(body) == {
        "cashflow",
        "property_status",
        "lease_status",
        "maintenance_status",
        "maintenance_priority",
        "expense_breakdown",
    }


def test_charts_on_an_empty_instance_still_return_every_series(api, fake):
    fake.on_sql(status=500, payload={"error": "no such table"})

    body = api.get("/api/dashboard/charts").get_json()

    assert len(body["cashflow"]) == 6
    assert body["property_status"] == []
    assert body["expense_breakdown"] == []
