"""``app.routers.meta`` — the entity registry and the raw SQL passthrough.

``/api/meta/sql`` is the widest surface the app exposes: an authenticated caller
sends SQL and it runs. The only thing narrowing it is a prefix check, so most of
this file is about exactly what that check does and does not stop.
"""

from __future__ import annotations

import pytest

from app.entities import ENTITIES


# ===========================================================================
# The entity registry
# ===========================================================================


def test_entities_lists_every_registered_entity_in_registry_order(api):
    body = api.get("/api/meta/entities").get_json()

    assert [e["name"] for e in body["entities"]] == [e.name for e in ENTITIES]


def test_each_entity_carries_the_fields_the_frontend_renders_from(api):
    body = api.get("/api/meta/entities").get_json()

    for entry in body["entities"]:
        assert set(entry) == {
            "name",
            "label",
            "label_plural",
            "key",
            "search_fields",
            "order_by",
        }
        assert entry["name"] and entry["label"] and entry["key"]


def test_the_registry_needs_no_upstream_call(api, fake):
    """It is static data — serving it must not depend on InventDB being up."""
    api.get("/api/meta/entities")
    assert fake.calls == []


def test_labels_match_the_registry(api):
    body = api.get("/api/meta/entities").get_json()
    by_name = {e["name"]: e for e in body["entities"]}

    assert by_name["transactions"]["label_plural"] == "Accounting"
    assert by_name["work_orders"]["key"] == "wo"
    assert by_name["compliance"]["label"] == "Compliance Record"


# ===========================================================================
# Type / relationship discovery
# ===========================================================================


def test_types_proxies_the_namespace_type_listing(api, fake):
    fake.on("GET", "/api/namespaces/pms/types", {"types": ["properties"]})
    assert api.get("/api/meta/types").get_json() == {"types": ["properties"]}


def test_relationships_proxies_the_namespace_graph(api, fake):
    fake.on("GET", "/api/relationships/pms", {"edges": []})
    assert api.get("/api/meta/relationships").get_json() == {"edges": []}


@pytest.mark.parametrize("path", ["/api/meta/types", "/api/meta/relationships"])
def test_discovery_requires_authentication(api, fake, path):
    assert api.get(path, token=None).status_code == 401
    assert fake.calls == []


# ===========================================================================
# Raw SQL: what gets through
# ===========================================================================


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM pms.properties",
        "select 1",
        "  SELECT 1  ",
        "SeLeCt 1",
        "WITH x AS (SELECT 1) SELECT * FROM x",
        "with x as (select 1) select * from x",
    ],
)
def test_select_and_with_statements_are_allowed(api, fake, statement):
    resp = api.post("/api/meta/sql", json={"sql": statement})
    assert resp.status_code == 200
    assert len(fake.sql_log) == 1


@pytest.mark.parametrize(
    "statement",
    [
        "INSERT INTO pms.properties VALUES (1)",
        "UPDATE pms.properties SET city = 'x'",
        "DELETE FROM pms.properties",
        "DROP TABLE pms.properties",
        "TRUNCATE pms.properties",
        "ALTER TABLE pms.properties ADD col",
        "CREATE TABLE x (a int)",
        "GRANT ALL ON x TO y",
        "EXEC sp_who",
        "-- SELECT 1",  # a comment first is not a SELECT
        "/* c */ SELECT 1",
        "(SELECT 1)",  # a leading paren is not the allow-listed prefix
    ],
)
def test_non_read_statements_are_refused(api, fake, statement):
    resp = api.post("/api/meta/sql", json={"sql": statement})

    assert resp.status_code == 400
    assert "Only SELECT / WITH" in resp.get_json()["error"]
    assert fake.calls == [], "a refused statement must never reach InventDB"


@pytest.mark.parametrize("payload", [{}, {"sql": ""}, {"sql": "   "}, {"sql": ";"}, {"sql": None}])
def test_an_empty_statement_is_refused(api, fake, payload):
    resp = api.post("/api/meta/sql", json=payload)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "sql is required"
    assert fake.calls == []


def test_a_trailing_semicolon_is_stripped_before_execution(api, fake):
    api.post("/api/meta/sql", json={"sql": "SELECT 1;  "})
    assert fake.only_sql() == "SELECT 1"


def test_repeated_trailing_semicolons_are_not_all_stripped(api, fake):
    """`rstrip(";")` removes every trailing semicolon, then `.strip()` runs
    once — so `"SELECT 1; ;"` leaves nothing odd, but the whitespace between
    them survives. Pinned because the exact statement reaches the engine."""
    api.post("/api/meta/sql", json={"sql": "SELECT 1;;"})
    assert fake.only_sql() == "SELECT 1"


def test_results_are_returned_in_the_rows_envelope(api, fake):
    fake.on_sql(rows=[{"a": 1}])
    body = api.post("/api/meta/sql", json={"sql": "SELECT 1"}).get_json()
    assert body["rows"] == [{"a": 1}]


def test_sql_requires_authentication(api, fake):
    resp = api.post("/api/meta/sql", token=None, json={"sql": "SELECT 1"})
    assert resp.status_code == 401
    assert fake.calls == []


def test_a_missing_body_is_treated_as_an_empty_statement(api, fake):
    resp = api.post("/api/meta/sql")
    assert resp.status_code == 400


# ===========================================================================
# Raw SQL: the limits of a prefix check
# ===========================================================================


@pytest.mark.parametrize(
    "statement",
    [
        "SELECT 1; DROP TABLE pms.properties",
        "SELECT 1; DELETE FROM pms.leases",
        "select 1;update pms.properties set city='x'",
    ],
)
@pytest.mark.xfail(
    reason=(
        "KNOWN GAP: the guard only inspects the leading keyword, so a stacked "
        "statement passes it. Whether that is exploitable depends entirely on "
        "whether InventDB's /sql endpoint executes multiple statements per "
        "request — unverified against a live instance. Rejecting an interior "
        "semicolon would close it without needing to know."
    ),
)
def test_stacked_statements_should_be_refused(api, fake, statement):
    resp = api.post("/api/meta/sql", json={"sql": statement})
    assert resp.status_code == 400


def test_stacked_statements_currently_reach_inventdb_verbatim(api, fake):
    """Pins the blast radius of the gap above: the whole string is forwarded."""
    api.post("/api/meta/sql", json={"sql": "SELECT 1; DROP TABLE pms.properties"})
    assert fake.only_sql() == "SELECT 1; DROP TABLE pms.properties"


def test_the_guard_is_a_prefix_check_not_a_parser(api, fake):
    """A read-only statement that happens to mention a write keyword is fine —
    documenting that the check is intentionally shallow rather than semantic."""
    api.post(
        "/api/meta/sql",
        json={"sql": "SELECT 'DROP TABLE' AS label FROM pms.properties"},
    )
    assert "DROP TABLE" in fake.only_sql()


def test_row_level_security_is_the_real_boundary(api, fake):
    """The passthrough runs under the caller's own token, so InventDB's
    row-level security still applies to whatever the statement selects. That —
    not the prefix check — is what stops a read of another tenant's data."""
    api.post("/api/meta/sql", token="caller-jwt", json={"sql": "SELECT 1"})
    assert fake.calls[0].token == "caller-jwt"
