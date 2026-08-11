"""``app.routers.maintenance`` — vendor matching and the intake automation.

Two properties matter more than the rest.

**The shortlist is a recommendation someone acts on.** It decides who gets sent
to a tenant's home. So the ordering rules — right trade first, insured over
uninsured, then rating — are pinned here rather than left to whatever the sort
key happens to do today.

**The plan is a contract with the engine.** It has to keep working unattended
against a live mailbox, and the parts of it that are easy to break silently are
the ones tested: that nothing irreversible sits before the approval step, that
the approval actually parks (it carries actions), and that each branch after it
is gated on a value only that branch produces.
"""

from __future__ import annotations

import pytest

VENDORS = [
    {
        "_id": "v-1",
        "company": "Coastal Plumbing",
        "trade": "Plumbing",
        "email": "ops@coastal.example",
        "rating": 4.6,
        "coi_on_file": True,
    },
    {
        "_id": "v-2",
        "company": "Budget Pipes",
        "trade": "Plumbing",
        "email": "hi@budget.example",
        "rating": 4.9,
        "coi_on_file": False,
    },
    {
        "_id": "v-3",
        "company": "Handy Helpers",
        "trade": "General",
        "email": "team@handy.example",
        "rating": 4.1,
        "coi_on_file": True,
    },
    {
        "_id": "v-4",
        "company": "Nimbus Air",
        "trade": "HVAC",
        "email": "book@nimbus.example",
        "rating": 4.2,
        "coi_on_file": True,
    },
]


@pytest.fixture
def vendors(fake):
    """Answer the router's vendor SELECT with the roster above."""
    fake.on_sql(lambda sql: "FROM pms.vendors" in sql, rows=VENDORS)
    return VENDORS


def step(plan, kind):
    return next(s for s in plan if s["kind"] == kind)


def steps(plan, kind):
    return [s for s in plan if s["kind"] == kind]


# ===========================================================================
# Who can fix this
# ===========================================================================


