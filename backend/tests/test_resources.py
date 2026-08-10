"""``app.routers.resources`` — the generic CRUD surface.

These tests assert on the SQL the app *actually sends upstream* rather than on
the JSON it returns, because the SQL is where the interesting behaviour lives:
paging clamps, the ORDER BY it picks, and whether a hostile query string can
reach the statement. Responses are checked where they carry their own logic
(the search path, the PUT merge).
"""

from __future__ import annotations

import re

import pytest

from app.entities import get_entity
from app.routers.resources import _gen_key, _matches_q

LIST_SQL = "SELECT * FROM pms.properties ORDER BY street ASC LIMIT 500 OFFSET 0"
COUNT_SQL = "SELECT COUNT(*) AS c FROM pms.properties"


# ===========================================================================
# Listing: the composed statement
# ===========================================================================


def test_list_builds_the_expected_statement_and_a_matching_count(api, fake):
    resp = api.get("/api/properties")

    assert resp.status_code == 200
    # Two statements: the page, then the unpaged count for `total`.
    assert fake.sql_log == [LIST_SQL, COUNT_SQL]


def test_list_defaults_order_by_to_the_entity_registry(api, fake):
    """Each entity declares its own default sort; the router must honour it."""
    api.get("/api/work_orders")
    assert "ORDER BY date_opened ASC" in fake.sql_log[0]

    fake.reset()
    api.get("/api/vendors")
    assert "ORDER BY company ASC" in fake.sql_log[0]


def test_list_accepts_an_explicit_order_by_and_direction(api, fake):
    api.get("/api/properties", query_string={"order_by": "city", "order_dir": "desc"})
    assert fake.sql_log[0] == (
        "SELECT * FROM pms.properties ORDER BY city DESC LIMIT 500 OFFSET 0"
    )


@pytest.mark.parametrize(
    "order_dir,expected",
    [
        ("desc", "DESC"),
        ("DESC", "DESC"),
        ("DeSc", "DESC"),
        ("asc", "ASC"),
        ("", "ASC"),
        ("sideways", "ASC"),  # anything that isn't "desc" sorts ascending
        ("desc; DROP TABLE x", "ASC"),
    ],
)
def test_order_dir_is_a_two_valued_switch_not_an_interpolation(
    api, fake, order_dir, expected
):
    """``order_dir`` never reaches SQL as user text — it selects one of two words."""
    api.get("/api/properties", query_string={"order_dir": order_dir})
    assert f"ORDER BY street {expected} LIMIT" in fake.sql_log[0]


@pytest.mark.parametrize(
    "order_by",
    ["city; DROP TABLE properties", "city, (SELECT 1)", "1", "city--", "", " "],
)
def test_invalid_order_by_is_rejected_before_any_sql_runs(api, fake, order_by):
    resp = api.get("/api/properties", query_string={"order_by": order_by})

    if order_by == "":
        # Only the empty string is falsy, so it alone falls back to the registry
        # default — the `args.get(...) or entity.order_by` branch. A single
        # space is truthy and must still be rejected as an identifier.
        assert resp.status_code == 200
        return

    assert resp.status_code == 400
    assert resp.get_json()["ok"] is False
    assert fake.sql_log == [], "a rejected sort must not reach InventDB"


# ===========================================================================
# Listing: paging
# ===========================================================================


@pytest.mark.parametrize(
    "limit,expected",
    [
        ("10", 10),
        ("1", 1),
        ("5000", 5000),
        ("0", 1),  # clamped up
        ("-7", 1),
        ("99999", 5000),  # clamped down
        ("", 500),  # empty -> default
    ],
)
def test_limit_is_clamped_to_one_through_five_thousand(api, fake, limit, expected):
    api.get("/api/properties", query_string={"limit": limit})
    assert f"LIMIT {expected} OFFSET" in fake.sql_log[0]


