"""``app.routers.files`` — the drive over InventDB's attachments.

Three properties are worth protecting, and they are what these cover.

**The namespace is pinned.** SOAR's Files room browses every namespace the
caller can see; this app's window is its own. A request body must not be able
to widen that, because "show me my files" should never be a way to reach
another tenant's.

**Bounds are real, not advisory.** A page, a delete batch and an upload all
have ceilings; a caller asking past them gets clamped or refused rather than
handing the request straight upstream.

**Binary passes through.** Downloads and thumbnails are streamed, and the
bytes have to arrive unchanged with a filename the browser can use.
"""

from __future__ import annotations

import io

import pytest

FOLDERS = [
    {"namespace": "pms", "type": "leases", "path": "", "count": 3},
    {"namespace": "pms", "type": "leases", "path": "2026", "count": 2},
]
RESULTS = [{"_id": "att-1", "filename": "lease.pdf", "record_type": "leases", "record_id": "lea-1"}]


def search_reply(**overrides):
    body = {"results": RESULTS, "total_matches": 5, "folders": FOLDERS}
    body.update(overrides)
    return {"ok": True, "data": body}


def upload(name: str = "lease.pdf", content: bytes = b"%PDF-1.4 lease", ctype: str = "application/pdf"):
    """A multipart file part, as Werkzeug's test client wants it."""
    return {"file": (io.BytesIO(content), name, ctype)}


# ===========================================================================
# Searching and browsing
# ===========================================================================


def test_a_search_is_pinned_to_this_apps_namespace(api, fake):
    """The one property the whole room rests on."""
    api.post("/api/files/search", json={"query": "lease"})

    sent = fake.last_call("POST", "/attach/_search").body
    assert sent["namespaces"] == ["pms"]


@pytest.mark.parametrize(
    "attempt",
    [
        {"namespaces": ["other"]},
        {"namespaces": []},
        {"namespace": "other"},
    ],
)
def test_a_request_body_cannot_widen_the_namespace(api, fake, attempt):
    """A body field naming another namespace is not forwarded — the pin is
    applied last, so nothing earlier can have set it."""
    api.post("/api/files/search", json={"query": "*", **attempt})

    sent = fake.last_call("POST", "/attach/_search").body
    assert sent["namespaces"] == ["pms"]
    assert "namespace" not in sent


def test_the_response_carries_results_folders_and_a_total(api, fake):
    fake.on("POST", "/attach/_search", search_reply())

    body = api.post("/api/files/search", json={"query": "*"}).get_json()

    assert body == {"results": RESULTS, "total_matches": 5, "folders": FOLDERS}


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {}},
        {"ok": True, "data": None},
        None,
    ],
)
def test_an_empty_search_still_returns_arrays_never_null(api, fake, upstream):
    """The grid maps over `results` and the tree over `folders`, so `null`
    would be a crash rather than an empty drive."""
    fake.on("POST", "/attach/_search", upstream)

    assert api.post("/api/files/search", json={"query": "*"}).get_json() == {
        "results": [],
        "total_matches": 0,
        "folders": [],
    }


def test_an_empty_query_browses_rather_than_searching(api, fake):
    """`*` is InventDB's browse convention, and it is what the tree's
    aggregation pass sends."""
    api.post("/api/files/search", json={"query": "   "})
    assert fake.last_call("POST", "/attach/_search").body["query"] == "*"


def test_a_selected_type_scopes_the_search(api, fake):
    api.post("/api/files/search", json={"query": "*", "types": ["leases"], "folder": "2026"})

    sent = fake.last_call("POST", "/attach/_search").body
    assert sent["types"] == ["leases"]
    assert sent["folder"] == "2026"


def test_an_empty_folder_is_forwarded_because_it_means_the_type_root(api, fake):
    """Absent and empty differ here: no `folder` is "anywhere in this type",
    `""` is "the files sitting at its root"."""
    api.post("/api/files/search", json={"query": "*", "types": ["leases"], "folder": ""})
    assert fake.last_call("POST", "/attach/_search").body["folder"] == ""


