"""Sync + async Kintsugi clients.

Both share the same auth / canonicalization rules, just different transport.
The sync client uses httpx.Client; the async client uses httpx.AsyncClient.
Each can be used as a context manager for clean shutdown.

Usage:

    with KintsugiClient(base_url="https://...", app_code="my-app",
                       auth=AccessKeyAuth(ak, sk)) as client:
        rows = client.models["orders"].filter(...)

    async with AsyncKintsugiClient(...) as client:
        rows = await client.models["orders"].filter(...)
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from ._canonical import serialize_body_for_sign
from ._dataset import AsyncDatasetClient, DatasetClient
from .auth import AccessKeyAuth, Auth, BearerAuth, CookieAuth
from .errors import KintsugiHTTPError


def _build_auth(
    auth: Optional[Auth | AccessKeyAuth | BearerAuth | CookieAuth],
) -> Optional[Auth]:
    """No-op for now — accepted to mirror the TS SDK's options shape."""
    return auth


# ---------- shared helpers ----------


def _build_headers(
    method: str,
    path: str,
    body_str: str,
    auth: Optional[Auth],
) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if auth is not None:
        auth.apply(method=method, path=path, body=body_str, headers=headers)
    return headers


def _decode_response(resp: httpx.Response) -> Any:
    ctype = resp.headers.get("content-type", "")
    if "application/json" in ctype:
        try:
            return resp.json()
        except ValueError:
            return resp.text
    return resp.text


# ---------- sync ----------


class _ModelsProxy:
    """Lazy dict-like accessor for client.models[<datasetCode>]."""

    def __init__(self, factory) -> None:  # noqa: ANN001
        self._factory = factory
        self._cache: dict[str, Any] = {}

    def __getitem__(self, dataset_code: str):  # noqa: ANN204
        if dataset_code not in self._cache:
            self._cache[dataset_code] = self._factory(dataset_code)
        return self._cache[dataset_code]

    def __getattr__(self, name: str):  # noqa: ANN204
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


class _SqlNamespace:
    def __init__(self, request) -> None:  # noqa: ANN001
        self._request = request

    def execute(
        self,
        sql_code: str,
        params: Optional[dict[str, Any]] = None,
        actor: str = "human",
        sql_safe: bool = False,
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/sql/{sql_code}/execute",
            {
                "params": params or {},
                "actor": actor,
                "sqlSafe": sql_safe,
            },
        )


class _AsyncSqlNamespace:
    def __init__(self, request) -> None:  # noqa: ANN001
        self._request = request

    async def execute(
        self,
        sql_code: str,
        params: Optional[dict[str, Any]] = None,
        actor: str = "human",
        sql_safe: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/api/sql/{sql_code}/execute",
            {
                "params": params or {},
                "actor": actor,
                "sqlSafe": sql_safe,
            },
        )


class _BffNamespace:
    def __init__(self, app_code: str, request) -> None:  # noqa: ANN001
        self._app_code = app_code
        self._request = request

    def execute(self, script_name: str, payload: Optional[Any] = None) -> Any:
        return self._request(
            "POST",
            f"/api/bff/exec/{self._app_code}/{script_name}",
            {"payload": payload},
        )


class _AsyncBffNamespace:
    def __init__(self, app_code: str, request) -> None:  # noqa: ANN001
        self._app_code = app_code
        self._request = request

    async def execute(self, script_name: str, payload: Optional[Any] = None) -> Any:
        return await self._request(
            "POST",
            f"/api/bff/exec/{self._app_code}/{script_name}",
            {"payload": payload},
        )


class _ChatsNamespace:
    def __init__(self, app_code: str, request) -> None:  # noqa: ANN001
        self._app_code = app_code
        self._request = request

    def ask(self, question: str, max_tables: Optional[int] = None) -> dict[str, Any]:
        body: dict[str, Any] = {"appCode": self._app_code, "question": question}
        if max_tables is not None:
            body["maxTables"] = max_tables
        return self._request("POST", "/api/chats/ask", body)