@pytest.mark.parametrize(
    "offset,expected", [("0", 0), ("25", 25), ("-1", 0), ("", 0), ("100000", 100000)]
)
def test_offset_floors_at_zero_and_is_otherwise_unbounded(api, fake, offset, expected):
    api.get("/api/properties", query_string={"offset": offset})
    assert f"OFFSET {expected}" in fake.sql_log[0]


@pytest.mark.parametrize("value", ["abc", "1.5", "10; DROP TABLE x", "1e5"])
@pytest.mark.xfail(
    reason=(
        "KNOWN BUG: non-numeric limit/offset raise ValueError inside the view, "
        "which the catch-all handler turns into a 500 with the Python error "
        "text in the body. A malformed query string is a client error and "
        "should be a 400."
    ),
)
def test_non_numeric_paging_should_be_a_client_error(api, fake, value):
    resp = api.get("/api/properties", query_string={"limit": value})
    assert resp.status_code == 400


def test_non_numeric_paging_currently_leaks_the_exception_text(api, fake):
    """Pins the actual behaviour of the bug xfailed above, so the blast radius
    is visible: the response body carries the raw Python exception message."""
    resp = api.get("/api/properties", query_string={"limit": "abc"})
    assert resp.status_code == 500
    assert "invalid literal for int()" in resp.get_json()["error"]


# ===========================================================================
# Listing: filters — the path user input takes into SQL
# ===========================================================================


def test_arbitrary_query_params_become_equality_filters(api, fake):
    api.get("/api/properties", query_string={"city": "Mumbai"})
    assert fake.sql_log[0] == (
        "SELECT * FROM pms.properties WHERE city = 'Mumbai' "
        "ORDER BY street ASC LIMIT 500 OFFSET 0"
    )


def test_multiple_filters_are_anded_together(api, fake):
    api.get("/api/properties", query_string={"city": "Mumbai", "status": "Occupied"})
    where = fake.sql_log[0].split(" WHERE ")[1].split(" ORDER BY ")[0]
    assert " AND " in where
    assert "city = 'Mumbai'" in where
    assert "status = 'Occupied'" in where


def test_the_count_query_reuses_the_same_where_clause(api, fake):
    """`total` must describe the filtered set, not the whole table."""
    api.get("/api/properties", query_string={"city": "Mumbai"})
    assert fake.sql_log[1] == (
        "SELECT COUNT(*) AS c FROM pms.properties WHERE city = 'Mumbai'"
    )


@pytest.mark.parametrize(
    "param,value",
    [
        ("q", "mumbai"),
        ("limit", "5"),
        ("offset", "5"),
        ("order_by", "city"),
        ("order_dir", "desc"),
    ],
)
def test_reserved_params_are_not_treated_as_columns(api, fake, param, value):
    api.get("/api/properties", query_string={param: value})
    assert "WHERE" not in fake.sql_log[0]


def test_empty_filter_values_are_skipped(api, fake):
    """The UI sends `?status=` for a cleared dropdown; that must not filter."""
    api.get("/api/properties", query_string={"status": ""})
    assert "WHERE" not in fake.sql_log[0]


@pytest.mark.parametrize(
    "value",
    [
        "O'Brien",
        "' OR '1'='1",
        "'; DROP TABLE pms.properties; --",
        "' UNION SELECT * FROM _System.Users --",
        "Mumbai' AND 1=1--",
        "x'||(SELECT 1)||'",
    ],
)
def test_hostile_filter_values_arrive_as_a_single_quoted_literal(api, fake, value):
    """End-to-end proof for the `sqlutil` guarantee: from HTTP query string,
    through the router, into the statement, still inert."""
    api.get("/api/properties", query_string={"city": value})

    statement = fake.sql_log[0]
    where = statement.split(" WHERE ")[1].split(" ORDER BY ")[0]
    assert where.startswith("city = '") and where.endswith("'")

    literal = where[len("city = ") :]
    assert literal.count("'") % 2 == 0
    assert literal[1:-1].replace("''", "").count("'") == 0
    # The clause is the whole WHERE: nothing was appended past the literal.
    assert " ORDER BY street ASC LIMIT 500 OFFSET 0" in statement


