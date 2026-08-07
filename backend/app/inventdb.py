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

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_ident(value: str, label: str = "identifier") -> str:
    if not isinstance(value, str) or not _IDENT_RE.match(value):
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
            try:
                body = resp.json()
                detail = body.get("error") or body.get("detail") or body
            except ValueError:
                detail = resp.text or f"InventDB returned {resp.status_code}"
            raise ApiError(resp.status_code, detail)
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

    # ------------------------------------------------------------- workflows
    def list_workflows(self) -> Any:
        return self._request(
            "GET", "/api/workflows", params={"include_deleted": "false"}
        )

    def get_workflow(self, workflow_id: str) -> Any:
        return self._request("GET", f"/api/workflows/{workflow_id}")

    def list_runs(self) -> Any:
        return self._request("GET", "/api/workflows/runs")

    def list_workflow_runs(self, workflow_id: str) -> Any:
        return self._request("GET", f"/api/workflows/{workflow_id}/runs")

    def get_run(self, run_id: str) -> Any:
        return self._request("GET", f"/api/workflows/runs/{run_id}")
