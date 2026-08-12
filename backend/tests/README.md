# Backend test suite

732 tests over the Flask API, the InventDB client and the SQL helpers. No
network, no live instance, no database — the whole suite runs in about ten
seconds.

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest                     # everything
python -m pytest tests/test_sqlutil.py -v
python -m pytest -m contract         # just the cross-suite contract checks
```

## How it works

The app reaches InventDB through exactly one function — `requests.request`,
called from `InventDBClient._request`. `tests/fake_inventdb.py` replaces that
single call, which swaps out the entire upstream while leaving every layer above
it real: URL building, header construction, error-envelope parsing, and the SQL
the routers compose.

That is what lets a test say *"given this request, the app sent InventDB exactly
this statement"*:

```python
def test_arbitrary_query_params_become_equality_filters(api, fake):
    api.get("/api/properties", query_string={"city": "Mumbai"})
    assert fake.sql_log[0] == (
        "SELECT * FROM pms.properties WHERE city = 'Mumbai' "
        "ORDER BY street ASC LIMIT 500 OFFSET 0"
    )
```

Stubbing `InventDBClient` instead would have meant asserting against a mock of
the code under test.

Rules are matched in reverse registration order, so a rule a test registers
beats one a fixture installed — the same override semantics as the frontend's
Playwright mock, so the two suites read alike.

### Files

| File | Covers |
| --- | --- |
| `test_sqlutil.py` | Quoting, escaping, identifier allow-listing. The security core. |
| `test_resources.py` | Generic CRUD: composed SQL, paging clamps, filters, search, the PUT merge. |
| `test_inventdb_client.py` | Upstream paths, auth headers, response and error parsing, envelope unwrapping. |
| `test_auth.py` | Credential validation and status pass-through. |
| `test_meta.py` | Entity registry and the raw-SQL guard. |
| `test_dashboard.py` | Occupancy, the expiring-lease window, month bucketing, coercion helpers. |
| `test_reports.py` | Saved-report proxying, parameter binding, and the six SQL rollups. |
| `test_workflows.py` | Every envelope shape InventDB might return, and the authoring boundary: what the router forwards on create/edit, what it refuses to forward (engine-owned state like `active`), and that lifecycle and sandbox stay independent. |
| `test_report_studio.py` | Report authoring: what a rename may change, the relayed edit stream, and collapsing a snapshot's two files into one report. |
| `test_analyze.py` | The AI seam: the relayed agent stream, the pinned namespace, the read-only SQL guard, and forcing a change-set into this app's namespace. |
| `test_files.py` | The drive over attachments: that the namespace is pinned and a request body cannot widen it, that page/batch/upload ceilings are real, and that binary passes through unchanged. |
| `test_settings.py` | Repointing the app at another InventDB: who may, what counts as a safe URL, and the probe that stops a typo stranding everyone. |
| `test_app.py` | Error handlers, CORS, SPA hosting. |
| `contract/` | The shape agreement with the frontend — see below. |

## The contract layer

`contract/` is what stops the frontend's E2E mock and this backend drifting apart.

```
backend/tests/contract/
  spec.py                     the shapes, mirroring frontend/src/types.ts
  capture.py                  records real InventDB responses
  recordings/inventdb.json    what InventDB replied
  test_contract.py            replays them through the real app