@pytest.mark.parametrize(
    "column",
    ["city; DROP TABLE x", "city--", "1", "city)", "*", "city OR 1=1", "city.sub"],
)
def test_hostile_filter_column_names_are_rejected(api, fake, column):
    resp = api.get("/api/properties", query_string={column: "x"})
    assert resp.status_code == 400
    assert fake.sql_log == []


def test_a_repeated_param_produces_one_clause(api, fake):
    """`?city=A&city=B` — Flask's `args.get` takes the first; the loop iterates
    unique keys, so exactly one clause is emitted."""
    api.get("/api/properties?city=Mumbai&city=Delhi")
    where = fake.sql_log[0].split(" WHERE ")[1].split(" ORDER BY ")[0]
    assert where == "city = 'Mumbai'"


# ===========================================================================
# Listing: the response envelope and the count fallback
# ===========================================================================


def test_list_returns_rows_with_paging_metadata(api, fake, rows):
    fake.on_sql("SELECT *", rows=rows(3, city="Mumbai"))
    fake.on_sql("COUNT(*)", rows=[{"c": 42}])

    body = api.get("/api/properties", query_string={"limit": "3"}).get_json()

    assert len(body["items"]) == 3
    assert body["total"] == 42  # from COUNT, not len(items)
    assert body["limit"] == 3
    assert body["offset"] == 0


@pytest.mark.parametrize(
    "count_rows,expected",
    [
        ([{"c": 7}], 7),
        ([{"COUNT(*)": 7}], 7),
        ([{"count": 7}], 7),
        ([{"anything_else": 7}], 7),  # falls back to the first coercible value
        ([{"c": "7"}], 7),
        ([{"c": None}], 0),
        ([{"c": "not a number"}], 0),
        ([{}], 0),
        ([], 0),
    ],
)
def test_count_tolerates_every_shape_inventdb_might_name_the_column(
    api, fake, count_rows, expected
):
    """InventDB's SQL layer ignores `AS` aliases on some aggregates, so the
    column can come back as `c`, `COUNT(*)` or something else entirely."""
    fake.on_sql("COUNT(*)", rows=count_rows)
    assert api.get("/api/properties").get_json()["total"] == expected


def test_a_failing_count_degrades_to_zero_rather_than_failing_the_request(api, fake):
    """A type with no rows yet surfaces as an SQL error on a fresh instance;
    the list must still render."""
    fake.on_sql("COUNT(*)", status=500, payload={"error": "no such table"})

    resp = api.get("/api/properties")

    assert resp.status_code == 200
    assert resp.get_json()["total"] == 0


def test_a_failing_page_query_returns_an_empty_list_not_an_error(api, fake):
    fake.on_sql("SELECT *", status=500, payload={"error": "no such table"})

    body = api.get("/api/properties").get_json()

    assert body["items"] == []


# ===========================================================================
# Listing: the free-text search path
# ===========================================================================


def test_search_pulls_a_wide_page_and_filters_in_python(api, fake):
    fake.on_sql(
        "SELECT *",
        rows=[
            {"_id": "1", "street": "12 Marine Drive", "city": "Mumbai"},
            {"_id": "2", "street": "9 Park Lane", "city": "Delhi"},
        ],
    )

    body = api.get("/api/properties", query_string={"q": "marine"}).get_json()

    # One statement only — no COUNT, because `total` is the filtered length.
    assert fake.sql_log == [
        "SELECT * FROM pms.properties ORDER BY street ASC LIMIT 5000"
    ]
    assert [r["_id"] for r in body["items"]] == ["1"]
    assert body["total"] == 1


def test_search_is_case_insensitive_and_matches_substrings(api, fake):
    fake.on_sql("SELECT *", rows=[{"_id": "1", "city": "Mumbai"}])
    body = api.get("/api/properties", query_string={"q": "UMBA"}).get_json()
    assert len(body["items"]) == 1


