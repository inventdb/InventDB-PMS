"""Files — the drive over InventDB's attachments.

InventDB stores every file as an **attachment on a record**: the scanned lease
belongs to `pms.leases/lea-1`, the inspection photo to `pms.inspections/ins-2`.
That is the storage model, and this router does not change it. What InventDB
adds on top is a cross-cutting search with a *folder aggregation*, and that is
what lets a set of records present itself as a drive of folders — which is
exactly how SOAR's Files room is built, and how this one is.

So: a file always has a home (`type` + `record`), every row can say where it
lives, and nothing here is a second place to keep things.

**The namespace is pinned.** SOAR's Files room browses every namespace the user
can see. This app's window is its own namespace, pinned server-side exactly as
it is for Analyze and for every entity route — a request body cannot widen it.
That is the one deliberate difference from SOAR, and it is a security property
rather than an omission: a PMS user asking for files should never be able to
steer at another tenant's.

Binary responses (download, thumbnail) are **streamed** rather than read into
memory: a 40 MB scan should not be buffered in Python on its way through.
"""

from __future__ import annotations

from typing import Any, Iterator

from flask import Blueprint, Response, jsonify, request, stream_with_context

from ..context import authed_client
from ..errors import ApiError

bp = Blueprint("files", __name__, url_prefix="/api/files")

# What a search may ask for. `namespaces` is absent on purpose — see the module
# docstring. `types`/`folder` are how the drive tree scopes the grid.
_SEARCH_FIELDS = (
    "query",
    "search_type",
    "types",
    "folder",
    "mime_types",
    "tags",
    "limit",
    "offset",
    "threshold",
)

_SEARCH_TYPES = {"keyword", "fulltext", "semantic", "combined"}

# InventDB caps a page at 100. Clamping here means a caller asking for more
# gets the largest page that exists rather than an error.
_MAX_LIMIT = 100

# A bulk delete runs in batches so the UI can show honest progress and cancel
# between them. Without a ceiling one call could delete an entire type while
# the user watched a bar that never moved.
_MAX_DELETE_BATCH = 100

# Uploads are read into memory to be forwarded, so the ceiling is real rather
# than advisory. Well above a scanned lease or a set of inspection photos.
_MAX_UPLOAD_BYTES = 64 * 1024 * 1024