def test_an_oversized_page_is_clamped_rather_than_refused(api, fake):
    """InventDB caps a page at 100. Clamping hands back the largest page that
    exists instead of an error the user can do nothing with."""
    api.post("/api/files/search", json={"query": "*", "limit": 5000})
    assert fake.last_call("POST", "/attach/_search").body["limit"] == 100


@pytest.mark.parametrize("search_type", ["keyword", "fulltext", "semantic", "combined"])
def test_every_search_mode_is_forwarded(api, fake, search_type):
    api.post("/api/files/search", json={"query": "x", "search_type": search_type})
    assert fake.last_call("POST", "/attach/_search").body["search_type"] == search_type


def test_an_unknown_search_mode_is_refused(api, fake):
    resp = api.post("/api/files/search", json={"query": "x", "search_type": "vibes"})
    assert resp.status_code == 400
    assert fake.calls == []


@pytest.mark.parametrize("bad", [{"types": "leases"}, {"types": [1]}, {"limit": "10"}, {"folder": 7}])
def test_a_malformed_search_never_reaches_inventdb(api, fake, bad):
    assert api.post("/api/files/search", json={"query": "*", **bad}).status_code == 400
    assert fake.calls == []


# ===========================================================================
# Bulk delete
# ===========================================================================


def test_deleting_a_folder_names_the_namespace_type_and_folder(api, fake):
    fake.on("POST", "/attach/_bulk_delete", {"ok": True, "data": {"deleted": 15, "skipped": 0}})

    body = api.post("/api/files/bulk-delete", json={"type": "leases", "folder": "2026"}).get_json()

    assert body == {"deleted": 15, "skipped": 0, "remaining": None}
    sent = fake.last_call("POST", "/attach/_bulk_delete").body
    assert sent["namespace"] == "pms"
    assert sent["type"] == "leases"
    assert sent["folder"] == "2026"


def test_deleting_a_whole_type_omits_the_folder(api, fake):
    """No folder means the type's entire file set, which is a different request
    from "the folder called empty-string"."""
    api.post("/api/files/bulk-delete", json={"type": "leases"})
    assert "folder" not in fake.last_call("POST", "/attach/_bulk_delete").body


def test_a_delete_is_one_batch_so_the_caller_can_show_progress(api, fake):
    api.post("/api/files/bulk-delete", json={"type": "leases"})
    assert fake.last_call("POST", "/attach/_bulk_delete").body["limit"] == 15


def test_an_unbounded_delete_batch_is_clamped(api, fake):
    """Without a ceiling one call could delete an entire type while the user
    watched a progress bar that never moved."""
    api.post("/api/files/bulk-delete", json={"type": "leases", "limit": 10_000})
    assert fake.last_call("POST", "/attach/_bulk_delete").body["limit"] == 100


def test_remaining_rides_back_when_inventdb_reports_it(api, fake):
    fake.on(
        "POST",
        "/attach/_bulk_delete",
        {"ok": True, "data": {"deleted": 15, "skipped": 2, "remaining": 40}},
    )
    assert api.post("/api/files/bulk-delete", json={"type": "leases"}).get_json() == {
        "deleted": 15,
        "skipped": 2,
        "remaining": 40,
    }


def test_a_delete_without_a_type_is_refused(api, fake):
    assert api.post("/api/files/bulk-delete", json={}).status_code == 400
    assert fake.calls == []


# ===========================================================================
# One record's files
# ===========================================================================


