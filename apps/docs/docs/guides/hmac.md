# HMAC 签名规范

OpenAPI 路径用 HMAC-SHA256 签名认证（不用 JWT）。

## Headers

| Header         | 含义                              |
| -------------- | --------------------------------- |
| `X-Access-Key` | 公钥（`ak_xxx`）                  |
| `X-Signature`  | 签名（hex）                       |
| `X-Timestamp`  | UNIX 秒；±5 min 窗口              |
| `X-Nonce`      | 任意唯一字符串；25 min 内不可重放 |

## canonical string

```
METHOD + '\n' + PATH + '\n' + TIMESTAMP + '\n' + NONCE + '\n' + BODY
```

- METHOD: 大写
- PATH: 含 query string，不含 host
- BODY: 原文（GET 请求传空字符串）

## 签名

```
signature = hex(HMAC-SHA256(secretKey, canonical))
```

## 例子（Node）

```ts
import crypto from 'crypto';

function sign(method, path, body, accessKey, secretKey) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString('hex');
  const canonical = [method.toUpperCase(), path, ts, nonce, body].join('\n');
  const sig = crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
  return {
    'X-Access-Key': accessKey,
    'X-Signature': sig,
    'X-Timestamp': ts,
    'X-Nonce': nonce,
  };
}
```

## 防重放

成功验签后，server 把 `(accessKey, nonce)` 写入 `AccessKeyNonce` 表，唯一索引；
同一 nonce 25 min 内重出现 → 403。25 min 后过期清理。

## 旋转

```bash
POST /api/access-keys/:accessKey/rotate?graceMinutes=60
```

返回 `newSecretKey`。**60 min 内**老 secret 仍可验签——客户端切完后老的自然失效。

## 撤销

```bash
DELETE /api/access-keys/:accessKey
```

立即失效；不可 undo。

## SDK

`@kintsugi/sdk` 自带 HMAC mode：

```ts
const k = createClient({
  baseUrl: '...',
  auth: { mode: 'hmac', accessKey: 'ak_...', secretKey: 'sk_...' },
});
```

## 接收方调试：验出站 webhook 签名

平台**出站**（`/api/webhooks` 订阅的 `dataset.*` 等事件）走 HMAC-SHA256 over body，
header 是 `X-Kintsugi-Signature: sha256=<hex>`。接收方写完验签代码后，可以用
`kintsugi webhook-verify` 离线对一遍——不连任何 server，纯本地工具：

```bash
# 把刚收到的请求 dump 到本地：
echo '{"event":"dataset.created","id":"ds-1"}' > body.json
SIG='sha256=d4f3...'   # 从请求 header X-Kintsugi-Signature 抄

# 验：
kintsugi webhook-verify -s 'whsec_xxx' -b body.json -S "$SIG"
# ✓ signature OK
```

- `-s @secret.txt` 把 secret 从文件读，避免 shell history 泄漏；
- `-b -` 从 stdin 读 body（curl + tee 时方便）；
- 签名错时退出码 1，stderr 里会同时打 `expected` 和 `provided`，方便对哪一位翻车。
