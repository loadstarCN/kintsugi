"""End-to-end-ish tests against a respx-mocked server.

We pin the auth's timestamp/nonce via monkeypatch so signatures are reproducible,
then assert the request shape (URL / headers / body) matches the TS SDK protocol.
"""

import json
from typing import Any

import httpx
import pytest
import respx

from kintsugi_sdk import (
    AccessKeyAuth,
    AsyncKintsugiClient,
    BearerAuth,
    KintsugiClient,
    KintsugiHTTPError,
)


@pytest.fixture
def freeze_hmac(monkeypatch):
    import time, secrets
    monkeypatch.setattr(time, "time", lambda: 1700000000)
    monkeypatch.setattr(secrets, "token_hex", lambda n: "deadbeefcafe1234")


@respx.mock
def test_filter_serializes_compact_json(freeze_hmac):
    route = respx.post("https://k.example/api/apps/my-app/ds/orders/filter").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0, "page": 1, "pageSize": 50}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=AccessKeyAuth("ak_x", "secret"),
    )
    result = client.models["orders"].filter({"page": 1})
    assert result == {"data": [], "total": 0, "page": 1, "pageSize": 50}
    assert route.called
    sent = route.calls.last.request
    # body must be compact JSON (no spaces) — that's what the signature was over
    assert sent.content == b'{"page":1}'
    assert sent.headers["X-Access-Key"] == "ak_x"
    assert sent.headers["X-Timestamp"] == "1700000000"
    assert sent.headers["X-Nonce"] == "deadbeefcafe1234"
    assert len(sent.headers["X-Signature"]) == 64


@respx.mock
def test_get_one_no_body_no_signed_body(freeze_hmac):
    respx.get("https://k.example/api/apps/my-app/ds/orders/123").mock(
        return_value=httpx.Response(200, json={"id": 123, "status": "paid"}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=AccessKeyAuth("ak", "s"),
    )
    out = client.models["orders"].get_one(123)
    assert out["status"] == "paid"


@respx.mock
def test_bearer_sets_authorization():
    respx.post("https://k.example/api/sql/orders-monthly/execute").mock(
        return_value=httpx.Response(200, json={"data": [], "rowCount": 0, "riskLevel": "low"}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=BearerAuth("jwt-x"),
    )
    client.sql.execute("orders-monthly", {"since": "2026-01-01"})
    sent = respx.calls.last.request
    assert sent.headers["Authorization"] == "Bearer jwt-x"
    body = json.loads(sent.content)
    assert body["params"] == {"since": "2026-01-01"}
    assert body["actor"] == "human"
    assert body["sqlSafe"] is False


@respx.mock
def test_4xx_raises_with_envelope():
    respx.post("https://k.example/api/sql/x/execute").mock(
        return_value=httpx.Response(403, json={"code": "FORBIDDEN", "message": "nope"}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=BearerAuth("t"),
    )
    with pytest.raises(KintsugiHTTPError) as ei:
        client.sql.execute("x")
    assert ei.value.status == 403
    assert ei.value.code == "FORBIDDEN"
    assert "nope" in ei.value.message


@respx.mock
def test_bff_payload_envelope():
    respx.post("https://k.example/api/bff/exec/my-app/orders-summary").mock(
        return_value=httpx.Response(200, json={"orders": []}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=BearerAuth("t"),
    )
    out = client.bff.execute("orders-summary", {"tenantCode": "acme"})
    assert out["orders"] == []
    sent = respx.calls.last.request
    body = json.loads(sent.content)
    assert body == {"payload": {"tenantCode": "acme"}}


@respx.mock
def test_chats_ask_includes_app_code():
    respx.post("https://k.example/api/chats/ask").mock(
        return_value=httpx.Response(200, json={"sql": "SELECT 1", "explanation": "...", "data": [], "rowCount": 0}),
    )
    client = KintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=BearerAuth("t"),
    )
    client.chats.ask("hi", max_tables=5)
    sent = respx.calls.last.request
    body = json.loads(sent.content)
    assert body == {"appCode": "my-app", "question": "hi", "maxTables": 5}


@respx.mock
@pytest.mark.asyncio
async def test_async_client_smoke():
    respx.post("https://k.example/api/apps/my-app/ds/orders/filter").mock(
        return_value=httpx.Response(200, json={"data": [{"id": 1}], "total": 1, "page": 1, "pageSize": 50}),
    )
    async with AsyncKintsugiClient(
        base_url="https://k.example",
        app_code="my-app",
        auth=BearerAuth("t"),
    ) as client:
        r: Any = await client.models["orders"].filter({"page": 1})
        assert r["total"] == 1
