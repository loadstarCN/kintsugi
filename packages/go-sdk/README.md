# kintsugi-go

Official Kintsugi platform SDK for Go. Same auth + canonicalization protocol
as the TypeScript / Python SDKs.

## Install

```bash
go get github.com/kintsugi/kintsugi-go@latest
```

## Quick start

```go
package main

import (
    "context"
    "log"
    "os"

    "github.com/kintsugi/kintsugi-go"
)

type Order struct {
    ID     int64   `json:"id"`
    Status string  `json:"status"`
    Total  float64 `json:"total"`
}

func main() {
    c := kintsugi.NewClient(kintsugi.Config{
        BaseURL: "https://kintsugi.example.com",
        AppCode: "my-app",
        Auth: kintsugi.AccessKeyAuth{
            AccessKey: os.Getenv("KINTSUGI_AK"),
            SecretKey: os.Getenv("KINTSUGI_SK"),
        },
    })
    ctx := context.Background()

    // Datasets
    var page kintsugi.Paged[Order]
    err := c.Dataset("orders").Filter(ctx, kintsugi.FilterRequest{
        Where:    []kintsugi.Where{{Field: "status", Op: "eq", Value: "paid"}},
        PageSize: 50,
    }, &page)
    if err != nil {
        log.Fatal(err)
    }
    log.Printf("got %d of %d", len(page.Data), page.Total)

    // Custom SQL
    var sql kintsugi.SQLExecuteResponse
    if err := c.SQL.Execute(ctx, "orders-summary-monthly", kintsugi.SQLExecuteRequest{
        Params: map[string]any{"since": "2026-01-01"},
        Actor:  "agent",
    }, &sql); err != nil {
        log.Fatal(err)
    }

    // BFF
    var bffOut struct {
        Orders []Order `json:"orders"`
    }
    if err := c.BFF.Execute(ctx, "orders-with-customer", map[string]any{
        "tenantCode": "acme",
    }, &bffOut); err != nil {
        log.Fatal(err)
    }

    // 问数
    ask, err := c.Chats.Ask(ctx, "最近 30 天每天的订单量", 6)
    if err != nil {
        log.Fatal(err)
    }
    log.Println(ask.SQL, ask.Explanation)
}
```

## Auth

| Mode       | Type                                           | When                               |
| ---------- | ---------------------------------------------- | ---------------------------------- |
| Cookie     | `kintsugi.CookieAuth{}`                        | inside a logged-in browser session |
| Bearer     | `kintsugi.BearerAuth{Token: "..."}`            | short-lived JWT                    |
| Access Key | `kintsugi.AccessKeyAuth{AccessKey, SecretKey}` | server-to-server                   |

The HMAC scheme matches the TS / Python SDKs:
`canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body`,
HMAC-SHA256(secret, canonical) → hex → `X-Signature`.

## Errors

Non-2xx responses surface as `*kintsugi.HTTPError` with `.Status`, `.Code`,
`.Message`, `.Body`. Type-assert to inspect:

```go
err := c.Dataset("orders").GetOne(ctx, 1, &out)
var he *kintsugi.HTTPError
if errors.As(err, &he) && he.Status == 404 { ... }
```

## Test

```bash
go test ./...
```