def test_the_right_trade_comes_first(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Plumbing&limit=3").get_json()

    # Handy Helpers services plumbing as a fallback, so it is listed — but never
    # above an actual plumber, whatever its rating.
    assert [v["company"] for v in body["vendors"]] == [
        "Coastal Plumbing",
        "Budget Pipes",
        "Handy Helpers",
    ]


def test_insurance_outranks_rating(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Plumbing").get_json()

    top, second = body["vendors"][0], body["vendors"][1]
    assert top["company"] == "Coastal Plumbing" and top["insured"] is True
    # Budget Pipes rates higher and still loses: sending an uninsured contractor
    # to a job is a different class of mistake from sending a mediocre one.
    assert second["company"] == "Budget Pipes" and second["rating"] > top["rating"]


def test_a_vendor_who_does_not_do_this_work_is_left_out(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Plumbing").get_json()

    assert "Nimbus Air" not in [v["company"] for v in body["vendors"]]


def test_each_candidate_says_why_it_matched(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Plumbing").get_json()

    assert body["vendors"][0]["why"] == (
        "Plumbing specialist, certificate of insurance on file, rated 4.6"
    )
    assert "no certificate of insurance on file" in body["vendors"][1]["why"]


def test_a_category_with_nobody_on_file_returns_an_empty_shortlist(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Roofing").get_json()

    # Empty, not an error, and not a fallback to somebody unqualified.
    assert body["vendors"] == []
    assert body["total_matched"] == 0


def test_the_shortlist_is_capped(api, vendors):
    body = api.get("/api/maintenance/vendors?category=Plumbing&limit=1").get_json()

    assert len(body["vendors"]) == 1
    # The cap is on what is returned, not on what was considered.
    assert body["total_matched"] == 3


@pytest.mark.parametrize(
    "query,status",
    [
        ("", 400),
        ("?category=", 400),
        ("?category=Nonsense", 400),
        ("?category=Plumbing&limit=abc", 400),
    ],
)
def test_a_bad_shortlist_request_is_refused(api, vendors, query, status):
    assert api.get(f"/api/maintenance/vendors{query}").status_code == status


def test_the_category_list_names_the_trades_that_service_each(api):
    body = api.get("/api/maintenance/categories").get_json()

    by_name = {c["category"]: c["trades"] for c in body["categories"]}
    assert by_name["Smoke Detector"] == ["Electrical", "General"]
    assert body["priorities"] == ["Low", "Medium", "High", "Emergency"]


@pytest.mark.parametrize("licensed", ["Electrical", "HVAC", "Roofing", "Pest Control"])
def test_licensed_work_never_falls_back_to_a_generalist(api, vendors, licensed):
    body = api.get(f"/api/maintenance/vendors?category={licensed}").get_json()

    # Handy Helpers is on file and would happily be ranked here if `General`
    # were listed as a fallback. Recommending a handyman for a roof or a
    # consumer unit is the kind of suggestion an approval screen makes look
    # considered, so the mapping refuses to make it at all.
    assert "General" not in body["trades"]
    assert "Handy Helpers" not in [v["company"] for v in body["vendors"]]


# ===========================================================================
# Installing the intake
# ===========================================================================


@pytest.fixture
def no_intake(fake, vendors):
    fake.on("GET", "/api/workflows", {"workflows": []})
    return fake


def created_plan(fake):
    """The plan the router actually sent upstream."""
    call = next(c for c in reversed(fake.calls) if c.method == "POST" and c.path == "/api/workflows")
    return call.body["plan"]


def test_installing_authors_the_intake_as_a_sandboxed_draft(api, no_intake, fake):
    fake.on("POST", "/api/workflows", {"ok": True, "data": {"_id": "wf-new"}}, status=201)

    response = api.post("/api/maintenance/intake", json={})

    assert response.status_code == 201
    assert response.get_json()["created"] is True
    sent = next(c for c in fake.calls if c.method == "POST" and c.path == "/api/workflows")
    assert sent.body["trigger_kind"] == "inbound_email"
    # It reads a live mailbox and emails real people. Nothing installed from a
    # button press should be able to do that before someone activates it.
    assert sent.body["sandbox"] is True


def test_installing_twice_returns_the_one_already_there(api, fake, vendors):
    existing = {"_id": "wf-1", "name": "Maintenance request intake", "active": True}
    fake.on("GET", "/api/workflows", {"workflows": [existing]})

    response = api.post("/api/maintenance/intake", json={})

    assert response.status_code == 200
    assert response.get_json() == {"created": False, "workflow": existing}
    # A second intake would double every acknowledgement the tenant receives.
    assert not any(c.method == "POST" and c.path == "/api/workflows" for c in fake.calls)


def test_a_live_intake_wins_over_an_abandoned_draft(api, fake, vendors):
    draft = {"_id": "wf-draft", "name": "Maintenance request intake", "pending_approval": True}
    live = {"_id": "wf-live", "name": "Maintenance request intake", "active": True}
    fake.on("GET", "/api/workflows", {"workflows": [draft, live]})

    body = api.get("/api/maintenance/intake").get_json()

    assert body["installed"] is True
    assert body["workflow"]["_id"] == "wf-live"


def test_installing_without_any_vendors_is_refused(api, fake):
    fake.on("GET", "/api/workflows", {"workflows": []})
    fake.on_sql(lambda sql: "FROM pms.vendors" in sql, rows=[])

    response = api.post("/api/maintenance/intake", json={})

    assert response.status_code == 400
    assert "no vendors on file" in response.get_json()["error"]


def test_a_gmail_label_narrows_the_trigger(api, no_intake, fake):
    fake.on("POST", "/api/workflows", {"ok": True, "data": {"_id": "wf-new"}}, status=201)

    api.post("/api/maintenance/intake", json={"gmail_label": " Maintenance "})

    sent = next(c for c in fake.calls if c.method == "POST" and c.path == "/api/workflows")
    assert sent.body["trigger_spec"] == {"gmail_label": "Maintenance"}


def test_no_label_means_every_inbound_message(api, no_intake, fake):
    fake.on("POST", "/api/workflows", {"ok": True, "data": {"_id": "wf-new"}}, status=201)

    api.post("/api/maintenance/intake", json={})

    sent = next(c for c in fake.calls if c.method == "POST" and c.path == "/api/workflows")
    assert sent.body["trigger_spec"] == {}


def test_a_non_string_label_is_refused(api, no_intake):
    assert api.post("/api/maintenance/intake", json={"gmail_label": 7}).status_code == 400


# ===========================================================================
# What the plan actually does
# ===========================================================================


@pytest.fixture
def plan(api, no_intake, fake):
    fake.on("POST", "/api/workflows", {"ok": True, "data": {"_id": "wf-new"}}, status=201)
    api.post("/api/maintenance/intake", json={})
    return created_plan(fake)


def test_nothing_irreversible_happens_before_the_approval(plan):
    park = next(i for i, s in enumerate(plan) if s["kind"] == "notify_user")
    before = plan[:park]

    # Acknowledging and recording commit nobody. Dispatching a contractor does,
    # so every step that reaches one has to sit after the park.
    assert [s["kind"] for s in before] == [
        "llm_extract",
        "sql_query",
        "sql_query",
        "insert_record",
        "send_email",
        "sql_query",
    ]


def test_a_relay_writing_on_a_tenants_behalf_is_answered_at_the_right_address(plan):
    read = step(plan, "llm_extract")
    ack = step(plan, "send_email")

    # A relay that sends "on behalf of" a tenant puts the real correspondent in
    # Reply-To, so the model is shown both headers and asked to choose. Replying
    # to `${event.from}` would acknowledge the relay and leave the tenant with
    # silence — the exact complaint the acknowledgement exists to prevent.
    assert "Reply-To: ${event.reply_to}" in read["source"]
    assert "reply_address" in read["schema"]["required"]
    assert ack["to"] == "${req.reply_address}"


def test_the_approval_step_parks_the_run(plan):
    ask = step(plan, "notify_user")

    # A notify_user with no actions is a bell, not a decision: the run sails
    # straight past it and dispatches a contractor nobody approved.
    assert [a["id"] for a in ask["actions"]] == ["approve", "choose", "decline"]
    assert [a["kind"] for a in ask["actions"]] == ["approve", "form", "decline"]
    # The answer has to land somewhere the branches below can read.
    assert ask["save_as"] == "decision"


def test_the_override_action_asks_for_the_contractor_by_name(plan):
    choose = next(a for a in step(plan, "notify_user")["actions"] if a["id"] == "choose")

    assert choose["form_fields"] == [
        {"name": "vendor", "type": "text", "required": True, "label": "Contractor (company name)"}
    ]


def test_each_assignment_branch_is_gated_on_its_own_answer(plan):
    approve_branch, override_branch = steps(plan, "update_record")

    # The engine has no if/else — a step runs or is skipped — so the two paths
    # must key off values only their own path produces. `approved` is false for
    # a form answer; `payload.vendor` is null for a plain approve.
    assert approve_branch["when"] == "${decision.approved}"
    assert approve_branch["fields"]["vendor"] == "${vendors.first.company}"
    assert override_branch["when"] == "${decision.payload.vendor}"
    assert override_branch["fields"]["vendor"] == "${decision.payload.vendor}"


def test_declining_assigns_nobody(plan):
    gated = [s["when"] for s in plan if s["kind"] in ("update_record", "send_email") and s.get("when")]

    # Declining sets neither `approved` nor a payload, so every step that
    # touches the work order or the contractor is skipped and the work order is
    # left open.
    assert all(w in ("${decision.approved}", "${decision.payload.vendor}", "${req.is_maintenance}") for w in gated)
    assert any(w == "${decision.approved}" for w in gated)


def test_the_contractor_is_only_emailed_on_a_plain_approval(plan):
    brief = [s for s in steps(plan, "send_email") if s["to"] == "${vendors.first.email}"]

    assert len(brief) == 1
    assert brief[0]["when"] == "${decision.approved}"


def test_an_email_that_is_not_a_maintenance_request_does_nothing(plan):
    # The reading step decides; everything downstream of it is gated on that
    # verdict, so a rent question does not open a work order.
    after_read = plan[1:]
    acting = [s for s in after_read if s["kind"] in ("insert_record", "send_email", "notify_user")]
    assert all(s.get("when") for s in acting)


def test_the_reading_step_only_offers_trades_that_exist_on_file(plan):
    schema = step(plan, "llm_extract")["schema"]

    # A model free to answer "Handyman" when nobody on file is one produces a
    # shortlist of nobody, and the run parks recommending a contractor that does
    # not exist.
    assert schema["properties"]["trade"]["enum"] == ["General", "HVAC", "Plumbing"]


def test_the_work_order_is_opened_unassigned(plan):
    record = step(plan, "insert_record")["record"]

    assert record["status"] == "Open"
    assert "vendor" not in record


def test_the_shortlist_query_matches_the_trade_the_reader_chose(plan):
    sql = steps(plan, "sql_query")[-1]["sql"]

    assert "lower(trade) = lower('${req.trade}')" in sql
    assert "ORDER BY coi_on_file DESC, rating DESC" in sql


def test_step_indices_are_contiguous(plan):
    assert [s["idx"] for s in plan] == list(range(len(plan)))


def test_every_step_carries_the_label_and_narration_the_engine_requires(plan):
    assert all("label" in s and s["label"] for s in plan)
    assert all("narration" in s for s in plan)


# ===========================================================================
# Readiness
# ===========================================================================


def test_the_status_reports_which_categories_have_nobody(api, fake, vendors):
    fake.on("GET", "/api/workflows", {"workflows": []})

    body = api.get("/api/maintenance/intake").get_json()

    assert body["installed"] is False
    assert body["trades_on_file"] == ["General", "HVAC", "Plumbing"]
    # An intake that reads the mailbox perfectly and finds nobody to send is not
    # working. Say so before the first real request, not when one parks empty.
    assert "Roofing" in body["uncovered"]
    assert "Plumbing" not in body["uncovered"]


def test_status_requires_a_token(api):
    assert api.get("/api/maintenance/intake", token=None).status_code == 401