def test_search_only_looks_at_the_entity_search_fields(api, fake):
    """`properties.search_fields` excludes `owner_id`, so a query that matches
    only that column must not produce a hit — otherwise the UI's "search"
    silently becomes "search everything"."""
    fake.on_sql("SELECT *", rows=[{"_id": "1", "city": "Mumbai", "owner_id": "O-999"}])

    assert api.get("/api/properties", query_string={"q": "O-999"}).get_json()["total"] == 0
    assert api.get("/api/properties", query_string={"q": "Mumbai"}).get_json()["total"] == 1


def test_search_matches_non_string_columns_by_their_text_form(api, fake):
    fake.on_sql("SELECT *", rows=[{"_id": "1", "city": "Mumbai", "zip": 400020}])
    # `zip` is a search field on properties and the value is an int upstream.
    assert api.get("/api/properties", query_string={"q": "400020"}).get_json()["total"] == 1


def test_search_ignores_null_columns(api, fake):
    fake.on_sql("SELECT *", rows=[{"_id": "1", "city": None, "street": "Marine"}])
    assert api.get("/api/properties", query_string={"q": "none"}).get_json()["total"] == 0


def test_search_paginates_the_filtered_set(api, fake):
    fake.on_sql(
        "SELECT *",
        rows=[{"_id": str(i), "city": f"Mumbai {i}"} for i in range(10)],
    )

    body = api.get(
        "/api/properties", query_string={"q": "mumbai", "limit": "3", "offset": "6"}
    ).get_json()

    assert [r["_id"] for r in body["items"]] == ["6", "7", "8"]
    assert body["total"] == 10  # the filtered total, not the page length


def test_search_combines_with_column_filters_in_sql(api, fake):
    fake.on_sql("SELECT *", rows=[{"_id": "1", "city": "Mumbai"}])
    api.get("/api/properties", query_string={"q": "mumbai", "state": "MH"})
    assert fake.sql_log[0] == (
        "SELECT * FROM pms.properties WHERE state = 'MH' "
        "ORDER BY street ASC LIMIT 5000"
    )


def test_search_over_an_empty_table_returns_an_empty_page(api, fake):
    fake.on_sql("SELECT *", rows=[])

    body = api.get("/api/properties", query_string={"q": "x"}).get_json()

    assert body == {"items": [], "total": 0, "limit": 500, "offset": 0}


def test_search_falls_back_to_every_column_when_an_entity_declares_none():
    """The `list(rows[0].keys())` fallback in `list_records`.

    Unreachable through the HTTP surface today — all ten registered entities
    declare `search_fields` — so it is exercised directly rather than left
    untested on the assumption it works.
    """
    row = {"_id": "1", "undeclared_column": "findme"}
    assert _matches_q(row, "findme", list(row.keys())) is True
    assert _matches_q(row, "findme", ["_id"]) is False


# ===========================================================================
# Routing, entity resolution and auth
# ===========================================================================


@pytest.mark.parametrize(
    "entity",
    [
        "properties",
        "owners",
        "tenants",
        "leases",
        "work_orders",
        "vendors",
        "transactions",
        "inspections",
        "compliance",
        "daily_tasks",
    ],
)
def test_every_registered_entity_is_listable(api, fake, entity):
    resp = api.get(f"/api/{entity}")
    assert resp.status_code == 200
    assert fake.sql_log[0].startswith(f"SELECT * FROM pms.{entity}")


@pytest.mark.parametrize(
    "entity", ["nope", "Properties", "properties2", "_System", "users"]
)
def test_unknown_entities_are_404_and_never_reach_inventdb(api, fake, entity):
    """The registry is an allow-list — this is what stops `/api/<anything>`
    from becoming a read primitive over the whole namespace."""
    resp = api.get(f"/api/{entity}")
    assert resp.status_code == 404
    assert fake.calls == []