contract/                     (repo root — published, read by both suites)
  api-contract.json           the shapes, as JSON
  responses/*.json            what the backend actually returned
frontend/e2e/contract.spec.ts holds the mock to the same contract
```

The backend test replays the recordings through the real Flask app, checks the
output against `spec.py`, and publishes both the contract and the app's actual
responses. The Playwright spec asks the *mock* for the same endpoints and
validates against the same published JSON. A change on either side that the
other has not followed now fails on that side.

Two guards keep this from rotting into a test of nothing: a query with no
recording is reported as a failure rather than answered with an empty result,
and endpoints that replay to empty responses are rejected.

### Refreshing the recordings

The committed recordings are **synthetic** — shaped like InventDB's responses
but invented, because this repo carries no credentials. The `source` field in
`recordings/inventdb.json` says which kind you are looking at. To replace them
with real ones:

```bash
cd backend
INVENTDB_BASE_URL=https://<slug>.sandbox.inventdb.com \
INVENTDB_USERNAME=you INVENTDB_PASSWORD=... \
python -m tests.contract.capture
```

That drives the real app with a recording wrapper around `requests.request`, so
whatever the app asks InventDB for is what gets recorded — the recordings update
themselves when the app's queries change. Reads only by default; pass
`--include-writes` to capture create/update/delete, which **writes to the live
namespace**. Credentials are stripped before anything is written.

After a change to a response shape:

```bash
UPDATE_CONTRACT=1 python -m pytest tests/contract     # republish
cd ../frontend && npx playwright test contract.spec.ts # check the mock followed
```

## Known defects

Tests marked `@pytest.mark.xfail` document bugs found while writing this rather
than asserting the buggy behaviour is correct. `xfail_strict = true` is set, so
fixing one turns its test into a failure — that is the prompt to delete the
marker.

**Unresolved, ordered by how much they would cost to get wrong:**

1. **`sql_literal` does not escape backslashes** (`test_sqlutil.py`). In
   strict-SQL engines a backslash in a quoted literal is just a backslash and
   this is correct. In MySQL-style engines it escapes, and a value ending in a
   lone backslash would break out of the literal — a live injection. Escaping
   blindly would corrupt legitimate data (Windows paths) on the engines that do
   not need it, so this needs an answer about InventDB's dialect rather than a
   guess. **Worth resolving first.**

2. **Record ids are not validated** (`test_inventdb_client.py`, xfail). They are
   interpolated straight into the upstream URL, so `?` appends query parameters
   to the internal API call and `#` truncates the path. `_safe_id` already
   exists, rejects all of it, and is applied to report-template ids but not to
   record ids. Path traversal via `%2f` is separately blocked by Werkzeug's
   router. The fix is one call per site; it is left alone only because it would
   break every read if InventDB's real `_id` format is wider than
   `[A-Za-z0-9_-]{1,128}`.

3. **`/api/meta/sql` only inspects the leading keyword** (`test_meta.py`,
   xfail), so `SELECT 1; DROP TABLE …` passes the guard and is forwarded
   verbatim. Whether that is exploitable depends on whether InventDB's `/sql`
   executes multiple statements per request — unverified. Rejecting an interior
   semicolon would close it without needing to know.

4. **`_parse` assumes a dict error body** (`test_inventdb_client.py`, xfail). A
   JSON *array* error body raises `AttributeError`, which the catch-all handler
   reports as a 500 — hiding the real upstream status.

5. **Non-numeric `limit`/`offset` return 500, not 400** (`test_resources.py`,
   xfail), with the raw Python exception text in the body. `/api/reports/
   renewals?days=abc` handles the same situation correctly, so the two paths
   disagree.

6. **The two `_num` helpers disagree** (`test_reports.py`).
   `dashboard._num` strips `$` and thousands separators; `reports._num` calls
   `float()` directly. The same lease contributes 1500 to the dashboard's
   expected rent and 0 to the rent roll's monthly total, silently, whenever an
   amount is stored as a formatted string.

7. **`dashboard._dist` labels a missing column `"None"`** (`test_dashboard.py`).
   `str(r.get(field)).strip() or "Unknown"` — `str(None)` is `"None"`, which is
   truthy, so the `"Unknown"` fallback is only reachable for an empty string.
   The chart legend can show both, meaning the same thing.

8. **`reports.py` hardcodes `NS = "pms"`** (`test_reports.py`) instead of the
   client's configured namespace, unlike every other router. Deploying against a
   differently-named namespace leaves those six endpoints querying a namespace
   that does not exist while the rest of the app works.

9. **The catch-all 500 handler echoes `str(exc)`** to the client
   (`test_app.py`). Fine for a sandbox; worth revisiting before an untrusted
   deployment.

10. **`like_literal` is unused**, and its docstring claims it escapes wildcards
    when it does not (`test_sqlutil.py`). A search for `100%` would match
    everything.

**Fixed while writing these:**

- `ident`, `_safe_ident` and `_safe_id` used `re.match` with a `$`-anchored
  pattern. Python's `$` also matches immediately before a trailing newline, so
  the allow-lists accepted `"properties\n"`. Now `re.fullmatch`.
- The frontend mock's `/api/meta/entities` returned only `{name, key}`; the
  backend returns four more fields. It now serves the backend's captured
  response.
- The frontend mock's error responses omitted `ok: false`, which the backend
  always sends.
