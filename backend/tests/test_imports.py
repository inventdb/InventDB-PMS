"""Spreadsheet import — the server half.

The workbook is parsed in the browser (SOAR's importer, ported), so nothing here
reads a sheet. What this router owns is narrow and worth pinning: a batch goes to
InventDB's bulk endpoint under the pinned namespace, InventDB's own `_`-prefixed
keys never travel back upstream, and a malformed batch is refused as the caller's
mistake rather than becoming a 500.
"""

from __future__ import annotations

import pytest

from tests.fake_inventdb import FakeInventDB


def test_a_batch_goes_to_the_bulk_endpoint(api, fake: FakeInventDB):
    resp = api.post(
        "/api/import/properties",
        json={"rows": [{"street": "44 Cedar Lane"}, {"street": "12 Oak Road"}]},
    )
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True, "created": 2, "type": "properties"}

    call = fake.last_call("POST")
    assert "/properties/bulk" in call.path
    assert [r["street"] for r in call.body] == ["44 Cedar Lane", "12 Oak Road"]


def test_the_namespace_is_pinned_server_side(api, fake: FakeInventDB):
    """The caller names a type, never a database."""
    api.post("/api/import/properties", json={"rows": [{"street": "x"}]})
    assert "/pms/properties/bulk" in fake.last_call("POST").path


def test_a_type_the_app_has_no_module_for_is_still_accepted(api, fake: FakeInventDB):
    """SOAR parity: the sheet names the type. InventDB is schemaless, so a type
    it has not seen is created on first write rather than refused here."""
    resp = api.post("/api/import/suppliers", json={"rows": [{"name": "Acme"}]})
    assert resp.status_code == 200
    assert "/suppliers/bulk" in fake.last_call("POST").path


def test_a_dangerous_type_name_never_reaches_inventdb(api, fake: FakeInventDB):
    """`bulk_insert` runs the name through `_safe_ident`; a caller must not be
    able to steer the upstream path."""
    resp = api.post("/api/import/pms.properties", json={"rows": [{"a": 1}]})
    assert resp.status_code >= 400
    assert fake.calls_to("POST") == []


def test_inventdb_keys_are_stripped(api, fake: FakeInventDB):
    """A sheet exported from the app carries _id; re-importing must not try to
    reuse it as an identity."""
    api.post(
        "/api/import/properties",
        json={"rows": [{"_id": "rec-1", "_createdAt": "x", "street": "44 Cedar Lane"}]},
    )
    written = fake.last_call("POST").body[0]
    assert written == {"street": "44 Cedar Lane"}


def test_typed_values_are_relayed_unchanged(api, fake: FakeInventDB):
    """The browser has already coerced these — numbers stay numeric, booleans
    boolean, dates plain. The server must not re-interpret them."""
    api.post(
        "/api/import/properties",
        json={"rows": [{"market_rent": 2100, "w_9_on_file": True, "lease_end": "2026-06-30"}]},
    )
    assert fake.last_call("POST").body[0] == {
        "market_rent": 2100,
        "w_9_on_file": True,
        "lease_end": "2026-06-30",
    }


def test_an_upstream_failure_is_reported_rather_than_swallowed(api, fake: FakeInventDB):
    """The browser retries or reports per batch, so a refused batch has to
    surface as an error and not a cheerful 200."""
    fake.on("POST", lambda c: "/bulk" in c.path, {"ok": False, "error": "type mismatch"}, status=400)
    resp = api.post("/api/import/properties", json={"rows": [{"street": "x"}]})
    assert resp.status_code >= 400


@pytest.mark.parametrize("body", [{}, {"rows": []}, {"rows": "nope"}, {"rows": [1, 2]}])
def test_a_malformed_body_is_a_client_error(api, body, fake: FakeInventDB):
    resp = api.post("/api/import/properties", json=body)
    assert resp.status_code == 400
    assert fake.calls_to("POST") == []


def test_rows_that_hold_only_underscore_keys_are_refused(api, fake: FakeInventDB):
    """Nothing would be written, so say so instead of reporting a silent success."""
    resp = api.post("/api/import/properties", json={"rows": [{"_id": "rec-1"}]})
    assert resp.status_code == 400
    assert fake.calls_to("POST") == []


def test_a_batch_over_the_ceiling_is_refused(api, fake: FakeInventDB):
    resp = api.post(
        "/api/import/properties", json={"rows": [{"street": "x"} for _ in range(5001)]}
    )
    assert resp.status_code == 400
    assert fake.calls_to("POST") == []


def test_importing_requires_a_token(api):
    resp = api.post("/api/import/properties", json={"rows": [{"street": "x"}]}, token=None)
    assert resp.status_code == 401
