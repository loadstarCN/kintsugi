"""Dataset client — generic CRUD/query bag returned by client.models[code].

The sync and async clients use the same shape but different return types
(synchronous vs awaitable). To avoid duplicating the URL templates, both
delegate to a small "request" callable injected by the parent.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Generic, Optional, TypeVar
from urllib.parse import quote

T = TypeVar("T")
SyncReq = Callable[[str, str, Optional[Any]], Any]
AsyncReq = Callable[[str, str, Optional[Any]], Awaitable[Any]]


class _DatasetBase(Generic[T]):
    def __init__(self, app_code: str, dataset_code: str) -> None:
        self._app_code = app_code
        self._dataset_code = dataset_code
        self._base = f"/api/apps/{quote(app_code, safe='')}/ds/{quote(dataset_code, safe='')}"


class DatasetClient(_DatasetBase):
    """Sync dataset client. Returns are plain dict / list / int — not pydantic models.
    Wrap in a typed dataclass on your end if you need static typing."""

    def __init__(self, app_code: str, dataset_code: str, request: SyncReq) -> None:
        super().__init__(app_code, dataset_code)
        self._request = request

    def filter(self, req: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        return self._request("POST", f"{self._base}/filter", req or {})

    def get_one(self, id: str | int) -> dict[str, Any]:
        return self._request("GET", f"{self._base}/{quote(str(id), safe='')}", None)

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", self._base, data)

    def update(self, id: str | int, data: dict[str, Any]) -> dict[str, Any]:
        return self._request("PATCH", f"{self._base}/{quote(str(id), safe='')}", data)

    def delete(self, id: str | int) -> dict[str, Any]:
        return self._request("DELETE", f"{self._base}/{quote(str(id), safe='')}", None)

    def batch_create(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._request("POST", f"{self._base}/batchCreate", {"rows": rows})

    def aggregate(self, req: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"{self._base}/aggregate", req)

    def get_select_options(self, field: str) -> dict[str, Any]:
        return self._request("GET", f"{self._base}/options/{quote(field, safe='')}", None)


class AsyncDatasetClient(_DatasetBase):
    def __init__(self, app_code: str, dataset_code: str, request: AsyncReq) -> None:
        super().__init__(app_code, dataset_code)
        self._request = request

    async def filter(self, req: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        return await self._request("POST", f"{self._base}/filter", req or {})

    async def get_one(self, id: str | int) -> dict[str, Any]:
        return await self._request("GET", f"{self._base}/{quote(str(id), safe='')}", None)

    async def create(self, data: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", self._base, data)

    async def update(self, id: str | int, data: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"{self._base}/{quote(str(id), safe='')}", data)

    async def delete(self, id: str | int) -> dict[str, Any]:
        return await self._request("DELETE", f"{self._base}/{quote(str(id), safe='')}", None)

    async def batch_create(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return await self._request("POST", f"{self._base}/batchCreate", {"rows": rows})

    async def aggregate(self, req: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", f"{self._base}/aggregate", req)

    async def get_select_options(self, field: str) -> dict[str, Any]:
        return await self._request("GET", f"{self._base}/options/{quote(field, safe='')}", None)
