"""The connection settings a running instance can change.

Exactly one thing is editable here: which InventDB instance this app talks to.
That is a bigger lever than it looks, because it is where every login goes — so
the route is written around what a bad change could do rather than around the
happy path:

  * **only a signed-in user may change it.** The token is verified against the
    *current* instance before anything is written, so an unauthenticated caller
    cannot silently repoint the app.
  * **the new address must answer first.** A typo that leaves the app pointing
    nowhere would lock everyone out with no way back through the UI, so the new
    host is probed before the change is saved.
  * **plain http is refused off localhost** (see `normalize_base_url`) — the
    next thing sent to that host is somebody's password.

Changing it invalidates the caller's session: the token was minted by the old
instance and means nothing to the new one. The response says so, and the client
signs out rather than leaving a dead token in place.
"""

from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..config import (
    configured_base_url,
    get_settings,
    normalize_base_url,
    reset_inventdb_base_url,
    set_inventdb_base_url,
)
from ..context import authed_client
from ..errors import ApiError
from ..inventdb import InventDBClient

bp = Blueprint("settings", __name__, url_prefix="/api/settings")


def _connection_payload() -> dict[str, object]:
    settings = get_settings()
    return {
        "base_url": settings.base_url,
        "namespace": settings.inventdb_namespace,
        "app": settings.inventdb_app,
        # Whether the running app differs from how it was deployed, so the UI
        # can offer "reset to the configured instance" only when that means
        # something.
        "configured_base_url": configured_base_url(),
        "overridden": settings.base_url != configured_base_url(),
    }


def _require_signed_in() -> None:
    """Reject anyone who isn't authenticated against the current instance.

    `authed_client()` only proves a bearer header was sent; asking InventDB who
    it belongs to is what proves the caller is really signed in.
    """
    authed_client().me()


def _probe(base_url: str) -> None:
    """Check the address answers as an InventDB instance before we commit to it."""
    try:
        InventDBClient(base_url=base_url).health()
    except ApiError as exc:
        raise ApiError(
            400,
            f"Couldn't reach an InventDB instance at {base_url} — "
            f"check the address and that it is running. ({exc.detail})",
        ) from exc


@bp.get("/connection")
def get_connection():
    _require_signed_in()
    return jsonify(_connection_payload())


@bp.put("/connection")
def update_connection():
    _require_signed_in()

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError(400, "Expected a JSON object body")

    url = normalize_base_url(str(body.get("base_url") or ""))
    current = get_settings().base_url
    if url == current:
        return jsonify({**_connection_payload(), "changed": False})

    _probe(url)
    set_inventdb_base_url(url)
    return jsonify(
        {
            **_connection_payload(),
            "changed": True,
            # The caller's token belongs to the instance we just left.
            "sign_out_required": True,
        }
    )


@bp.delete("/connection")
def reset_connection():
    """Go back to the instance this app was deployed against."""
    _require_signed_in()

    if get_settings().base_url == configured_base_url():
        return jsonify({**_connection_payload(), "changed": False})

    reset_inventdb_base_url()
    return jsonify({**_connection_payload(), "changed": True, "sign_out_required": True})
