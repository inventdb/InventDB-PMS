"""The inbox — what the automations need a person for.

A workflow run does not stop because it failed. It stops because it reached a
step that is not the software's decision to make: assign *this* vendor to *this*
job, spend *this* money. The engine posts a notification, the run **parks**, and
it stays parked until someone answers. Answering resumes the very same run at
its next step — this is not a message that triggers separate work, it *is* the
work, held mid-flight.

That is the whole reason this router refuses to be a generic proxy:

* **Resolving is a write with consequences.** ``POST /<id>/resolve`` releases a
  run that will then send mail and change records. It is never issued to make a
  badge go away, so the action id is required and validated rather than
  defaulted.
* **Reading is not answering.** Marking read is a separate route precisely
  because opening an approval must not be able to grant it.
* **Whose inbox is decided upstream.** InventDB scopes notifications to the
  bearer token's user. There is no audience parameter here to get wrong, and
  adding one would be the bug.

Everything else — what parks a run, what the actions mean, how a resumed run
continues — belongs to the engine. This is the PMS's window onto it.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request

from ..context import authed_client
from ..errors import ApiError

bp = Blueprint("notifications", __name__, url_prefix="/api/notifications")


def _data(payload: Any) -> Any:
    """Unwrap InventDB's ``{ok, data}`` envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _collection(payload: Any, key: str) -> list[Any]:
    data = _data(payload)
    items = data.get(key, data) if isinstance(data, dict) else data
    return items if isinstance(items, list) else []


@bp.get("")
def list_notifications():
    """The inbox, newest first.

    Ordering is settled here rather than in the browser so every surface that
    reads this — the page, the bell, the badge — agrees on what "the latest one"
    means. Whether an item is *waiting* is a property of the item (it has
    actions and no answer yet), so it is left for the reader to derive instead
    of being baked into a second, drifting list.
    """
    only_unread = str(request.args.get("only_unread", "")).lower() in ("1", "true", "yes")
    notifications = _collection(
        authed_client().list_notifications(only_unread), "notifications"
    )
    notifications.sort(key=lambda n: str((n or {}).get("created_at") or ""), reverse=True)
    return jsonify({"notifications": notifications})


@bp.get("/<notification_id>")
def get_notification(notification_id: str):
    return jsonify(_data(authed_client().get_notification(notification_id)))


@bp.post("/<notification_id>/read")
def mark_read(notification_id: str):
    """Mark as seen. Deliberately cannot answer anything — see the module note."""
    return jsonify(_data(authed_client().mark_notification_read(notification_id)))


@bp.post("/<notification_id>/resolve")
def resolve(notification_id: str):
    """Answer a parked decision, resuming the run that is waiting on it.

    ``action_id`` must name one of the actions the notification actually
    carries; InventDB rejects anything else with a 400, and re-resolving an
    answered notification with a 409. Both ride back untouched — a decision that
    was already made by someone else is a real answer to give the user, not an
    error to smooth over.
    """
    body = request.get_json(silent=True)
    body = body if isinstance(body, dict) else {}
    action_id = body.get("action_id")
    if not isinstance(action_id, str) or not action_id.strip():
        raise ApiError(400, "action_id is required")
    # `payload` carries a form action's answers. Absent is meaningful — an
    # approve/decline button has nothing to submit — so it is forwarded only
    # when supplied rather than being sent as an empty object.
    payload = body.get("payload")
    if payload is not None and not isinstance(payload, dict):
        raise ApiError(400, "payload must be an object")

    result = authed_client().resolve_notification(
        notification_id, action_id.strip(), payload
    )
    return jsonify(_data(result) or {"ok": True})


@bp.delete("/<notification_id>")
def dismiss(notification_id: str):
    """Remove an item from the inbox.

    This clears the *notification*, not the run: a parked run stays parked and
    its history is untouched. Deleting one you have not answered therefore
    hides a decision that is still outstanding, which is why the UI only offers
    it on items that are resolved or informational.
    """
    return jsonify(_data(authed_client().delete_notification(notification_id)))