class _AsyncChatsNamespace:
    def __init__(self, app_code: str, request) -> None:  # noqa: ANN001
        self._app_code = app_code
        self._request = request

    async def ask(self, question: str, max_tables: Optional[int] = None) -> dict[str, Any]:
        body: dict[str, Any] = {"appCode": self._app_code, "question": question}
        if max_tables is not None:
            body["maxTables"] = max_tables
        return await self._request("POST", "/api/chats/ask", body)


# ---------- public clients ----------


class KintsugiClient:
    """Synchronous Kintsugi platform client."""

    def __init__(
        self,
        *,
        base_url: str,
        app_code: str,
        auth: Optional[Auth] = None,
        timeout: float = 30.0,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.app_code = app_code
        self._base = base_url.rstrip("/")
        self._auth = _build_auth(auth)
        self._owns_client = client is None
        # cookie jar only when running in cookie mode AND no externally-provided client
        cookies_arg: dict[str, str] = {}
        if isinstance(self._auth, CookieAuth):
            cookies_arg = {}  # caller is expected to pre-populate via httpx.Cookies
        self._http: httpx.Client = client or httpx.Client(timeout=timeout, follow_redirects=False, cookies=cookies_arg)
        self.models = _ModelsProxy(
            lambda code: DatasetClient(app_code, code, self.request),
        )
        self.sql = _SqlNamespace(self.request)
        self.bff = _BffNamespace(app_code, self.request)
        self.chats = _ChatsNamespace(app_code, self.request)

    # ---- ctx mgmt ----

    def __enter__(self) -> "KintsugiClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._http.close()

    # ---- request ----

    def request(self, method: str, path: str, body: Optional[Any] = None) -> Any:
        body_str = serialize_body_for_sign(body)
        headers = _build_headers(method, path, body_str, self._auth)
        url = f"{self._base}{path}"
        # NB: pass `content` (raw bytes) not `json=` — we already serialized exactly the
        # bytes we signed; httpx must not re-serialize and produce a different byte stream.
        resp = self._http.request(
            method.upper(),
            url,
            headers=headers,
            content=body_str.encode("utf-8") if body_str else None,
        )
        decoded = _decode_response(resp)
        if not (200 <= resp.status_code < 300):
            raise KintsugiHTTPError(resp.status_code, decoded)
        return decoded


class AsyncKintsugiClient:
    """Asynchronous Kintsugi platform client (httpx.AsyncClient under the hood)."""

    def __init__(
        self,
        *,
        base_url: str,
        app_code: str,
        auth: Optional[Auth] = None,
        timeout: float = 30.0,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.app_code = app_code
        self._base = base_url.rstrip("/")
        self._auth = _build_auth(auth)
        self._owns_client = client is None
        self._http: httpx.AsyncClient = client or httpx.AsyncClient(
            timeout=timeout, follow_redirects=False
        )
        self.models = _ModelsProxy(
            lambda code: AsyncDatasetClient(app_code, code, self.request),
        )
        self.sql = _AsyncSqlNamespace(self.request)
        self.bff = _AsyncBffNamespace(app_code, self.request)
        self.chats = _AsyncChatsNamespace(app_code, self.request)

    async def __aenter__(self) -> "AsyncKintsugiClient":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._http.aclose()

    async def request(self, method: str, path: str, body: Optional[Any] = None) -> Any:
        body_str = serialize_body_for_sign(body)
        headers = _build_headers(method, path, body_str, self._auth)
        url = f"{self._base}{path}"
        resp = await self._http.request(
            method.upper(),
            url,
            headers=headers,
            content=body_str.encode("utf-8") if body_str else None,
        )
        decoded = _decode_response(resp)
        if not (200 <= resp.status_code < 300):
            raise KintsugiHTTPError(resp.status_code, decoded)
        return decoded
