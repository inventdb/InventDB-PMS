"""``app.routers.notifications`` — the inbox a parked run waits in.

The thing worth protecting here is that answering is not the same as reading.
A parked run resumes the moment a notification is resolved, and that run goes on
to email contractors and change records. So the tests below care most about the
edges where a resolve could happen by accident: a missing action id, a
malformed payload, a request that meant to mark something read.
"""

from __future__ import annotations

import pytest

WAITING = {
    "_id": "n-1",
    "title": "Assign a contractor: kitchen tap dripping",
    "body": "<p>Recommended: Coastal Plumbing</p>",
    "actions": [
        {"id": "approve", "label": "Assign", "kind": "approve"},
        {"id": "decline", "label": "Not now", "kind": "decline"},
    ],
    "run_id": "run-1",
    "workflow_id": "wf-1",
    "created_at": "2026-08-10T09:00:00Z",
}
INFO = {
    "_id": "n-2",
    "title": "Statements sent",
    "body": "12 owners emailed.",
    "actions": [],
    "created_at": "2026-08-11T09:00:00Z",
}


# ===========================================================================
# Listing
# ===========================================================================


@pytest.mark.parametrize(
    "upstream",
    [
        {"ok": True, "data": {"notifications": [INFO, WAITING]}},
        {"data": {"notifications": [INFO, WAITING]}},
        {"ok": True, "data": [INFO, WAITING]},
        {"notifications": [INFO, WAITING]},
        [INFO, WAITING],
    ],
)
def test_every_envelope_shape_lands_on_the_same_response(api, fake, upstream):
    fake.on("GET", "/api/workflows/notifications", upstream)

    body = api.get("/api/notifications").get_json()

    assert [n["_id"] for n in body["notifications"]] == ["n-2", "n-1"]


def test_the_inbox_comes_back_newest_first(api, fake):
    old = {**WAITING, "_id": "n-old", "created_at": "2020-01-01T00:00:00Z"}
    fake.on("GET", "/api/workflows/notifications", {"notifications": [old, INFO, WAITING]})

    body = api.get("/api/notifications").get_json()

    assert [n["_id"] for n in body["notifications"]] == ["n-2", "n-1", "n-old"]


def test_a_notification_with_no_timestamp_still_lists(api, fake):
    # Sorting must not throw on a row the engine wrote without `created_at`;
    # losing the whole inbox to one malformed row is worse than misordering it.
    fake.on("GET", "/api/workflows/notifications", {"notifications": [{"_id": "n-x"}, WAITING]})

    body = api.get("/api/notifications").get_json()

    assert {n["_id"] for n in body["notifications"]} == {"n-x", "n-1"}


def test_an_empty_inbox_is_an_empty_list_not_null(api, fake):
    fake.on("GET", "/api/workflows/notifications", {"ok": True, "data": {}})

    assert api.get("/api/notifications").get_json() == {"notifications": []}


def test_only_unread_is_forwarded_upstream(api, fake):
    fake.on("GET", "/api/workflows/notifications", {"notifications": []})

    api.get("/api/notifications?only_unread=true")

    assert fake.calls[-1].params == {"only_unread": "true"}


def test_the_default_listing_asks_for_everything(api, fake):
    fake.on("GET", "/api/workflows/notifications", {"notifications": []})

    api.get("/api/notifications")

    assert not fake.calls[-1].params


def test_listing_requires_a_token(api):
    assert api.get("/api/notifications", token=None).status_code == 401


# ===========================================================================
# Reading one
# ===========================================================================


def test_a_single_notification_is_unwrapped(api, fake):
    fake.on("GET", "/api/workflows/notifications/n-1", {"ok": True, "data": WAITING})

    assert api.get("/api/notifications/n-1").get_json() == WAITING


def test_marking_read_does_not_resolve_anything(api, fake):
    fake.on("POST", "/api/workflows/notifications/n-1/read", {"ok": True, "data": {"id": "n-1"}})

    api.post("/api/notifications/n-1/read")

    assert fake.calls[-1].path == "/api/workflows/notifications/n-1/read"
    assert not any("/resolve" in call.path for call in fake.calls)


# ===========================================================================
# Answering
# ===========================================================================


