"""Client for the InventDB SOAR HTTP API (synchronous, requests-based).

Every method maps onto an endpoint documented at https://www.inventdb.com/api.html
The client is stateless with respect to auth: the caller supplies the bearer token
(obtained from InventDB's own login endpoint) so InventDB remains the single source
of identity and its row-level security is always enforced.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import requests

from .config import get_settings
from .errors import ApiError

_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# Record ids are server-minted UUIDs, so they carry hyphens that _IDENT_RE
# rejects. Still constrained enough that nothing can escape a URL path segment.
_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")


# Both use `fullmatch` rather than `match` with an anchored pattern: `$` in
# Python also matches just before a trailing newline, which would let
# "properties\n" through an allow-list that never meant to accept it.
def _safe_ident(value: str, label: str = "identifier") -> str:
    if not isinstance(value, str) or not _IDENT_RE.fullmatch(value):
        raise ApiError(400, f"Invalid {label}: {value!r}")
    return value


def _safe_id(value: str, label: str = "id") -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise ApiError(400, f"Invalid {label}: {value!r}")
    return value


def _safe_version(value: Any, label: str = "version") -> int:
    """Workflow version numbers are 1-based integers used as a path segment.

    `bool` is excluded explicitly: it is a subclass of `int`, so `True` would
    otherwise sail through and address version 1.
    """
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ApiError(400, f"Invalid {label}: {value!r}")
    return value


class InventDBClient:
    """Client bound to a single InventDB instance and (optionally) a token."""

    def __init__(self, token: Optional[str] = None) -> None:
        settings = get_settings()
        self.base_url = settings.base_url
        self.namespace = settings.inventdb_namespace
        self.app = settings.inventdb_app
        self.timeout = settings.inventdb_timeout
        self.stream_idle_timeout = settings.inventdb_stream_timeout
        self.token = token

    # ------------------------------------------------------------------ core
    def _headers(self, auth: bool = True) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if auth:
            if not self.token:
                raise ApiError(401, "Not authenticated")
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        auth: bool = True,
        json: Any = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        try:
            resp = requests.request(
                method,
                url,
                headers=self._headers(auth=auth),
                json=json,
                params=params,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ApiError(
                502, f"Could not reach InventDB at {self.base_url}: {exc}"
            ) from exc
        return self._parse(resp)

    @staticmethod
    def _parse(resp: "requests.Response") -> Any:
        if resp.status_code >= 400:
            detail: Any
            extra: dict[str, Any] = {}
            try:
                body = resp.json()
                detail = body.get("error") or body.get("detail") or body
                # A rejected workflow plan comes back as
                # `{error, issues: [{step_idx, severity, message}, …]}`. The
                # message alone ("plan validation failed") cannot say which
                # step is wrong, so carry the list through to the editor.
                issues = body.get("issues")
                if isinstance(issues, list) and issues:
                    extra["issues"] = issues
            except (ValueError, AttributeError):
                detail = resp.text or f"InventDB returned {resp.status_code}"
            raise ApiError(resp.status_code, detail, extra)
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return resp.text

    # ------------------------------------------------------------------ auth
    def login(self, username: str, password: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/auth/login",
            auth=False,
            json={"username": username, "password": password},
        )

    def me(self) -> dict[str, Any]:
        return self._request("GET", "/api/auth/me", params={"app": self.app})

    def change_password(self, current_password: str, new_password: str) -> Any:
        return self._request(
            "POST",
            "/api/auth/change-password",
            json={"current_password": current_password, "new_password": new_password},
        )

    def forgot_password(self, email: str) -> Any:
        return self._request(
            "POST", "/api/auth/forgot-password", auth=False, json={"email": email}
        )

    def health(self) -> Any:
        return self._request("GET", "/api/auth/health", auth=False)

    # ------------------------------------------------------------- discovery
    def list_types(self) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        return self._request(
            "GET", f"/api/namespaces/{ns}/types", params={"metadata": "true"}
        )

    def relationships(self) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        return self._request("GET", f"/api/relationships/{ns}")

    # --------------------------------------------------------------- records
    def _type_path(self, type_name: str) -> str:
        ns = _safe_ident(self.namespace, "namespace")
        t = _safe_ident(type_name, "type")
        return f"/db/{ns}/{t}"

    def get_record(self, type_name: str, record_id: str) -> Any:
        return self._request("GET", f"{self._type_path(type_name)}/{record_id}")

    def create_record(self, type_name: str, data: dict[str, Any]) -> Any:
        return self._request("POST", self._type_path(type_name), json=data)

    def update_record(self, type_name: str, data: dict[str, Any]) -> Any:
        return self._request("PUT", self._type_path(type_name), json=data)

    def delete_record(self, type_name: str, record_id: str) -> Any:
        return self._request("DELETE", f"{self._type_path(type_name)}/{record_id}")

    def bulk_insert(self, type_name: str, rows: list[dict[str, Any]]) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        t = _safe_ident(type_name, "type")
        return self._request(
            "POST",
            f"/api/{ns}/{t}/bulk",
            params={"disableIndexing": "false"},
            json=rows,
        )

    def delete_by_filter(self, type_name: str, filt: dict[str, Any]) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        t = _safe_ident(type_name, "type")
        return self._request("POST", f"/api/{ns}/{t}/delete", json={"filter": filt})

    def truncate(self, type_name: str) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        t = _safe_ident(type_name, "type")
        return self._request(
            "POST", f"/api/{ns}/{t}/deleteAll", json={"confirm": "CONFIRM"}
        )

    # ------------------------------------------------------------------- sql
    def sql(self, statement: str) -> dict[str, Any]:
        result = self._request(
            "POST", "/sql", params={"metrics": "1"}, json={"sql": statement}
        )
        if isinstance(result, dict) and "rows" in result:
            return result
        if isinstance(result, list):
            return {"rows": result, "metrics": {"count": len(result)}}
        return {"rows": [], "metrics": {}}

    def query_rows(self, statement: str) -> list[dict[str, Any]]:
        try:
            data = self.sql(statement)
        except ApiError:
            # A missing type/namespace surfaces as an SQL error on a fresh DB.
            return []
        return data.get("rows", []) or []

    def filter_records(self, type_name: str, body: dict[str, Any]) -> Any:
        ns = _safe_ident(self.namespace, "namespace")
        t = _safe_ident(type_name, "type")
        return self._request("POST", f"/query/{ns}/{t}/filter", json=body)

    # --------------------------------------------------------------- reports
    @staticmethod
    def _unwrap(payload: Any) -> Any:
        """Peel InventDB's ``{"ok": true, "data": ...}`` success envelope.

        The report-template endpoints wrap their success bodies in it, while
        some siblings (``render-ad-hoc``) return the payload bare — which is
        why InventDB's own SOAR client reads ``r?.data?.html ?? r?.html``.
        Unwrapping here means callers only ever see the inner payload.

        Errors never reach this: a non-2xx carries ``{"ok": false, "error"}``
        and `_parse` has already raised.
        """
        if (
            isinstance(payload, dict)
            and payload.get("ok") is True
            and isinstance(payload.get("data"), (dict, list))
        ):
            return payload["data"]
        return payload

    # InventDB's saved reports are "report templates" — SQL-driven HTML stored
    # in `_System.ReportTemplates` and rendered on demand by the server's report
    # engine. They live at the instance level, not inside a namespace, so this
    # is the same set the SOAR app's Report room lists. Template CRUD and
    # rendering are deterministic (no LLM), so they work on every tier.
    def list_report_templates(self) -> Any:
        return self._unwrap(self._request("GET", "/api/report-templates"))

    def get_report_template(self, template_id: str) -> Any:
        tid = _safe_id(template_id, "template id")
        return self._unwrap(self._request("GET", f"/api/report-templates/{tid}"))

    def render_report_template(
        self, template_id: str, params: Optional[dict[str, Any]] = None
    ) -> Any:
        """Render a saved report against live data.

        `email_safe_charts=False` asks the engine for real SVG charts rather
        than the Gmail-safe HTML-table fallback its POST endpoint defaults to —
        we are drawing this in a browser, not an inbox.
        """
        tid = _safe_id(template_id, "template id")
        return self._unwrap(
            self._request(
                "POST",
                f"/api/report-templates/{tid}/render",
                json={"params": params or {}, "email_safe_charts": False},
            )
        )

    # ---------------------------------------------------- report authoring
    # A saved report is editable in place: rename it, or describe a change and
    # let InventDB's report agent rewrite the layout. Every edit is a new
    # version of the same template — the engine appends rather than overwrites,
    # which is why nothing here needs to snapshot the previous HTML itself.

    def update_report_template(self, template_id: str, patch: dict[str, Any]) -> Any:
        tid = _safe_id(template_id, "template id")
        return self._unwrap(
            self._request("PUT", f"/api/report-templates/{tid}", json=patch)
        )

    def delete_report_template(self, template_id: str) -> Any:
        """Remove a saved report.

        Templates live at the instance level, so this is the same set SOAR's
        Report room lists — deleting one removes it there too.
        """
        tid = _safe_id(template_id, "template id")
        return self._unwrap(self._request("DELETE", f"/api/report-templates/{tid}"))

    def promote_report_snapshot(
        self, record_id: str, attachment_id: str, name: str
    ) -> Any:
        """Turn a frozen AI snapshot into a live, re-querying template.

        The snapshot's sibling `.source.html` still carries the
        ``<script type="server">`` blocks, so the engine can rebuild a template
        that re-runs its queries instead of showing the numbers from the day it
        was generated.
        """
        return self._unwrap(
            self._request(
                "POST",
                "/api/report-templates/promote-from-report",
                json={
                    "recordId": _safe_id(record_id, "record id"),
                    "attachmentId": _safe_id(attachment_id, "attachment id"),
                    "name": name,
                },
            )
        )

    def stream_report_layout_edit(
        self, template_id: str, body: dict[str, Any]
    ) -> "requests.Response":
        """Open the report agent's SSE stream for an edit-by-instruction.

        Like the Analyze turn, this is handed back un-consumed for the caller to
        relay; the read timeout bounds the gap between chunks, not the edit.
        The endpoint saves the new version itself — the `saved` event is the
        confirmation, not a request for the client to write anything.
        """
        tid = _safe_id(template_id, "template id")
        if not self.token:
            raise ApiError(401, "Not authenticated")
        try:
            return requests.request(
                "POST",
                f"{self.base_url}/api/report-templates/{tid}/layout/stream",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    "Authorization": f"Bearer {self.token}",
                },
                json=body,
                stream=True,
                timeout=(10, self.stream_idle_timeout),
            )
        except requests.RequestException as exc:
            raise ApiError(
                502, f"Could not reach InventDB at {self.base_url}: {exc}"
            ) from exc

    # ------------------------------------------------------------ attachments
    def attachment_text(
        self, namespace: str, type_name: str, record_id: str, attachment_id: str
    ) -> str:
        """The raw bytes of an attachment, as text (a stored report is HTML)."""
        ns = _safe_ident(namespace, "namespace")
        t = _safe_ident(type_name, "type")
        rid = _safe_id(record_id, "record id")
        aid = _safe_id(attachment_id, "attachment id")
        if not self.token:
            raise ApiError(401, "Not authenticated")
        try:
            resp = requests.request(
                "GET",
                f"{self.base_url}/attach/{ns}/{t}/{rid}/{aid}/download",
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ApiError(502, f"Could not reach InventDB: {exc}") from exc
        if resp.status_code >= 400:
            raise ApiError(resp.status_code, resp.text or "Could not load the report")
        return resp.text

    def delete_attachment(
        self, namespace: str, type_name: str, record_id: str, attachment_id: str
    ) -> Any:
        ns = _safe_ident(namespace, "namespace")
        t = _safe_ident(type_name, "type")
        rid = _safe_id(record_id, "record id")
        aid = _safe_id(attachment_id, "attachment id")
        return self._request("DELETE", f"/attach/{ns}/{t}/{rid}/{aid}")

    # --------------------------------------------------------------- analyze
    # The Analyze room talks to InventDB's AI surface: the streaming agent
    # (`/ai/chat/stream`), the model catalog, per-user thread storage, the web
    # -search gate and the transactional change-set applier. None of it is
    # PMS-specific — InventDB owns the agent, its tools and its RBAC; this app
    # only forwards the caller's bearer token so every answer is scoped to what
    # that user is allowed to see.
    def ai_config(self) -> Any:
        return self._request("GET", "/ai/config")

    def ai_models(self) -> Any:
        return self._request("GET", "/ai/models")

    def list_threads(self) -> Any:
        return self._request("GET", "/ai/threads")

    def save_thread(self, thread: dict[str, Any]) -> Any:
        return self._request("PUT", "/ai/threads", json=thread)

    def delete_thread(self, thread_id: str) -> Any:
        tid = _safe_id(thread_id, "thread id")
        return self._request("DELETE", f"/ai/threads/{tid}")

    def websearch_status(self) -> Any:
        return self._request("GET", "/api/websearch/status")

    def websearch_set(self, enabled: bool) -> Any:
        action = "enable" if enabled else "disable"
        return self._request("POST", f"/api/websearch/{action}", json={})

    def apply_change_set(self, title: str, steps: list[dict[str, Any]]) -> Any:
        return self._request(
            "POST", "/ai/change-set/apply", json={"title": title, "steps": steps}
        )

    def unstage_upload(self, pending_id: str) -> Any:
        pid = _safe_id(pending_id, "pending id")
        return self._request("DELETE", f"/ai/uploads/{pid}")

    def get_saved_view(self, view_id: str) -> Any:
        vid = _safe_id(view_id, "view id")
        return self._unwrap(self._request("GET", f"/api/saved-views/{vid}"))

    def send_email(self, message: dict[str, Any]) -> Any:
        return self._request("POST", "/api/gmail/send", json=message)

    def bulk_send_email(self, emails: list[dict[str, Any]]) -> Any:
        return self._request("POST", "/api/gmail/bulk-send", json={"emails": emails})

    def create_event(self, event: dict[str, Any]) -> Any:
        return self._request("POST", "/api/calendar/events", json=event)

    def bulk_create_events(self, events: list[dict[str, Any]]) -> Any:
        return self._request(
            "POST", "/api/calendar/bulk-events", json={"events": events}
        )

    def stage_upload(
        self, filename: str, content: bytes, content_type: str
    ) -> Any:
        """Stage one file as an ephemeral LLM input (30-min TTL, no DB write).

        Sent as multipart rather than JSON, so it bypasses ``_request`` (whose
        headers declare a JSON body). ``requests`` writes the boundary itself —
        setting Content-Type by hand here would produce a malformed part.
        """
        if not self.token:
            raise ApiError(401, "Not authenticated")
        try:
            resp = requests.request(
                "POST",
                f"{self.base_url}/ai/uploads/stage",
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {self.token}",
                },
                files={"file": (filename, content, content_type)},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ApiError(502, f"Could not reach InventDB: {exc}") from exc
        return self._parse(resp)

    def stream_chat(self, body: dict[str, Any]) -> "requests.Response":
        """Open the agent's SSE stream and hand back the un-consumed response.

        The caller is responsible for iterating and closing it. The read timeout
        is deliberately far above ``inventdb_timeout``: it bounds the gap
        *between* chunks, and a long reasoning turn or a multi-step report build
        legitimately goes minutes without emitting one. The connect timeout stays
        short so an unreachable instance still fails fast.
        """
        if not self.token:
            raise ApiError(401, "Not authenticated")
        try:
            return requests.request(
                "POST",
                f"{self.base_url}/ai/chat/stream",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    "Authorization": f"Bearer {self.token}",
                },
                json=body,
                stream=True,
                timeout=(10, self.stream_idle_timeout),
            )
        except requests.RequestException as exc:
            raise ApiError(
                502, f"Could not reach InventDB at {self.base_url}: {exc}"
            ) from exc

    # ------------------------------------------------------------- workflows
    # Workflow definitions are instance-level, exactly like report templates:
    # the ones the SOAR app's Operate room lists are the ones edited here, and
    # an edit or delete made in the PMS lands there too.
    def list_workflows(self) -> Any:
        return self._request(
            "GET", "/api/workflows", params={"include_deleted": "false"}
        )

    def get_workflow(self, workflow_id: str) -> Any:
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("GET", f"/api/workflows/{wid}")

    def create_workflow(self, payload: dict[str, Any]) -> Any:
        """Create a workflow. InventDB validates the plan and rejects with 400
        + ``issues`` when a step is malformed, so nothing half-built is saved.

        The new workflow arrives ``pending_approval=true``/``active=false`` —
        it does not fire until it is explicitly activated.
        """
        return self._request("POST", "/api/workflows", json=payload)

    def update_workflow(self, workflow_id: str, payload: dict[str, Any]) -> Any:
        """Partial update — only the supplied keys change. Sending ``plan``
        re-validates it and mints a new version."""
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("PUT", f"/api/workflows/{wid}", json=payload)

    def delete_workflow(self, workflow_id: str) -> Any:
        """Soft-delete. Run history survives; the workflow stops firing.

        Instance-level, so this removes it from the SOAR app as well. Only
        reached from an explicit, confirmed click.
        """
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("DELETE", f"/api/workflows/{wid}")

    def activate_workflow(self, workflow_id: str, sandbox: Optional[bool] = None) -> Any:
        """Clear ``pending_approval`` and set ``active`` — it now fires on its
        trigger. ``sandbox`` is a separate axis: passing it persists the choice
        in the same call, so an activated workflow can still mock its
        side effects."""
        wid = _safe_id(workflow_id, "workflow id")
        body: dict[str, Any] = {} if sandbox is None else {"sandbox": sandbox}
        return self._request("POST", f"/api/workflows/{wid}/activate", json=body)

    def pause_workflow(self, workflow_id: str) -> Any:
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("POST", f"/api/workflows/{wid}/pause", json={})

    def resume_workflow(self, workflow_id: str) -> Any:
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("POST", f"/api/workflows/{wid}/resume", json={})

    def run_workflow(self, workflow_id: str, body: Optional[dict[str, Any]] = None) -> Any:
        """Fire once, now. ``sandbox_override`` forces this single run to mock
        its side effects, which is how a workflow is rehearsed before going
        live."""
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("POST", f"/api/workflows/{wid}/run", json=body or {})

    def list_workflow_versions(self, workflow_id: str) -> Any:
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("GET", f"/api/workflows/{wid}/versions")

    def rollback_workflow(self, workflow_id: str, version: int) -> Any:
        """Restore an earlier definition. This mints a *new* latest version
        from the old one rather than rewinding history."""
        wid = _safe_id(workflow_id, "workflow id")
        v = _safe_version(version)
        return self._request("POST", f"/api/workflows/{wid}/versions/{v}/rollback", json={})

    def list_runs(self) -> Any:
        return self._request("GET", "/api/workflows/runs")

    def list_workflow_runs(self, workflow_id: str) -> Any:
        wid = _safe_id(workflow_id, "workflow id")
        return self._request("GET", f"/api/workflows/{wid}/runs")

    def get_run(self, run_id: str) -> Any:
        rid = _safe_id(run_id, "run id")
        return self._request("GET", f"/api/workflows/runs/{rid}")

    # ---------------------------------------------------------- the inbox
    #
    # A workflow run *parks* when it reaches a step that needs a person, and
    # posts a notification carrying the decision. These are per-user and
    # RLS-scoped upstream: the token decides whose inbox this is, so there is
    # no audience parameter to get wrong here.

    def list_notifications(self, only_unread: bool = False) -> Any:
        params = {"only_unread": "true"} if only_unread else None
        return self._request("GET", "/api/workflows/notifications", params=params)

    def get_notification(self, notification_id: str) -> Any:
        nid = _safe_id(notification_id, "notification id")
        return self._request("GET", f"/api/workflows/notifications/{nid}")

    def mark_notification_read(self, notification_id: str) -> Any:
        nid = _safe_id(notification_id, "notification id")
        return self._request("POST", f"/api/workflows/notifications/{nid}/read", json={})

    def resolve_notification(
        self, notification_id: str, action_id: str, payload: Optional[Any] = None
    ) -> Any:
        """Answer a parked decision. This *resumes the run* — it is not a
        read-state change — so the caller must have meant it."""
        nid = _safe_id(notification_id, "notification id")
        body: dict[str, Any] = {"action_id": action_id}
        if payload is not None:
            body["payload"] = payload
        return self._request(
            "POST", f"/api/workflows/notifications/{nid}/resolve", json=body
        )

    def delete_notification(self, notification_id: str) -> Any:
        nid = _safe_id(notification_id, "notification id")
        return self._request("DELETE", f"/api/workflows/notifications/{nid}")

    def get_workflow_event(self, event_id: str) -> Any:
        """The event that triggered a run — for an inbound-email workflow, the
        message itself, which is what makes a request reviewable."""
        eid = _safe_id(event_id, "event id")
        return self._request("GET", f"/api/workflows/events/{eid}")
