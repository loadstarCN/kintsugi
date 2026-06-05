# 从零做出第一个应用

按 [quickstart](./quickstart) 跑通基础链路后，这一篇带你做出**真能给业务用的 v0**：调好 DBAgent → 编辑 DO → AI 生成页面 → 写 BFF → 加报表 → 配权限。

::: tip 假设
你有一个 `shop` 业务库（PG 或 MySQL），里面已经有 `user` / `goods` / `order` 几张表。我们用它做一个简化电商管理后台。
:::

## 1. 接库 + 扫描

跟 quickstart 第 3-4 步一样。这次注意几个调优参数：

```bash
curl -X POST http://localhost:4000/api/datasources \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "appCode": "app-shop0001",
    "dialect": "postgres",
    "displayName": "shop-prod",
    "host": "...", "port": 5432, "database": "shop",
    "username": "readonly_kintsugi",   // 强烈建议只读账号
    "password": "...",
    "sslMode": "disable",
    "extraParams": {
      "schema": "public"               // PG 用，MySQL 忽略
    }
  }'
```

扫描时可以传 `?include=`（仅扫指定表，加速）：

```bash
curl -X POST "http://localhost:4000/api/dbagent/datasources/$DSID/scan" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"include":["user","goods","order","order_item","category"]}'
```

## 2. 看扫描结果 + 接受关系候选

打开 web 控制台 `http://localhost:5173/datasources/<DSID>/scans/<jobId>`：

- 关系候选按 `heuristicScore` 排序
- 每条带 `reasons`：为什么 LLM 觉得 `order.user_id → user.id`
- **接受 / 拒绝 / 改写**——LLM 不准的人工 override 即可

::: tip 推理准确度
经验：纯规则层准确率 ≈ 75%-85%；规则 + LLM 复核 ≈ 92%+。
LLM 主要解决"`creator` 应该是 `created_by` 的别名"、"`order_no` 是单据号不是订单 ID"
这种语义判断；规则层搞不定。
:::

接受关系后落 Dataset：

```bash
curl -X POST "http://localhost:4000/api/datasets/from-scan/<jobId>" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"appCode":"app-shop0001"}'
```

## 3. 编辑 DO

打开 `http://localhost:5173/datasets/<datasetCode>` —— DO 编辑器。

针对 `goods` 表常见调整：

| 操作                           | 怎么做                                              | 效果                       |
| ------------------------------ | --------------------------------------------------- | -------------------------- |
| 把 `name` 业务名改成"商品名称" | `fields[].businessName`                             | 列表/表单/搜索框都用中文   |
| 把 `password` 标 `deprecated`  | `fields[].deprecated = true`                        | API 默认不返回；表单不渲染 |
| 把 `status` 配枚举             | `fields[].enumValues = ['active','off']`            | 下拉框自动出               |
| 标 `tenant_code` 是租户字段    | `fields[].role = 'tenantCode'` + 顶层 `tenantField` | Instant API 自动加 WHERE   |
| 标软删除字段                   | `softDeleteField = 'is_deleted'`                    | DELETE 自动改 UPDATE       |
| 设乐观锁                       | `versionField = 'version'`                          | 并发写自动检测             |

保存时带上 `expectedVersion`（GET 时拿到）：

```bash
curl -X PATCH "http://localhost:4000/api/datasets/$DSCODE/do" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"expectedVersion": 1, "doJson": {... 完整 DO ...}}'
```

被别人先改 → `BLOCKED_BY_CONCURRENT_EDIT`，前端弹"先 reload"。

## 4. AI 生成第一个页面

```bash
curl -X POST "http://localhost:4000/api/apps/app-shop0001/pages/generate" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "prompt": "做一个商品管理页：列表 + 按 name/category 筛选 + 创建/编辑表单 + 软删除按钮",
    "datasetCodes": ["<goods 的 datasetCode>"]
  }'
```

返回 `{ pageId, files }`。打开 `http://localhost:5173/pages/<pageId>`：

- 左半边预览（iframe + Babel-standalone 即时编译）
- 右半边源码编辑器
- 直接改 jsx → 保存 → 立刻看到效果
- 满意了 → "发布" → 写 `publishedVersion`

::: tip 多模态：传截图给它看
如果你有原型图：

```json
{
  "prompt": "按截图实现",
  "imageUrls": ["data:image/png;base64,iVBORw0KGgo..."]
}
```

LLM_MODEL 要是 vision 模型（DeepSeek-VL / GPT-4o）。
:::

## 5. 写 BFF 处理特殊业务规则

