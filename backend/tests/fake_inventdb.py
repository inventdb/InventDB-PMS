"""A stand-in for the InventDB SOAR HTTP API.

The app reaches InventDB through exactly one function — ``requests.request``,
called from :meth:`app.inventdb.InventDBClient._request`. Replacing that single
call swaps out the entire upstream while leaving every layer above it real: URL
construction, header building, the error-envelope parsing in ``_parse``, and —
the part these tests care about most — the SQL the routers compose.

The alternative, stubbing ``InventDBClient`` itself, would mean the tests assert
against a mock of the very code under test. Here a test can say "given this
request, the app sent InventDB exactly this SQL string", which is the property
worth protecting.

Rules are matched in **reverse registration order**, so a rule a test registers
later beats one installed by a fixture. That is deliberately the same override
semantics as the frontend's Playwright mock (`e2e/fixtures/mock-api.ts`), so the
two suites can be read the same way.
"""

from __future__ import annotations

import json as jsonlib
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Pattern, Union


class _Unset:
    """Sentinel distinguishing "no payload given" from "a JSON null payload"."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<unset>"


_UNSET = _Unset()


@dataclass(frozen=True)
class Call:
    """One outbound HTTP request the app made to InventDB."""

    method: str
    path: str
    #: Which instance the request went to. Almost always the configured one —
    #: the exception is the Settings page probing a host before the app is
    #: repointed at it.
    base: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)
    # A multipart upload carries no JSON body, so `body` is None and what was
    # actually sent lives here: `files` as requests received it — usually
    # `{"file": (filename, content, content_type)}` — and `data` for the
    # ordinary form fields alongside it (the folder an upload targets).
    files: Optional[dict[str, Any]] = None
    data: Optional[dict[str, Any]] = None

    @property
    def upload(self) -> Optional[tuple[str, bytes, str]]:
        """The uploaded ``(filename, content, content_type)``, if this was one."""
        part = (self.files or {}).get("file")
        return part if isinstance(part, tuple) else None

    @property
    def sql(self) -> Optional[str]:
        """The SQL statement, when this call is a ``POST /sql``."""
        if self.path == "/sql" and isinstance(self.body, dict):
            statement = self.body.get("sql")
            if isinstance(statement, str):
                return statement
        return None

    @property
    def token(self) -> Optional[str]:
        auth = self.headers.get("Authorization", "")
        return auth[len("Bearer ") :] if auth.startswith("Bearer ") else None

    def __repr__(self) -> str:  # pragma: no cover - test failure output only
        suffix = f" sql={self.sql!r}" if self.sql else ""
        return f"<Call {self.method} {self.path} params={self.params}{suffix}>"


class Reply:
    """A canned HTTP response.

    Exactly one body style applies: a JSON ``payload`` (the default), ``raw``
    text that is *not* valid JSON, ``empty`` for a bodiless 204-style reply, or
    ``chunks`` for a streamed body delivered piece by piece. The middle two
    exist because ``InventDBClient._parse`` has explicit branches for both and
    they would otherwise go untested; ``chunks`` is for the Analyze agent
    stream, which the app relays rather than parses.
    """

    __slots__ = ("status", "payload", "raw", "empty", "chunks", "headers")

    def __init__(
        self,
        status: int = 200,
        payload: Any = None,
        *,
        raw: Optional[Union[str, bytes]] = None,
        empty: bool = False,
        chunks: Optional[list[Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        self.status = status
        self.payload = payload
        self.raw = raw
        self.empty = empty
        self.chunks = chunks
        self.headers = headers or {}


class _Response:
    """The slice of ``requests.Response`` that ``_parse`` actually touches."""

    def __init__(self, reply: Reply) -> None:
        self._reply = reply
        self.status_code = reply.status
        # Real responses carry headers, and the file routes read them to relay
        # a download's content type and length. Without this the fake looks
        # like a `requests.Response` right up until something touches one.
        self.headers = dict(reply.headers)

    @property
    def text(self) -> str:
        if self._reply.empty:
            return ""
        if self._reply.raw is not None:
            raw = self._reply.raw
            # A binary body (a PDF, a thumbnail) has no faithful `.text`;
            # decoding it loosely is what `requests` does too.
            return raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
        return jsonlib.dumps(self._reply.payload)

    @property
    def content(self) -> bytes:
        if self._reply.raw is not None and isinstance(self._reply.raw, bytes):
            return self._reply.raw
        return self.text.encode("utf-8")

    def json(self) -> Any:
        if self._reply.empty or self._reply.raw is not None:
            # requests raises JSONDecodeError, which subclasses ValueError —
            # the exception `_parse` catches.
            raise ValueError("No JSON object could be decoded")
        return self._reply.payload

    # -- streaming ---------------------------------------------------------
    # The Analyze agent stream is the one response the app does NOT parse: it
    # forwards the bytes to the browser as they arrive. These two members are
    # the whole of what the relay touches, so a test can hand it a scripted SSE
    # body and assert what reached the client.
    def iter_content(self, chunk_size: Any = None) -> Any:
        for chunk in self._reply.chunks if self._reply.chunks is not None else [self.content]:
            yield chunk if isinstance(chunk, bytes) else str(chunk).encode("utf-8")

    def close(self) -> None:
        self.closed = True


Matcher = Union[str, Pattern[str], Callable[[Call], bool]]
Responder = Union[Reply, Callable[[Call], Reply], BaseException]


@dataclass
class _Rule:
    method: Optional[str]
    matcher: Matcher
    responder: Responder

    def matches(self, call: Call) -> bool:
        if self.method and self.method != call.method:
            return False
        if isinstance(self.matcher, re.Pattern):
            return bool(self.matcher.search(call.path))
        if isinstance(self.matcher, str):
            return self.matcher == call.path
        return bool(self.matcher(call))


class FakeInventDB:
    """Records what the app sent upstream and decides what comes back."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.calls: list[Call] = []
        self._rules: list[_Rule] = []
        #: Additional instances this test expects the app to contact. Empty by
        #: default, so "the app talked to a host nobody authorised" stays a
        #: failure rather than something a mock quietly absorbs.
        self.extra_bases: set[str] = set()

    def allow_base(self, base_url: str) -> "FakeInventDB":
        """Permit requests to another instance (the settings probe)."""
        self.extra_bases.add(base_url.rstrip("/"))
        return self

    # -------------------------------------------------------------- registration
    def on(
        self,
        method: str,
        path: Matcher,
        payload: Any = None,
        *,
        status: int = 200,
        raw: Optional[Union[str, bytes]] = None,
        empty: bool = False,
        chunks: Optional[list[Any]] = None,
        headers: Optional[dict[str, str]] = None,
        error: Optional[BaseException] = None,
    ) -> "FakeInventDB":
        """Route ``method path`` to a canned reply (or raise ``error``).

        ``path`` may be an exact string, a compiled regex (searched against the
        path), or a predicate over the :class:`Call`. ``raw`` takes bytes for a
        binary body (a PDF, a thumbnail); ``headers`` is what the file routes
        relay to the browser.
        """
        responder: Responder = error or Reply(
            status, payload, raw=raw, empty=empty, chunks=chunks, headers=headers
        )
        self._rules.append(_Rule(method.upper(), path, responder))
        return self

    def on_sql(
        self,
        contains: Union[str, Callable[[str], bool], None] = None,
        *,
        rows: Optional[list[dict[str, Any]]] = None,
        status: int = 200,
        payload: Any = _UNSET,
        error: Optional[BaseException] = None,
    ) -> "FakeInventDB":
        """Answer ``POST /sql`` whose statement matches ``contains``.

        ``contains`` is a case-insensitive substring, a predicate over the SQL
        text, or ``None`` to match every statement.
        """

        def _matcher(call: Call) -> bool:
            statement = call.sql
            if statement is None:
                return False
            if contains is None:
                return True
            if callable(contains):
                return bool(contains(statement))
            return contains.lower() in statement.lower()

        # `_UNSET` rather than `None`, so a test can assert what happens when
        # InventDB replies with a JSON `null`.
        body = (
            payload
            if payload is not _UNSET
            else {"rows": list(rows or []), "metrics": {"count": len(rows or [])}}
        )
        responder: Responder = error or Reply(status, body)
        self._rules.append(_Rule("POST", _matcher, responder))
        return self

    def on_record(self, type_name: str, record_id: str, payload: Any, *, status: int = 200):
        """Shorthand for ``GET /db/<ns>/<type>/<id>``."""
        return self.on(
            "GET", f"/db/pms/{type_name}/{record_id}", payload, status=status
        )

    # --------------------------------------------------------------- inspection
    @property
    def sql_log(self) -> list[str]:
        """Every SQL statement sent, in order."""
        return [c.sql for c in self.calls if c.sql is not None]

    @property
    def last_sql(self) -> str:
        log = self.sql_log
        assert log, "no SQL was sent to InventDB"
        return log[-1]

    def only_sql(self) -> str:
        """The single statement sent — asserts there was exactly one."""
        log = self.sql_log
        assert len(log) == 1, f"expected exactly 1 statement, got {len(log)}: {log}"
        return log[0]

    def calls_to(self, method: str, path: Optional[str] = None) -> list[Call]:
        return [
            c
            for c in self.calls
            if c.method == method.upper() and (path is None or c.path == path)
        ]

    def last_call(self, method: str, path: Optional[str] = None) -> Call:
        matches = self.calls_to(method, path)
        assert matches, f"no {method} {path or ''} call was made; saw {self.calls}"
        return matches[-1]

    def reset(self) -> None:
        self.calls.clear()

    # ---------------------------------------------------------------- transport
    def transport(
        self,
        method: str,
        url: str,
        *,
        headers: Optional[dict[str, str]] = None,
        json: Any = None,
        params: Optional[dict[str, Any]] = None,
        timeout: Any = None,
        files: Optional[dict[str, Any]] = None,
        data: Optional[dict[str, Any]] = None,
        **_ignored: Any,
    ) -> _Response:
        """Drop-in for ``requests.request``."""
        base = next(
            (b for b in (self.base_url, *self.extra_bases) if url.startswith(b)), None
        )
        assert base is not None, (
            f"request escaped the configured instance: {url!r} is not under "
            f"{self.base_url!r} (allow it with fake.allow_base(...) if intended)"
        )
        call = Call(
            method=method.upper(),
            path=url[len(base) :],
            base=base,
            params=dict(params or {}),
            body=json,
            headers=dict(headers or {}),
            files=dict(files) if files else None,
            data=dict(data) if data else None,
        )
        self.calls.append(call)

        for rule in reversed(self._rules):
            if rule.matches(call):
                responder = rule.responder
                if isinstance(responder, BaseException):
                    raise responder
                reply = responder(call) if callable(responder) else responder
                return _Response(reply)

        return _Response(self._default(call))

    @staticmethod
    def _default(call: Call) -> Reply:
        """What an unrouted call gets: an empty result set, or a bare ack.

        Deliberately benign. Tests that care about a response register a rule;
        tests that don't should not have to stub endpoints they never assert on.
        """
        if call.path == "/sql":
            return Reply(200, {"rows": [], "metrics": {"count": 0}})
        return Reply(200, {"ok": True})