def test_uploading_sends_the_bytes_and_the_filename(api, fake):
    fake.on("POST", "/attach/pms/leases/lea-1", {"ok": True, "data": {"attachment_id": "att-9"}})

    resp = api.post(
        "/api/files/leases/lea-1",
        data=upload(),
        content_type="multipart/form-data",
    )

    assert resp.status_code == 201
    assert resp.get_json() == {"attachment_id": "att-9"}
    filename, content, ctype = fake.last_call("POST", "/attach/pms/leases/lea-1").upload
    assert filename == "lease.pdf"
    assert content == b"%PDF-1.4 lease"
    assert ctype == "application/pdf"


def test_uploading_into_a_folder_carries_the_path(api, fake):
    """A folder is a path stored on the attachment, so uploading into one is
    what creates it — there is nothing else to create."""
    api.post(
        "/api/files/leases/lea-1",
        data={**upload(), "folder": "2026/signed"},
        content_type="multipart/form-data",
    )
    assert fake.last_call("POST", "/attach/pms/leases/lea-1").data == {"folder_path": "2026/signed"}


def test_an_upload_with_no_folder_sends_none(api, fake):
    api.post("/api/files/leases/lea-1", data=upload(), content_type="multipart/form-data")
    assert fake.last_call("POST", "/attach/pms/leases/lea-1").data is None


@pytest.mark.parametrize(
    "payload",
    [
        {},  # no part at all
        {"file": (io.BytesIO(b""), "empty.pdf", "application/pdf")},  # zero bytes
    ],
)
def test_an_unusable_upload_is_refused_before_it_reaches_inventdb(api, fake, payload):
    resp = api.post("/api/files/leases/lea-1", data=payload, content_type="multipart/form-data")
    assert resp.status_code == 400
    assert fake.calls == []


def test_an_oversized_upload_is_refused(api, fake):
    """The ceiling is real: the bytes are read into memory to be forwarded."""
    big = {"file": (io.BytesIO(b"x" * (65 * 1024 * 1024)), "big.bin", "application/octet-stream")}
    resp = api.post("/api/files/leases/lea-1", data=big, content_type="multipart/form-data")
    assert resp.status_code == 413
    assert fake.calls == []


def test_listing_a_records_files_normalises_to_an_array(api, fake):
    fake.on("GET", "/attach/pms/leases/lea-1", {"ok": True, "data": {"attachments": RESULTS}})
    assert api.get("/api/files/leases/lea-1").get_json() == {"files": RESULTS}


def test_deleting_one_file_addresses_it_by_its_home(api, fake):
    api.delete("/api/files/leases/lea-1/att-1")
    assert fake.calls[-1].path == "/attach/pms/leases/lea-1/att-1"


def test_extracted_text_is_returned_as_an_object_even_when_sent_as_a_string(api, fake):
    """InventDB returns the text bare on some versions; the panel reads
    `.text` either way."""
    fake.on("GET", "/attach/pms/leases/lea-1/att-1/text", {"ok": True, "data": "Lease agreement…"})
    assert api.get("/api/files/leases/lea-1/att-1/text").get_json() == {"text": "Lease agreement…"}


# ===========================================================================
# Binary
# ===========================================================================


def test_a_download_streams_the_bytes_back_unchanged(api, fake):
    fake.on("GET", "/attach/pms/leases/lea-1/att-1/download", raw=b"%PDF-1.4 bytes")

    resp = api.get("/api/files/leases/lea-1/att-1/download?filename=lease.pdf")

    assert resp.status_code == 200
    assert resp.get_data() == b"%PDF-1.4 bytes"
    assert 'filename="lease.pdf"' in resp.headers["Content-Disposition"]


def test_a_download_offers_to_save_while_a_preview_displays(api, fake):
    """Same bytes, different intent — a preview that downloaded itself would
    make the detail panel useless."""
    fake.on("GET", "/attach/pms/leases/lea-1/att-1/download", raw=b"x")

    save = api.get("/api/files/leases/lea-1/att-1/download?filename=a.pdf")
    show = api.get("/api/files/leases/lea-1/att-1/preview")

    assert save.headers["Content-Disposition"].startswith("attachment")
    assert "Content-Disposition" not in show.headers or show.headers[
        "Content-Disposition"
    ].startswith("inline")