def test_the_entity_check_runs_before_the_auth_check(api, fake):
    """Documents ordering: an unknown entity is 404 even unauthenticated.

    That leaks the entity list to anonymous callers. Harmless here — the names
    are already public in `/api/meta/entities` — but worth being deliberate about.
    """
    assert api.get("/api/nope", token=None).status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/properties"),
        ("GET", "/api/properties/abc"),
        ("POST", "/api/properties"),
        ("PUT", "/api/properties/abc"),
        ("DELETE", "/api/properties/abc"),
    ],
)
def test_every_crud_route_requires_a_bearer_token(api, fake, method, path):
    resp = api._open(method, path, token=None, json={})
    assert resp.status_code == 401
    assert fake.calls == []


@pytest.mark.parametrize(
    "header",
    ["", "Bearer", "Bearer ", "Basic abc123", "token abc123", "Bearer  ", "abc123"],
)
def test_malformed_authorization_headers_are_rejected(client, fake, header):
    resp = client.get("/api/properties", headers={"Authorization": header})
    assert resp.status_code == 401
    assert fake.calls == []


def test_the_callers_token_is_forwarded_verbatim(api, fake):
    """InventDB enforces row-level security off this token, so the backend must
    pass the caller's own credential rather than a service account."""
    api.get("/api/properties", token="caller-jwt-xyz")
    assert fake.calls[0].token == "caller-jwt-xyz"


@pytest.mark.parametrize("scheme", ["bearer", "BEARER", "BeArEr"])
def test_the_bearer_scheme_is_case_insensitive(client, fake, scheme):
    resp = client.get("/api/properties", headers={"Authorization": f"{scheme} tok"})
    assert resp.status_code == 200


# ===========================================================================
# Reading one record
# ===========================================================================


def test_get_record_proxies_to_the_record_endpoint(api, fake):
    fake.on_record("properties", "abc-123", {"_id": "abc-123", "city": "Mumbai"})

    body = api.get("/api/properties/abc-123").get_json()

    assert body["city"] == "Mumbai"
    assert fake.last_call("GET").path == "/db/pms/properties/abc-123"


def test_an_upstream_404_is_passed_through_with_its_status(api, fake):
    fake.on(
        "GET",
        "/db/pms/properties/missing",
        {"error": "No such record"},
        status=404,
    )

    resp = api.get("/api/properties/missing")

    assert resp.status_code == 404
    assert resp.get_json() == {"ok": False, "error": "No such record"}


# ===========================================================================
# Create
# ===========================================================================


def test_create_posts_the_body_to_the_record_endpoint(api, fake):
    api.post("/api/properties", json={"city": "Mumbai", "property_id": "P-001"})

    call = fake.last_call("POST", "/db/pms/properties")
    assert call.body["city"] == "Mumbai"
    assert call.body["property_id"] == "P-001"


def test_create_strips_underscore_prefixed_fields(api, fake):
    """`_id`, `_created` and friends are InventDB's to set; echoing a client's
    values back would let a caller overwrite system metadata."""
    api.post(
        "/api/properties",
        json={"city": "Mumbai", "_id": "forged", "_created": "1999", "__proto__": "x"},
    )

    body = fake.last_call("POST", "/db/pms/properties").body
    assert not [k for k in body if k.startswith("_")]


def test_create_generates_the_business_key_when_absent(api, fake):
    api.post("/api/properties", json={"city": "Mumbai"})

    generated = fake.last_call("POST", "/db/pms/properties").body["property_id"]
    assert generated.startswith("P-")
    assert len(generated) == len("P-") + 8


def test_create_does_not_overwrite_a_supplied_key(api, fake):
    api.post("/api/properties", json={"property_id": "P-EXISTING"})
    assert fake.last_call("POST", "/db/pms/properties").body["property_id"] == "P-EXISTING"


