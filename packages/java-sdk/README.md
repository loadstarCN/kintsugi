# kintsugi-sdk (Java)

Official Kintsugi platform SDK for Java. JDK 17+, built on `java.net.http`

- Jackson. No reactive runtime required.

## Install

```xml
<!-- Maven -->
<dependency>
  <groupId>com.kintsugi</groupId>
  <artifactId>kintsugi-sdk</artifactId>
  <version>0.1.0</version>
</dependency>
```

```kotlin
// Gradle (Kotlin DSL)
implementation("com.kintsugi:kintsugi-sdk:0.1.0")
```

## Quick start

```java
import com.fasterxml.jackson.core.type.TypeReference;
import com.kintsugi.sdk.*;
import com.kintsugi.sdk.DatasetClient.FilterRequest;
import com.kintsugi.sdk.DatasetClient.Where;

import java.util.List;
import java.util.Map;

public class Demo {
    record Order(long id, String status, double total) {}

    public static void main(String[] args) {
        KintsugiClient client = KintsugiClient.builder()
            .baseUrl("https://kintsugi.example.com")
            .appCode("my-app")
            .auth(Auth.accessKey(
                System.getenv("KINTSUGI_AK"),
                System.getenv("KINTSUGI_SK")))
            .build();

        // Datasets
        KintsugiClient.Paged<Order> page = client.dataset("orders").filter(
            FilterRequest.of().where(List.of(Where.eq("status", "paid"))).pageSize(50),
            new TypeReference<>() {}
        );
        System.out.printf("got %d of %d%n", page.data().size(), page.total());

        // Custom SQL
        KintsugiClient.SqlExecuteResponse sql = client.sql.execute(
            "orders-summary-monthly",
            Map.of("since", "2026-01-01")
        );

        // BFF
        record BffOut(List<Order> orders) {}
        BffOut bff = client.bff.execute(
            "orders-with-customer",
            Map.of("tenantCode", "acme"),
            new TypeReference<BffOut>() {}
        );

        // 问数
        KintsugiClient.ChatsAskResult ask = client.chats.ask("最近 30 天每天的订单量", 6);
        System.out.println(ask.sql() + " — " + ask.explanation());
    }
}
```

## Auth

| Mode       | Constructor              | When                               |
| ---------- | ------------------------ | ---------------------------------- |
| Cookie     | `Auth.cookie()`          | inside a logged-in browser session |
| Bearer     | `Auth.bearer(token)`     | short-lived JWT                    |
| Access Key | `Auth.accessKey(ak, sk)` | server-to-server                   |

The HMAC scheme matches the TS / Python / Go SDKs:
`canonical = METHOD + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + body`,
HMAC-SHA256(secret, canonical) → hex → `X-Signature`.

## Errors

Non-2xx responses throw `KintsugiHttpException` (RuntimeException) with
`.status()`, `.code()`, `.body()`. Catch like:

```java
try {
    client.dataset("orders").getOne(1, new TypeReference<Map<String, Object>>(){});
} catch (KintsugiHttpException e) {
    if (e.status() == 404) { /* ... */ }
}
```

## Test

```bash
mvn test
```