def _data(payload: Any) -> Any:
    """Unwrap InventDB's ``{ok, data}`` envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object body")
    return data


def _int(value: Any, label: str, *, minimum: int, maximum: int, default: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise ApiError(400, f"{label} must be an integer")
    return max(minimum, min(value, maximum))


def _str_list(value: Any, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        raise ApiError(400, f"{label} must be an array of strings")
    return [v for v in value if v.strip()]


def _upload() -> tuple[str, bytes, str]:
    """The one file part of a multipart upload."""
    part = request.files.get("file")
    if part is None or not part.filename:
        raise ApiError(400, "A file part named 'file' is required")
    content = part.read()
    if not content:
        raise ApiError(400, "The uploaded file is empty")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise ApiError(413, "That file is larger than the 64 MB limit")
    return part.filename, content, part.mimetype or "application/octet-stream"


def _stream(client_response, *, filename: str = "", inline: bool = False) -> Response:
    """Relay a binary upstream response to the browser without buffering it."""

    def chunks() -> Iterator[bytes]:
        try:
            for chunk in client_response.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk
        finally:
            client_response.close()

    headers: dict[str, str] = {}
    upstream = client_response.headers or {}
    length = upstream.get("Content-Length")
    if length:
        headers["Content-Length"] = length
    if filename:
        # `filename*` is what carries a non-ASCII name intact; the plain
        # `filename` is the fallback for clients that do not read it.
        safe = filename.replace('"', "")
        disposition = "inline" if inline else "attachment"
        headers["Content-Disposition"] = f'{disposition}; filename="{safe}"'
    return Response(
        stream_with_context(chunks()),
        mimetype=upstream.get("Content-Type") or "application/octet-stream",
        headers=headers,
    )


# ===========================================================================
# The drive
# ===========================================================================


@bp.post("/search")
def search_files():
    """Search and browse the drive.

    One endpoint serves both the grid and the tree, because they are the same
    query asked at different scopes: the tree asks unscoped and reads
    ``folders``; the grid asks scoped to a type or folder and reads ``results``.

    ``query`` of ``*`` (or empty) browses rather than searches — that is
    InventDB's convention, and it is what the tree's aggregation pass uses.
    """
    body = _body()
    client = authed_client()

    payload: dict[str, Any] = {k: body[k] for k in _SEARCH_FIELDS if k in body}
    query = payload.get("query")
    payload["query"] = query.strip() if isinstance(query, str) and query.strip() else "*"

    search_type = payload.get("search_type", "keyword")
    if search_type not in _SEARCH_TYPES:
        raise ApiError(400, f"search_type must be one of: {', '.join(sorted(_SEARCH_TYPES))}")
    payload["search_type"] = search_type

    payload["types"] = _str_list(body.get("types"), "types")
    payload["mime_types"] = _str_list(body.get("mime_types"), "mime_types")
    payload["tags"] = _str_list(body.get("tags"), "tags")
    if not payload["types"]:
        payload.pop("types")
    payload["limit"] = _int(body.get("limit"), "limit", minimum=1, maximum=_MAX_LIMIT, default=25)
    payload["offset"] = _int(body.get("offset"), "offset", minimum=0, maximum=1_000_000, default=0)

    folder = body.get("folder")
    if folder is not None:
        if not isinstance(folder, str):
            raise ApiError(400, "folder must be a string")
        payload["folder"] = folder

    # Pinned last so nothing above can have set it.
    payload["namespaces"] = [client.namespace]

    data = _data(client.search_files(payload)) or {}
    if not isinstance(data, dict):
        data = {}
    return jsonify(
        {
            "results": data.get("results") or [],
            "total_matches": data.get("total_matches") or 0,
            "folders": data.get("folders") or [],
        }
    )


@bp.post("/bulk-delete")
def bulk_delete_files():
    """Delete a folder subtree, or every file of one type.

    Deliberately one batch per call. The UI loops, showing a real count and
    stopping when a pass deletes nothing — which is also the terminator that
    cannot spin forever, since a pass that deletes zero always ends it.
    """
    body = _body()
    client = authed_client()

    type_name = body.get("type")
    if not isinstance(type_name, str) or not type_name.strip():
        raise ApiError(400, "type is required")

    payload: dict[str, Any] = {
        "namespace": client.namespace,
        "type": type_name.strip(),
        "limit": _int(body.get("limit"), "limit", minimum=1, maximum=_MAX_DELETE_BATCH, default=15),
    }
    folder = body.get("folder")
    if folder is not None:
        if not isinstance(folder, str):
            raise ApiError(400, "folder must be a string")
        if folder.strip():
            payload["folder"] = folder.strip()

    data = _data(client.bulk_delete_files(payload)) or {}
    if not isinstance(data, dict):
        data = {}
    return jsonify(
        {
            "deleted": data.get("deleted") or 0,
            "skipped": data.get("skipped") or 0,
            "remaining": data.get("remaining"),
        }
    )


@bp.post("/attach")
def attach_file():
    """Give a file a home — or a second one.

    An upload that came in through the drive (or from SOAR's Files room) lands
    unattached, in the type's vault, which is fine for storage and useless for
    the question a property manager actually asks: *which lease is this?* This
    is what answers it. Afterwards the file appears on that record like any
    other attachment, and the drive shows the record as its home.

    ``move`` is the default because that is the ordinary case — the file had no
    real parent, and now it has one. ``copy`` is for the file that genuinely
    belongs to two records, an invoice covering two work orders.
    """
    body = _body()
    attachment_id = body.get("attachment_id")
    type_name = body.get("type")
    record_id = body.get("record_id")
    for value, label in ((attachment_id, "attachment_id"), (type_name, "type"), (record_id, "record_id")):
        if not isinstance(value, str) or not value.strip():
            raise ApiError(400, f"{label} is required")

    mode = body.get("mode", "move")
    if mode not in {"move", "copy"}:
        raise ApiError(400, "mode must be 'move' or 'copy'")

    payload = _data(
        authed_client().relink_attachment(
            attachment_id.strip(), type_name.strip(), record_id.strip(), mode
        )
    )
    if not isinstance(payload, dict):
        payload = {}
    return jsonify(
        {"mode": payload.get("mode") or mode, "parents": payload.get("parents") or []}
    )


# ===========================================================================
# One record's files
# ===========================================================================


@bp.get("/<type_name>/<record_id>")
def list_attachments(type_name: str, record_id: str):
    payload = _data(authed_client().list_attachments(type_name, record_id))
    files = payload.get("attachments", payload) if isinstance(payload, dict) else payload
    return jsonify({"files": files if isinstance(files, list) else []})


@bp.post("/<type_name>/<record_id>")
def upload_attachment(type_name: str, record_id: str):
    """Attach a file to a record, optionally into a folder.

    The folder is just a path stored on the attachment — creating one is the
    act of uploading into it, which is why there is no "new folder" endpoint.
    """
    filename, content, content_type = _upload()
    folder = request.form.get("folder") or None
    payload = authed_client().upload_attachment(
        type_name, record_id, filename, content, content_type, folder
    )
    return jsonify(_data(payload)), 201


@bp.get("/<type_name>/<record_id>/<attachment_id>")
def get_attachment(type_name: str, record_id: str, attachment_id: str):
    return jsonify(_data(authed_client().get_attachment(type_name, record_id, attachment_id)))


@bp.delete("/<type_name>/<record_id>/<attachment_id>")
def delete_attachment(type_name: str, record_id: str, attachment_id: str):
    client = authed_client()
    return jsonify(
        _data(client.delete_attachment(client.namespace, type_name, record_id, attachment_id))
    )


@bp.get("/<type_name>/<record_id>/<attachment_id>/text")
def attachment_text(type_name: str, record_id: str, attachment_id: str):
    """The text InventDB extracted from the file — what makes it searchable."""
    payload = _data(
        authed_client().attachment_extracted_text(type_name, record_id, attachment_id)
    )
    if isinstance(payload, str):
        payload = {"text": payload}
    return jsonify(payload if isinstance(payload, dict) else {})


@bp.get("/<type_name>/<record_id>/<attachment_id>/download")
def download_attachment(type_name: str, record_id: str, attachment_id: str):
    """The file itself.

    A plain `<a href>` cannot carry the bearer token, so the browser fetches
    this and saves the blob; the filename rides in Content-Disposition.
    """
    upstream = authed_client().download_attachment(type_name, record_id, attachment_id)
    return _stream(upstream, filename=request.args.get("filename", ""))


@bp.get("/<type_name>/<record_id>/<attachment_id>/preview")
def preview_attachment(type_name: str, record_id: str, attachment_id: str):
    """The same bytes, marked for display rather than download."""
    upstream = authed_client().download_attachment(type_name, record_id, attachment_id)
    return _stream(upstream, inline=True)


@bp.get("/<type_name>/<record_id>/<attachment_id>/thumbnail")
def attachment_thumbnail(type_name: str, record_id: str, attachment_id: str):
    size = _int(
        request.args.get("size", type=int), "size", minimum=16, maximum=1024, default=96
    )
    upstream = authed_client().download_attachment(
        type_name, record_id, attachment_id, thumbnail_size=size
    )
    return _stream(upstream, inline=True)


# ===========================================================================
# Versions
#
# A file keeps its history: uploading again adds a version rather than
# replacing, and restoring an old one makes it current without discarding what
# came after. That matters for the documents this app holds — a re-signed lease
# should not erase the one it replaced.
# ===========================================================================


@bp.get("/<type_name>/<record_id>/<attachment_id>/versions")
def list_versions(type_name: str, record_id: str, attachment_id: str):
    payload = _data(
        authed_client().list_attachment_versions(type_name, record_id, attachment_id)
    )
    versions = payload.get("versions", payload) if isinstance(payload, dict) else payload
    return jsonify({"versions": versions if isinstance(versions, list) else []})


@bp.post("/<type_name>/<record_id>/<attachment_id>/versions")
def upload_version(type_name: str, record_id: str, attachment_id: str):
    filename, content, content_type = _upload()
    payload = authed_client().upload_attachment_version(
        type_name, record_id, attachment_id, filename, content, content_type
    )
    return jsonify(_data(payload)), 201


@bp.post("/<type_name>/<record_id>/<attachment_id>/versions/<int:version>/restore")
def restore_version(type_name: str, record_id: str, attachment_id: str, version: int):
    return jsonify(
        _data(
            authed_client().restore_attachment_version(
                type_name, record_id, attachment_id, version
            )
        )
    )


@bp.get("/<type_name>/<record_id>/<attachment_id>/versions/<int:version>/download")
def download_version(type_name: str, record_id: str, attachment_id: str, version: int):
    upstream = authed_client().download_attachment(
        type_name, record_id, attachment_id, version=version
    )
    return _stream(upstream, filename=request.args.get("filename", ""))