@pytest.mark.parametrize(
    "entity,prefix",
    [
        ("owners", "O"),
        ("properties", "P"),
        ("tenants", "T"),
        ("leases", "L"),
        ("work_orders", "WO"),
        ("vendors", "V"),
        ("transactions", "TX"),
        ("inspections", "I"),
        ("compliance", "POL"),
        ("daily_tasks", "DT"),
    ],
)
def test_generated_keys_use_the_documented_prefix(entity, prefix):
    key = _gen_key(get_entity(entity))
    # Uppercase hex, checked by pattern rather than `.isupper()` — an all-digit
    # suffix is a perfectly good key but is not "upper".
    assert re.fullmatch(rf"{prefix}-[0-9A-F]{{8}}", key), key


def test_generated_keys_are_unique():
    keys = {_gen_key(get_entity("properties")) for _ in range(500)}
    assert len(keys) == 500


def test_create_refetches_the_stored_record_so_system_fields_come_back(api, fake):
    """The client needs InventDB's `_id` to edit or delete the row it just made."""
    fake.on("POST", "/db/pms/properties", {"id": "srv-1"})
    fake.on_record("properties", "srv-1", {"_id": "srv-1", "city": "Mumbai", "_v": 1})

    resp = api.post("/api/properties", json={"city": "Mumbai"})

    assert resp.status_code == 201
    assert resp.get_json() == {"_id": "srv-1", "city": "Mumbai", "_v": 1}


def test_create_falls_back_to_the_submitted_data_if_the_refetch_fails(api, fake):
    fake.on("POST", "/db/pms/properties", {"id": "srv-1"})
    fake.on("GET", "/db/pms/properties/srv-1", {"error": "gone"}, status=404)

    resp = api.post("/api/properties", json={"city": "Mumbai"})
    body = resp.get_json()

    assert resp.status_code == 201
    assert body["city"] == "Mumbai"
    assert body["ok"] is True


def test_create_reports_a_null_id_when_inventdb_returns_none(api, fake):
    resp = api.post("/api/properties", json={"city": "Mumbai"})
    assert resp.status_code == 201
    assert resp.get_json()["_id"] is None


@pytest.mark.parametrize("body", ["[]", '"a string"', "12", "null", "not json at all"])
def test_create_rejects_a_non_object_body(api, fake, body):
    resp = api.post(
        "/api/properties", data=body, content_type="application/json"
    )
    assert resp.status_code == 400
    assert fake.calls == []


def test_create_propagates_an_upstream_validation_error(api, fake):
    fake.on("POST", "/db/pms/properties", {"error": "amount must be numeric"}, status=422)

    resp = api.post("/api/properties", json={"city": "Mumbai"})

    assert resp.status_code == 422
    assert resp.get_json()["error"] == "amount must be numeric"


# ===========================================================================
# Update — the read-merge-write cycle
# ===========================================================================


def test_update_merges_onto_the_stored_record(api, fake):
    """The edit form only submits the fields it renders. Without the merge, a
    PUT that replaces rather than patches would silently drop every other
    column — which is why the router reads first."""
    fake.on_record(
        "properties",
        "abc",
        {
            "_id": "abc",
            "property_id": "P-001",
            "city": "Mumbai",
            "state": "MH",
            "notes": "keep me",
        },
    )

    api.put("/api/properties/abc", json={"city": "Delhi"})

    sent = fake.last_call("PUT", "/db/pms/properties").body
    assert sent["city"] == "Delhi"  # the edit
    assert sent["state"] == "MH"  # untouched column survives
    assert sent["notes"] == "keep me"
    assert sent["property_id"] == "P-001"  # business key survives


def test_update_targets_the_record_by_id(api, fake):
    fake.on_record("properties", "abc", {"_id": "abc", "property_id": "P-001"})
    api.put("/api/properties/abc", json={"city": "Delhi"})
    assert fake.last_call("PUT", "/db/pms/properties").body["_id"] == "abc"


def test_update_ignores_a_client_supplied_id(api, fake):
    """A caller must not be able to redirect the write at another row."""
    fake.on_record("properties", "abc", {"_id": "abc", "property_id": "P-001"})

    api.put("/api/properties/abc", json={"_id": "somebody-elses-row", "city": "Delhi"})

    assert fake.last_call("PUT", "/db/pms/properties").body["_id"] == "abc"