def test_a_thumbnail_asks_for_the_size_it_wants(api, fake):
    fake.on("GET", "/attach/pms/leases/lea-1/att-1/thumbnail", raw=b"\xff\xd8jpeg")

    resp = api.get("/api/files/leases/lea-1/att-1/thumbnail?size=128")

    assert resp.get_data() == b"\xff\xd8jpeg"
    assert fake.calls[-1].params == {"size": 128}


def test_an_absurd_thumbnail_size_is_clamped(api, fake):
    api.get("/api/files/leases/lea-1/att-1/thumbnail?size=99999")
    assert fake.calls[-1].params == {"size": 1024}


def test_a_missing_file_keeps_its_404(api, fake):
    fake.on("GET", "/attach/pms/leases/lea-1/att-x/download", {"error": "Not found"}, status=404)
    assert api.get("/api/files/leases/lea-1/att-x/download").status_code == 404


# ===========================================================================
# Giving a file a home
#
# A file uploaded through the drive (here, or from SOAR's Files room) lands in
# its type's vault with no parent record. Attaching is what answers the
# question a document exists to answer: which lease is this?
# ===========================================================================


def test_attaching_moves_the_file_onto_the_record(api, fake):
    fake.on(
        "POST",
        "/attach/pms/_relink",
        {"ok": True, "data": {"mode": "move", "parents": [{"namespace": "pms", "typeName": "leases", "recordId": "lea-1"}]}},
    )

    body = api.post(
        "/api/files/attach",
        json={"attachment_id": "att-1", "type": "leases", "record_id": "lea-1"},
    ).get_json()

    assert body["mode"] == "move"
    sent = fake.last_call("POST", "/attach/pms/_relink").body
    assert sent["attachment_id"] == "att-1"
    assert sent["target"] == {"namespace": "pms", "typeName": "leases", "recordId": "lea-1"}


def test_moving_is_the_default_because_a_vault_file_has_no_real_parent(api, fake):
    api.post("/api/files/attach", json={"attachment_id": "att-1", "type": "leases", "record_id": "lea-1"})
    assert fake.last_call("POST", "/attach/pms/_relink").body["mode"] == "move"


def test_a_file_can_belong_to_two_records(api, fake):
    """One invoice covering two work orders is a real case — `copy` adds a
    parent instead of replacing the first."""
    api.post(
        "/api/files/attach",
        json={"attachment_id": "att-1", "type": "work_orders", "record_id": "wo-2", "mode": "copy"},
    )
    assert fake.last_call("POST", "/attach/pms/_relink").body["mode"] == "copy"


def test_attaching_cannot_reach_another_namespace(api, fake):
    """The target namespace is this app's, not the caller's to choose."""
    api.post(
        "/api/files/attach",
        json={
            "attachment_id": "att-1",
            "type": "leases",
            "record_id": "lea-1",
            "namespace": "other",
            "target": {"namespace": "other", "typeName": "x", "recordId": "y"},
        },
    )
    sent = fake.last_call("POST", "/attach/pms/_relink").body
    assert sent["target"]["namespace"] == "pms"
    assert sent["target"]["typeName"] == "leases"


@pytest.mark.parametrize(
    "body,message",
    [
        ({"type": "leases", "record_id": "lea-1"}, "attachment_id is required"),
        ({"attachment_id": "att-1", "record_id": "lea-1"}, "type is required"),
        ({"attachment_id": "att-1", "type": "leases"}, "record_id is required"),
        ({"attachment_id": "att-1", "type": "leases", "record_id": "  "}, "record_id is required"),
    ],
)
def test_an_incomplete_attach_is_refused(api, fake, body, message):
    resp = api.post("/api/files/attach", json=body)
    assert resp.status_code == 400
    assert resp.get_json()["error"] == message
    assert fake.calls == []