例：下单时要同时扣库存 + 写日志，单库事务保证一致性。

控制台 `http://localhost:5173/bff` → 新建：

```js
exports.handler = async (ctx) => {
  const { goodsId, qty } = ctx.input;
  const u = ctx.userInfo;

  return await ctx.client.tx(async () => {
    // 1. 查库存
    const goods = await ctx.client.models.goods.getOne(goodsId);
    if (goods.stock < qty) {
      throw new Error(`库存不足：${goods.stock} < ${qty}`);
    }

    // 2. 扣库存
    await ctx.client.models.goods.update(goodsId, { stock: goods.stock - qty });

    // 3. 创建订单
    const order = await ctx.client.models.order.create({
      goods_id: goodsId,
      qty,
      user_id: u.userId,
      status: 'pending',
    });

    // 4. 写日志（用 Custom SQL）
    await ctx.client.sql.execute('sql_audit_order_create', {
      orderId: order.id,
      operator: u.userId,
    });

    return { orderId: order.id, ok: true };
  });
};
```

调用：

```bash
curl -X POST "http://localhost:4000/api/bff/exec/app-shop0001/place-order" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"input":{"goodsId":1,"qty":2}}'
```

任何一步抛错 → 整个 tx 自动 ROLLBACK。

## 6. 创建 Custom SQL 给报表用

直接在 `KintsugiReport` 写不下的复杂查询用 Custom SQL：

```sql
-- sql_daily_revenue
SELECT
  date_trunc('day', created_at) AS day,
  SUM(amount) AS revenue,
  COUNT(*) AS orders
FROM "order"
WHERE created_at >= #{start} AND created_at < #{end}
  AND status = 'paid'
GROUP BY 1
ORDER BY 1
```

`#{start}` / `#{end}` 是 Kintsugi 的占位符（不是 `?` 也不是 `$1`），server 自动绑成方言对应的占位符。

落库：

```bash
curl -X POST http://localhost:4000/api/sql \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "appCode":"app-shop0001",
    "sqlName":"daily_revenue",
    "content":"...",
    "paramsSchema":{"start":"datetime","end":"datetime"}
  }'
```

调用：

```bash
curl -X POST http://localhost:4000/api/sql/<sqlCode>/execute \
  -H "authorization: Bearer $TOKEN" \
  -d '{"params":{"start":"2026-05-01","end":"2026-05-04"}}'
```

server 会自动给你的查询做：

- riskLevel 分类（`SELECT` → low；`UPDATE/DELETE` → medium / critical）
- AI actor 不能跑 critical
- low / AI actor 路径强制走 READ ONLY tx，DB 端兜底拒写

## 7. 配 RBAC

业务方 Bob 应该能看商品但不能删，给他建一个 viewer 角色：

```bash
# 创建角色
curl -X POST http://localhost:4000/api/rbac/roles \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "name": "viewer",
    "appCode": "app-shop0001",
    "permissions": {
      "grants": [
        "app-shop0001:dataset:read",
        "app-shop0001:bff:read",
        "app-shop0001:sql:read"
      ]
    }
  }'

# 分给 Bob
curl -X POST http://localhost:4000/api/rbac/assign \
  -H "authorization: Bearer $TOKEN" \
  -d '{"userId":"<bob-id>","roleId":"<viewer-role-id>"}'
```

Bob 拿到 `app-shop0001:dataset:read` 后只能调 GET / filter，PATCH / DELETE 一律 403。

::: tip wildcards
权限支持 wildcards：

- `*:*:*` → 超管
- `app-shop0001:*:*` → 应用管理员
- `*:dataset:read` → 全租户只读 dataset
  :::

## 8. 上线检查清单

| 检查项                    | 怎么验证                                             |
| ------------------------- | ---------------------------------------------------- |
| Redis 接通                | server 启动日志有 `[rate-limit] using Redis backend` |
| OTel trace 可见           | `OTEL_ENABLED=true`，去 dashboard 看                 |
| RLS policy 生成（如启用） | `GET /api/datasets/:code/rls-policy` 看 SQL          |
| Audit log 写入            | 跑一次写请求 + `GET /api/audit-logs`                 |
| 限流生效                  | curl 重复打到触发 429                                |
| HTTPS 反代                | nginx + 证书；`deploy/nginx.conf`                    |

## 下一步

- 想让 AI Agent 直接调你的业务 → [AI-Native 接入](/concepts/ai-native)
- 想做行级权限 → [ABAC + RLS](/concepts/abac-rls)
- 完整 API → [Instant API 参考](/reference/instant-api)
