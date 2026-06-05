# kintsugi-sdk (Python)

Official Kintsugi platform SDK for Python. Sync (`KintsugiClient`) + async
(`AsyncKintsugiClient`) clients sharing the same auth + canonicalization rules
as the TypeScript SDK.

## Install

```bash
pip install kintsugi-sdk
# dev: pip install -e '.[dev]'
```

## Quick start

```python
import os
from kintsugi_sdk import KintsugiClient, AccessKeyAuth

with KintsugiClient(
    base_url="https://kintsugi.example.com",
    app_code="my-app",
    auth=AccessKeyAuth(
        access_key=os.environ["KINTSUGI_AK"],
        secret_key=os.environ["KINTSUGI_SK"],
    ),
) as client:
    # Datasets
    page = client.models["orders"].filter({
        "where": [{"field": "status", "op": "eq", "value": "paid"}],
        "pageSize": 50,
    })
    print(page["total"])

    # Custom SQL
    sql = client.sql.execute(
        sql_code="orders-summary-monthly",
        params={"since": "2026-01-01"},
        actor="agent",
    )

    # BFF
    out = client.bff.execute("orders-with-customer", {"tenantCode": "acme"})

    # AI 问数
    ask = client.chats.ask("最近 30 天每天的订单量", max_tables=6)
```

## Async

```python
import asyncio
from kintsugi_sdk import AsyncKintsugiClient, BearerAuth

async def main():
    async with AsyncKintsugiClient(
        base_url="https://kintsugi.example.com",
        app_code="my-app",
        auth=BearerAuth(token="..."),
    ) as client:
        page = await client.models["orders"].filter({"page": 1})
        print(page)

asyncio.run(main())
```

## Auth

| Mode       | Class                   | When to use                        |
| ---------- | ----------------------- | ---------------------------------- |
| Cookie     | `CookieAuth()`          | inside a logged-in browser session |
| Bearer     | `BearerAuth(token)`     | short-lived JWT (login response)   |
| Access Key | `AccessKeyAuth(ak, sk)` | server-to-server, long-lived       |

The HMAC scheme is identical to the TS SDK:
`canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body`,
signed with HMAC-SHA256 and the secret key, sent in `X-Signature`.

## Errors

All non-2xx responses raise `KintsugiHTTPError(status, body)` with `.code`
and `.message` extracted from the server's JSON envelope when present.

## Test

```bash
pip install -e '.[dev]'
pytest
```