def test_update_drops_system_fields_from_the_existing_record_too(api, fake):
    """Only `_id` is re-attached; other InventDB metadata is not echoed back."""
    fake.on_record(
        "properties",
        "abc",
        {"_id": "abc", "_created": "2024-01-01", "_v": 3, "property_id": "P-001"},
    )

    sent = (api.put("/api/properties/abc", json={"city": "Delhi"}), fake)[1].last_call(
        "PUT", "/db/pms/properties"
    ).body

    assert set(k for k in sent if k.startswith("_")) == {"_id"}


def test_update_still_writes_when_the_record_cannot_be_read_first(api, fake):
    """A read failure must not block the edit — the merge is best-effort."""
    fake.on("GET", "/db/pms/properties/abc", {"error": "transient"}, status=503)

    api.put("/api/properties/abc", json={"city": "Delhi"})

    sent = fake.last_call("PUT", "/db/pms/properties").body
    assert sent["city"] == "Delhi"
    assert sent["_id"] == "abc"


def test_update_mints_a_business_key_if_the_merge_produced_none(api, fake):
    fake.on("GET", "/db/pms/properties/abc", {"error": "gone"}, status=404)

    api.put("/api/properties/abc", json={"city": "Delhi"})

    assert fake.last_call("PUT", "/db/pms/properties").body["property_id"].startswith("P-")


def test_update_returns_the_refetched_record(api, fake):
    calls = {"n": 0}

    def _record(_call):
        from tests.fake_inventdb import Reply

        calls["n"] += 1
        city = "Mumbai" if calls["n"] == 1 else "Delhi"
        return Reply(200, {"_id": "abc", "city": city, "property_id": "P-001"})

    fake.on("GET", "/db/pms/properties/abc", None)
    fake._rules[-1].responder = _record

    body = api.put("/api/properties/abc", json={"city": "Delhi"}).get_json()

    assert body["city"] == "Delhi"
    assert calls["n"] == 2  # read for the merge, then read back


def test_update_falls_back_to_the_merged_document_if_the_readback_fails(api, fake):
    fake.on("GET", "/db/pms/properties/abc", {"error": "gone"}, status=404)

    body = api.put("/api/properties/abc", json={"city": "Delhi"}).get_json()

    assert body["city"] == "Delhi"
    assert body["ok"] is True


def test_update_propagates_an_upstream_write_failure(api, fake):
    fake.on_record("properties", "abc", {"_id": "abc", "property_id": "P-001"})
    fake.on("PUT", "/db/pms/properties", {"error": "read-only"}, status=403)

    resp = api.put("/api/properties/abc", json={"city": "Delhi"})

    assert resp.status_code == 403


@pytest.mark.parametrize("body", ["[]", "null", "7"])
def test_update_rejects_a_non_object_body(api, fake, body):
    resp = api.put("/api/properties/abc", data=body, content_type="application/json")
    assert resp.status_code == 400
    assert fake.calls == []


# ===========================================================================
# Delete
# ===========================================================================


def test_delete_calls_the_record_endpoint_and_echoes_the_id(api, fake):
    resp = api.delete("/api/properties/abc-123")

    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True, "id": "abc-123"}
    assert fake.last_call("DELETE").path == "/db/pms/properties/abc-123"


def test_delete_propagates_an_upstream_refusal(api, fake):
    fake.on(
        "DELETE",
        "/db/pms/properties/abc",
        {"error": "referenced by 3 leases"},
        status=409,
    )

    resp = api.delete("/api/properties/abc")

    assert resp.status_code == 409
    assert resp.get_json()["error"] == "referenced by 3 leases"


def test_delete_on_an_unknown_entity_never_reaches_inventdb(api, fake):
    assert api.delete("/api/nope/abc").status_code == 404
    assert fake.calls == []
