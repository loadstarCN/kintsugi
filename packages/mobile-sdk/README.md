# @kintsugi/mobile-sdk

Kintsugi 移动端官方 SDK 源码。包含：

- **iOS**（Swift Package）：`ios/`，`import KintsugiKit`
- **Android**（Gradle Module）：`android/kintsugi`，`com.kintsugi.KintsugiClient`

两端 API 形状完全对齐 `@kintsugi/sdk`（TypeScript）：

```
KintsugiClient(baseUrl, appCode, auth)
  .filter / .getOne / .create / .update / .delete
  .askChats
```

## 认证

- `.token("eyJ...")` → Authorization: Bearer
- `.accessKey(key, secret)` → 自动 HMAC-SHA256 签名（X-Access-Key / X-Timestamp / X-Nonce / X-Signature）

注意：当前 server 端 `AccessKeyService.verifySignature` 用的是 bcrypt(secretKey).hash 作为 HMAC key（MVP 简化，参见文件注释），要让这里算出来的签名匹配，生产化时请同步调整服务端签名 key 源。

## iOS 安装

在 Xcode 里 `File → Add Package Dependencies → 本地 path 指向 packages/mobile-sdk/ios`。

```swift
import KintsugiKit

let client = KintsugiClient(
    baseURL: URL(string: "https://api.kintsugi.example.com")!,
    appCode: "app-demo0001",
    auth: .token("eyJ...")
)
let result: FilterResult<Goods> = try await client.filter(
    datasetCode: "ds1234...",
    body: FilterRequest(pageSize: 20)
)
```

## Android 安装

在 `settings.gradle.kts` 里：

```kotlin
include(":kintsugi")
project(":kintsugi").projectDir = file("../packages/mobile-sdk/android/kintsugi")
```

```kotlin
import com.kintsugi.KintsugiClient
import com.kintsugi.KintsugiAuth
import com.kintsugi.FilterRequest
import kotlinx.serialization.Serializable

@Serializable data class Goods(val id: String, val name: String, val list_price: String?)

val client = KintsugiClient(
    baseUrl = "https://api.kintsugi.example.com",
    appCode = "app-demo0001",
    auth = KintsugiAuth.Token("eyJ..."),
)
val r = client.filter<Goods>("ds1234...", FilterRequest(pageSize = 20))
```

## 还没做的

- Cocoapods / Swift Package Index 上线 —— 先内网 path 方式用
- Gradle Central 发布 —— 先子模块 path include
- 推送 / 离线缓存 —— 不在 SDK 范围，上层 APP 自己做

如果想要 OpenAPI 自动生成 client 代替手写，可以：

```bash
curl https://your-server/api/apps/<appCode>/openapi.json > openapi.json
openapi-generator-cli generate -i openapi.json -g swift5 -o ./swift-codegen
openapi-generator-cli generate -i openapi.json -g kotlin -o ./kotlin-codegen
```