def test_resolving_forwards_the_action(api, fake):
    fake.on(
        "POST",
        "/api/workflows/notifications/n-1/resolve",
        {"ok": True, "data": {"resolved_action": "approve", "resumed": True}},
    )

    body = api.post("/api/notifications/n-1/resolve", json={"action_id": "approve"}).get_json()

    assert fake.calls[-1].body == {"action_id": "approve"}
    assert body["resumed"] is True


def test_a_form_answer_rides_along_as_the_payload(api, fake):
    fake.on("POST", "/api/workflows/notifications/n-1/resolve", {"ok": True, "data": {}})

    api.post(
        "/api/notifications/n-1/resolve",
        json={"action_id": "choose", "payload": {"vendor": "Nimbus Air"}},
    )

    assert fake.calls[-1].body == {
        "action_id": "choose",
        "payload": {"vendor": "Nimbus Air"},
    }


def test_no_payload_is_sent_when_none_was_given(api, fake):
    # An approve button submits nothing. Sending `payload: {}` would bind an
    # empty object into the resumed run, where the plan's override branch tests
    # `${decision.payload.vendor}` — and an empty object is not null.
    fake.on("POST", "/api/workflows/notifications/n-1/resolve", {"ok": True, "data": {}})

    api.post("/api/notifications/n-1/resolve", json={"action_id": "approve"})

    assert "payload" not in fake.calls[-1].body


@pytest.mark.parametrize("body", [{}, {"action_id": ""}, {"action_id": "   "}, {"action_id": 7}])
def test_resolving_without_naming_an_action_is_refused(api, fake, body):
    response = api.post("/api/notifications/n-1/resolve", json=body)

    assert response.status_code == 400
    # Refused before it reached InventDB: a resolve with no action would be a
    # guess at what the user meant, on a request that resumes a run.
    assert not any("/resolve" in call.path for call in fake.calls)


def test_a_non_object_payload_is_refused(api, fake):
    response = api.post(
        "/api/notifications/n-1/resolve", json={"action_id": "choose", "payload": "Nimbus"}
    )

    assert response.status_code == 400
    assert not any("/resolve" in call.path for call in fake.calls)


def test_an_already_answered_decision_reports_the_conflict(api, fake):
    # Someone else approved it first. That is an answer worth showing, not an
    # error to smooth over into a success.
    fake.on(
        "POST",
        "/api/workflows/notifications/n-1/resolve",
        {"ok": False, "error": "notification already resolved"},
        status=409,
    )

    response = api.post("/api/notifications/n-1/resolve", json={"action_id": "approve"})

    assert response.status_code == 409
    assert "already resolved" in response.get_json()["error"]


def test_an_unknown_action_id_is_rejected_upstream(api, fake):
    fake.on(
        "POST",
        "/api/workflows/notifications/n-1/resolve",
        {"ok": False, "error": "unknown action id"},
        status=400,
    )

    assert api.post("/api/notifications/n-1/resolve", json={"action_id": "nope"}).status_code == 400


def test_resolving_requires_a_token(api):
    response = api.post(
        "/api/notifications/n-1/resolve", json={"action_id": "approve"}, token=None
    )
    assert response.status_code == 401


# ===========================================================================
# Dismissing
# ===========================================================================


def test_dismissing_removes_only_the_inbox_item(api, fake):
    fake.on("DELETE", "/api/workflows/notifications/n-2", {"ok": True, "data": {"deleted": "n-2"}})

    body = api.delete("/api/notifications/n-2").get_json()

    assert body == {"deleted": "n-2"}
    assert fake.calls[-1].method == "DELETE"


# Percent-encoded, because that is the only way these survive as part of a path
# segment — Werkzeug decodes them into the route variable, so the id the handler
# receives really does contain a `?` or a `#`. Un-encoded they would end the
# path at the client and never be an id at all. Left unchecked, `?` appends
# query parameters to the upstream call and `#` truncates it.
@pytest.mark.parametrize("bad", ["../workflows", "n%201", "n-1%3Fx=1", "n-1%23f"])
def test_a_malformed_notification_id_never_reaches_inventdb(api, fake, bad):
    response = api.get(f"/api/notifications/{bad}")

    assert response.status_code in (400, 404)
    assert not any("/notifications/" in call.path for call in fake.calls)
