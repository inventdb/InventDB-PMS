"""Maintenance intake — turning a request email into an assigned work order.

A tenant emails "the kitchen tap has been dripping for three days", or a
neighbour writes on their behalf. Four things then have to happen, in order, and
only one of them is a judgement call:

1. **Acknowledge it.** The tenant needs to know it landed. Silence is the
   complaint that follows the complaint.
2. **Record it.** A work order, on the right property, against the right tenant.
3. **Find someone to fix it.** Match the trade to the vendors actually on file.
4. **Ask the manager.** Which vendor goes to which job, at whose cost, is not
   the software's decision.

This module builds the automation that does 1–3 and then *stops* at 4. It stops
by parking the run on a notification — see :mod:`.notifications` — so the pause
is not a reminder to go and do the work by hand, it is the work held mid-flight.
Answering it resumes the same run, which then assigns the vendor and briefs
them.

Two things are deliberately not here:

* **The engine.** InventDB polls the mailbox, routes the message, runs the plan
  and parks the run. This module authors the plan and reads vendors; it executes
  nothing.
* **A second way to assign a vendor.** The approval resumes a run whose next
  step does the assignment. A PMS endpoint that also wrote `work_orders.vendor`
  would race that step and leave the run assigning over the top of it.

The plan is authored here rather than by the assistant on purpose. An intake
that runs unattended against real mail has to be the *same* plan every time it
is installed — reviewable, diffable, and fixable in one place — which is exactly
what a generated one is not.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..errors import ApiError
from ..inventdb import InventDBClient

bp = Blueprint("maintenance", __name__, url_prefix="/api/maintenance")

# The name the intake workflow is installed under. Also how it is found again:
# InventDB has no "kind" on a workflow, so the name is the handle. Changing it
# orphans the installed one rather than upgrading it.
INTAKE_NAME = "Maintenance request intake"

# Work-order categories the PMS offers (mirrors `config/entities.ts`) mapped to
# the vendor trades that can service them, best fit first. The mapping is
# many-to-many because the two vocabularies are not the same one: a work order
# is filed under what broke, a vendor is listed under what they do.
#
# Which categories accept a generalist is a safety judgement, not a convenience
# one. Licensed and specialist work — electrical, gas-adjacent HVAC, roofs,
# pests — lists only its own trade, so an empty shortlist parks the run asking
# for a decision rather than quietly recommending a handyman for a job they
# should not take. Matching is case-insensitive.
CATEGORY_TRADES: dict[str, tuple[str, ...]] = {
    "Plumbing": ("Plumbing", "General"),
    "Electrical": ("Electrical",),
    "HVAC": ("HVAC",),
    "Appliance": ("Appliance", "General"),
    "General": ("General", "Handyman"),
    "Doors/Windows": ("Carpentry", "General", "Handyman"),
    "Landscaping": ("Landscaping", "General"),
    "Roofing": ("Roofing",),
    "Pest Control": ("Pest Control",),
    "Locks/Keys": ("Locksmith", "Carpentry", "General"),
    "Smoke Detector": ("Electrical", "General"),
    "Painting": ("Painting", "General"),
    "Flooring": ("Flooring", "Carpentry", "General"),
}

PRIORITIES = ("Low", "Medium", "High", "Emergency")

_MAX_SHORTLIST = 10


def _data(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _sql_str(value: str) -> str:
    """Escape a value for a single-quoted SQL literal."""
    return str(value).replace("'", "''")


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes", "y")


# ===========================================================================
# Who can fix this
# ===========================================================================


def _rank_vendors(vendors: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    """Order the vendors on file by how well they fit this category.

    The ranking is explicit rather than a single score because the reason a
    vendor came top is shown to the person approving the assignment, and "4.6
    stars" is not a reason — "roofer, insured, 4.6" is.

    Insurance outranks rating on purpose: sending an uninsured contractor to a
    job is a different kind of mistake from sending a mediocre one.
    """
    wanted = CATEGORY_TRADES.get(category, ("General",))
    lowered = [t.lower() for t in wanted]

    ranked: list[dict[str, Any]] = []
    for vendor in vendors:
        trade = str(vendor.get("trade") or "").strip()
        if not trade:
            continue
        try:
            position = lowered.index(trade.lower())
        except ValueError:
            continue  # This vendor does not do this kind of work.
        insured = _truthy(vendor.get("coi_on_file"))
        reasons = [f"{trade} specialist" if position == 0 else f"covers {trade} work"]
        if insured:
            reasons.append("certificate of insurance on file")
        else:
            reasons.append("no certificate of insurance on file")
        rating = _num(vendor.get("rating"))
        if rating:
            reasons.append(f"rated {rating:g}")
        ranked.append(
            {
                **vendor,
                "match_rank": position,
                "insured": insured,
                "why": ", ".join(reasons),
            }
        )

    ranked.sort(
        key=lambda v: (v["match_rank"], not v["insured"], -_num(v.get("rating")), str(v.get("company") or ""))
    )
    return ranked


def _vendor_rows(client: InventDBClient) -> list[dict[str, Any]]:
    return client.query_rows(
        f"SELECT _id, vendor_id, company, trade, contact, phone, email, rating, "
        f"coi_on_file, w_9_on_file FROM {client.namespace}.vendors LIMIT 500"
    )


@bp.get("/vendors")
def suitable_vendors():
    """The vendors who could take this job, best fit first.

    Used both by the approval review — so a manager can see who else was in the
    running — and by the intake setup screen, which shows what the automation
    would pick today. Both read this one ranking, so the preview cannot promise
    a vendor the workflow would not choose.
    """
    client = authed_client()
    category = str(request.args.get("category") or "").strip()
    if not category:
        raise ApiError(400, "category is required")
    if category not in CATEGORY_TRADES:
        raise ApiError(400, f"Unknown category: {category!r}")

    try:
        limit = int(request.args.get("limit", 3))
    except (TypeError, ValueError):
        raise ApiError(400, "limit must be a whole number")
    limit = max(1, min(limit, _MAX_SHORTLIST))

    ranked = _rank_vendors(_vendor_rows(client), category)
    return jsonify(
        {
            "category": category,
            "trades": list(CATEGORY_TRADES[category]),
            "vendors": ranked[:limit],
            "total_matched": len(ranked),
        }
    )


@bp.get("/categories")
def categories():
    """What the PMS files maintenance under, and who services each."""
    return jsonify(
        {
            "categories": [
                {"category": name, "trades": list(trades)}
                for name, trades in CATEGORY_TRADES.items()
            ],
            "priorities": list(PRIORITIES),
        }
    )


# ===========================================================================
# The intake automation
# ===========================================================================


def _extract_schema(trades: list[str]) -> dict[str, Any]:
    """The shape the reading step must return.

    `trade` is constrained to the trades that exist on this instance rather than
    to a fixed vocabulary: a model free to answer "Handyman" when nobody on file
    is a handyman produces a shortlist of nobody, and the run parks asking to
    approve a vendor that does not exist.
    """
    return {
        "type": "object",
        "properties": {
            "issue": {"type": "string", "description": "One line describing what is wrong."},
            "category": {"type": "string", "enum": list(CATEGORY_TRADES)},
            "trade": {"type": "string", "enum": trades or ["General"]},
            "priority": {"type": "string", "enum": list(PRIORITIES)},
            "tenant_email": {
                "type": "string",
                "description": (
                    "The tenant's own email address. When someone writes on the "
                    "tenant's behalf and gives the tenant's address, use that; "
                    "otherwise use the sender's."
                ),
            },
            # The engine surfaces Reply-To on the event because mail relays that
            # send "on behalf of" someone put the real originator there. Making
            # the model choose between the two headers is the only way to get
            # this right: the plan has no way to express "this one, unless it is
            # empty", and acknowledging to the relay means the tenant hears
            # nothing at all.
            "reply_address": {
                "type": "string",
                "description": (
                    "The address to reply to. Use Reply-To when it is present and "
                    "different from From — a relay sending on someone's behalf puts "
                    "the real correspondent there. Otherwise use From."
                ),
            },
            "tenant_name": {"type": "string"},
            "is_maintenance": {
                "type": "boolean",
                "description": "False if this email is not a maintenance or repair request at all.",
            },
        },
        "required": [
            "issue",
            "category",
            "trade",
            "priority",
            "reply_address",
            "is_maintenance",
        ],
    }


def _intake_plan(namespace: str, trades: list[str]) -> list[dict[str, Any]]:
    """The eleven steps, in the order a person would do them.

    Every `${…}` is resolved by the engine at run time from the steps above it.
    Two rules shape the plan:

    * **Nothing irreversible before the human.** The acknowledgement and the
      work order are safe to do unasked — recording a request and saying "we got
      it" commits nobody. Dispatching a contractor is not, so it sits after the
      park.
    * **Every branch is a `when` on the decision.** The engine has no if/else;
      a step either runs or is skipped. So approve and override are two separate
      assignment steps, each gated on a value only its own path produces, and
      declining simply runs neither.
    """
    ns = namespace
    return [
        {
            "idx": 0,
            "kind": "llm_extract",
            "label": "Read the request",
            "narration": (
                "Pulls out what is broken, how urgent it is and which trade it needs — "
                "whether the tenant wrote in themselves or someone wrote for them."
            ),
            "save_as": "req",
            "prompt": (
                "This is an inbound email to a property management office. Decide whether it "
                "is a maintenance or repair request. If it is, summarise the issue in one "
                "line, classify it, and judge its urgency: Emergency for anything unsafe or "
                "actively causing damage (no heat in winter, flooding, gas, no power), High "
                "for no hot water or a failed appliance, Medium for ordinary repairs, Low for "
                "cosmetic. Set is_maintenance to false for anything else — rent questions, "
                "notices, spam — and leave the other fields as best you can."
            ),
            "source": (
                "From: ${event.from}\n"
                "Reply-To: ${event.reply_to}\n"
                "Subject: ${event.subject}\n\n"
                "${event.body}"
            ),
            "schema": _extract_schema(trades),
        },
        {
            "idx": 1,
            "kind": "sql_query",
            "label": "Identify the tenant",
            "narration": "Matches the address the request came from against the tenant roll.",
            "when": "${req.is_maintenance}",
            "save_as": "tenant",
            "sql": (
                f"SELECT _id, tenant_id, first, last, email, phone, property_id "
                f"FROM {ns}.tenants "
                f"WHERE lower(email) = lower('${{req.tenant_email}}') "
                f"OR lower(email) = lower('${{req.reply_address}}') LIMIT 1"
            ),
        },
        {
            "idx": 2,
            "kind": "sql_query",
            "label": "Find the property",
            "narration": "Resolves the tenant's property so the work order is filed against it.",
            "when": "${tenant.first.property_id}",
            "save_as": "prop",
            "sql": (
                f"SELECT _id, property_id, street, city FROM {ns}.properties "
                f"WHERE property_id = '${{tenant.first.property_id}}' LIMIT 1"
            ),
        },
        {
            "idx": 3,
            "kind": "insert_record",
            "label": "Open a work order",
            "narration": "Records the request as a work order, unassigned, before anyone is contacted.",
            "when": "${req.is_maintenance}",
            "save_as": "wo",
            "namespace": ns,
            "type_name": "work_orders",
            "record": {
                "date_opened": "${today}",
                "issue": "${req.issue}",
                "property_id": "${tenant.first.property_id}",
                "tenant_id": "${tenant.first.tenant_id}",
                "category": "${req.category}",
                "priority": "${req.priority}",
                "status": "Open",
            },
        },
        {
            "idx": 4,
            "kind": "send_email",
            "label": "Acknowledge the request",
            "narration": "Replies to whoever wrote in, so the request is visibly received.",
            "when": "${req.is_maintenance}",
            # Not `${event.from}`: when a relay sends on a tenant's behalf, From
            # is the relay and the tenant would never hear back.
            "to": "${req.reply_address}",
            "subject": "Re: ${event.subject} — we have your maintenance request",
            "body": (
                "<p>Thank you — we have logged your maintenance request and it is with our "
                "team now.</p>"
                "<p><strong>What you reported:</strong> ${req.issue}<br>"
                "<strong>Priority:</strong> ${req.priority}<br>"
                "<strong>Property:</strong> ${prop.first.street}, ${prop.first.city}</p>"
                "<p>We are arranging a suitable contractor and will confirm the visit as soon "
                "as it is booked. If anything about this becomes urgent in the meantime, "
                "please reply to this email.</p>"
            ),
        },
        {
            "idx": 5,
            "kind": "sql_query",
            "label": "Shortlist a contractor",
            "narration": (
                "Ranks the vendors who do this trade — insured first, then by rating — "
                "and takes the top three."
            ),
            "when": "${req.is_maintenance}",
            "save_as": "vendors",
            "sql": (
                f"SELECT company, trade, contact, phone, email, rating, coi_on_file "
                f"FROM {ns}.vendors WHERE lower(trade) = lower('${{req.trade}}') "
                f"ORDER BY coi_on_file DESC, rating DESC LIMIT 3"
            ),
        },
        {
            "idx": 6,
            "kind": "notify_user",
            "label": "Ask before dispatching",
            "narration": (
                "Parks the run. Nobody is contacted and no cost is committed until this is "
                "answered — and answering it resumes this same run."
            ),
            "when": "${req.is_maintenance}",
            "save_as": "decision",
            "title": "Assign a contractor: ${req.issue}",
            "body": (
                "<p><strong>${req.priority} priority</strong> — ${req.category}</p>"
                "<p><strong>Property:</strong> ${prop.first.street}, ${prop.first.city}<br>"
                "<strong>Tenant:</strong> ${tenant.first.first} ${tenant.first.last} "
                "(${tenant.first.email})<br>"
                "<strong>Reported:</strong> ${req.issue}</p>"
                "<p><strong>Recommended:</strong> ${vendors.first.company} — "
                "${vendors.first.trade}, rated ${vendors.first.rating}, "
                "${vendors.first.contact} ${vendors.first.phone}</p>"
                "<p>Approving assigns them to the work order and emails them the job. "
                "To use someone else, choose “Assign a different contractor” and name them. "
                "Declining leaves the work order open and unassigned.</p>"
            ),
            "actions": [
                {"id": "approve", "label": "Assign the recommended contractor", "kind": "approve"},
                {
                    "id": "choose",
                    "label": "Assign a different contractor",
                    "kind": "form",
                    "form_fields": [
                        {
                            "name": "vendor",
                            "type": "text",
                            "required": True,
                            "label": "Contractor (company name)",
                        }
                    ],
                },
                {"id": "decline", "label": "Not now", "kind": "decline"},
            ],
        },
        {
            "idx": 7,
            "kind": "update_record",
            "label": "Assign the recommended contractor",
            "narration": "Runs only when the recommendation was approved as-is.",
            "when": "${decision.approved}",
            "namespace": ns,
            "type_name": "work_orders",
            "record_id": "${wo._id}",
            "fields": {"vendor": "${vendors.first.company}", "status": "In Progress"},
        },
        {
            "idx": 8,
            "kind": "update_record",
            "label": "Assign the contractor you named",
            "narration": "Runs only when a different contractor was named on the approval.",
            "when": "${decision.payload.vendor}",
            "namespace": ns,
            "type_name": "work_orders",
            "record_id": "${wo._id}",
            "fields": {"vendor": "${decision.payload.vendor}", "status": "In Progress"},
        },
        {
            "idx": 9,
            "kind": "send_email",
            "label": "Brief the contractor",
            "narration": "Sends the job to the approved contractor. Skipped on any other answer.",
            "when": "${decision.approved}",
            "to": "${vendors.first.email}",
            "subject": "${req.priority} job — ${prop.first.street}, ${prop.first.city}",
            "body": (
                "<p>Please attend the following job.</p>"
                "<p><strong>Issue:</strong> ${req.issue}<br>"
                "<strong>Priority:</strong> ${req.priority}<br>"
                "<strong>Address:</strong> ${prop.first.street}, ${prop.first.city}<br>"
                "<strong>Tenant:</strong> ${tenant.first.first} ${tenant.first.last}, "
                "${tenant.first.phone}</p>"
                "<p>Please reply to confirm when you can attend, and invoice against this "
                "address once complete.</p>"
            ),
        },
        {
            "idx": 10,
            "kind": "finish",
            "label": "Done",
            "narration": "",
            "summary": "Maintenance request handled: ${req.issue}",
        },
    ]


def _find_intake(client: InventDBClient) -> dict[str, Any] | None:
    """The installed intake workflow, if there is one.

    Prefers a live one over a draft. Re-asking for the setup while an earlier
    attempt is still sitting unactivated should show that attempt, not stack a
    second identical draft behind it.
    """
    payload = _data(client.list_workflows())
    rows = payload.get("workflows", payload) if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return None
    matches = [
        w
        for w in rows
        if isinstance(w, dict) and str(w.get("name") or "").strip() == INTAKE_NAME
    ]
    if not matches:
        return None
    matches.sort(key=lambda w: (bool(w.get("pending_approval")), not bool(w.get("active"))))
    return matches[0]


def _distinct_trades(client: InventDBClient) -> list[str]:
    seen: list[str] = []
    for row in _vendor_rows(client):
        trade = str(row.get("trade") or "").strip()
        if trade and trade not in seen:
            seen.append(trade)
    return sorted(seen)


@bp.get("/intake")
def intake_status():
    """Whether the intake automation is installed, and what it would do today.

    `vendor_coverage` is the honest part: an intake that reads the mailbox
    perfectly and finds nobody to send is not working. Reporting which
    categories have no vendor on file says so before the first real request
    rather than at the moment one parks with an empty shortlist.
    """
    client = authed_client()
    workflow = _find_intake(client)
    trades = _distinct_trades(client)
    lowered = {t.lower() for t in trades}
    coverage = [
        {
            "category": category,
            "trades": list(wanted),
            "covered": any(t.lower() in lowered for t in wanted),
        }
        for category, wanted in CATEGORY_TRADES.items()
    ]
    return jsonify(
        {
            "installed": workflow is not None,
            "workflow": workflow,
            "name": INTAKE_NAME,
            "trades_on_file": trades,
            "coverage": coverage,
            "uncovered": [c["category"] for c in coverage if not c["covered"]],
        }
    )


@bp.post("/intake")
def install_intake():
    """Author the intake automation, as a sandboxed draft.

    Sandboxed and unactivated is the only defensible default. This workflow
    reads a live mailbox and emails real tenants and real contractors; installing
    it ready-to-fire from a button press would be a side effect nobody asked
    for. It rehearses until someone activates it in Workflows, which is the same
    ladder every other workflow climbs.

    Installing twice is not an error and does not mint a second copy — it
    returns the one already there. A duplicate intake would double every
    acknowledgement the tenant receives.
    """
    client = authed_client()
    existing = _find_intake(client)
    if existing:
        return jsonify({"created": False, "workflow": existing}), 200

    trades = _distinct_trades(client)
    if not trades:
        raise ApiError(
            400,
            "There are no vendors on file with a trade, so the intake would have "
            "nobody to recommend. Add vendors first.",
        )

    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    label = body.get("gmail_label")
    if label is not None and not isinstance(label, str):
        raise ApiError(400, "gmail_label must be a string")

    payload: dict[str, Any] = {
        "name": INTAKE_NAME,
        "trigger_kind": "inbound_email",
        # An empty spec means "every inbound message" — the router's own intent
        # matching then decides whether a given email is a maintenance request.
        # A label narrows it to mail already filed as maintenance, which is the
        # safer setup when the mailbox is busy.
        "trigger_spec": {"gmail_label": label.strip()} if label and label.strip() else {},
        "trigger_intent": (
            "When a maintenance or repair request arrives by email — sent by a tenant, "
            "or by someone writing on a tenant's behalf."
        ),
        "plan": _intake_plan(client.namespace, trades),
        "sandbox": True,
    }
    created = _data(client.create_workflow(payload))
    return jsonify({"created": True, "workflow": created}), 201