def test_an_unknown_attach_mode_is_refused(api, fake):
    resp = api.post(
        "/api/files/attach",
        json={"attachment_id": "att-1", "type": "leases", "record_id": "lea-1", "mode": "teleport"},
    )
    assert resp.status_code == 400
    assert fake.calls == []


def test_an_invalid_target_type_never_reaches_the_upstream_body(api, fake):
    resp = api.post(
        "/api/files/attach",
        json={"attachment_id": "att-1", "type": "not a type!", "record_id": "lea-1"},
    )
    assert resp.status_code == 400
    assert fake.calls == []


# ===========================================================================
# Versions
# ===========================================================================


def test_version_history_is_normalised_to_an_array(api, fake):
    fake.on(
        "GET",
        "/attach/pms/leases/lea-1/att-1/versions",
        {"ok": True, "data": {"versions": [{"version": 1}]}},
    )
    assert api.get("/api/files/leases/lea-1/att-1/versions").get_json() == {
        "versions": [{"version": 1}]
    }


def test_uploading_again_adds_a_version_rather_than_replacing(api, fake):
    fake.on("POST", "/attach/pms/leases/lea-1/att-1/versions", {"ok": True, "data": {"version": 2}})

    resp = api.post(
        "/api/files/leases/lea-1/att-1/versions",
        data=upload("lease-v2.pdf"),
        content_type="multipart/form-data",
    )

    assert resp.status_code == 201
    assert fake.last_call("POST", "/attach/pms/leases/lea-1/att-1/versions").upload[0] == "lease-v2.pdf"


def test_restoring_makes_an_earlier_version_current(api, fake):
    api.post("/api/files/leases/lea-1/att-1/versions/2/restore", json={})
    assert fake.calls[-1].path == "/attach/pms/leases/lea-1/att-1/versions/2/restore"


def test_a_non_numeric_version_is_not_a_route(api, fake):
    """`<int:version>` keeps a crafted segment out of the upstream URL."""
    assert api.post("/api/files/leases/lea-1/att-1/versions/x/restore", json={}).status_code == 404
    assert fake.calls == []


def test_an_old_version_can_be_downloaded_without_restoring_it(api, fake):
    fake.on("GET", "/attach/pms/leases/lea-1/att-1/versions/1/download", raw=b"old")
    assert api.get("/api/files/leases/lea-1/att-1/versions/1/download").get_data() == b"old"


# ===========================================================================
# Auth
# ===========================================================================


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/files/search"),
        ("post", "/api/files/bulk-delete"),
        ("post", "/api/files/attach"),
        ("get", "/api/files/leases/lea-1"),
        ("get", "/api/files/leases/lea-1/att-1"),
        ("delete", "/api/files/leases/lea-1/att-1"),
        ("get", "/api/files/leases/lea-1/att-1/text"),
        ("get", "/api/files/leases/lea-1/att-1/download"),
        ("get", "/api/files/leases/lea-1/att-1/preview"),
        ("get", "/api/files/leases/lea-1/att-1/thumbnail"),
        ("get", "/api/files/leases/lea-1/att-1/versions"),
        ("post", "/api/files/leases/lea-1/att-1/versions/1/restore"),
    ],
)
def test_no_file_route_answers_without_authentication(api, fake, method, path):
    resp = getattr(api, method)(
        path,
        json={"type": "leases", "query": "*", "attachment_id": "att-1", "record_id": "lea-1"},
        token=None,
    )
    assert resp.status_code == 401
    assert fake.calls == []


def test_an_invalid_type_name_never_reaches_the_upstream_url(api, fake):
    """Type names are interpolated into the upstream path, so they go through
    the same identifier allow-list every other route uses."""
    assert api.get("/api/files/not-a-type!/lea-1").status_code == 400
    assert fake.calls == []
