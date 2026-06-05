# Trial Application 模块

商业系统的"申请审批 → 平台方建账户"流程。**关闭公开 register**，新租户必须走这条路或 admin 直建 Tenant。

## 流程

```
申请人填表             平台方 audit              auto build
  ↓                       ↓                        ↓
POST /api/trial/apply → /api/admin/trials → POST :id/approve
  (Public)              (admin:read)         (admin:write)
                                                 ↓
                                            TRIAL Tenant + admin User
                                            trialExpiresAt = NOW + 14d
                                            quota: 1 ds / 3 datasets / 50 LLM/day / 5 元
```

## 试用限制

| 维度           | 默认  | env                         |
| -------------- | ----- | --------------------------- |
| 期限           | 14 天 | `TRIAL_DAYS`                |
| 数据源         | 1 个  | `TRIAL_MAX_DATASOURCES`     |
| 数据集         | 3 个  | `TRIAL_MAX_DATASETS`        |
| LLM 调用/天    | 50 次 | `TRIAL_MAX_DAILY_LLM_CALLS` |
| 初始 AI credit | 5 元  | `TRIAL_AI_CREDIT_INIT`      |

到期后 `AuthService.login` 返 `FORBIDDEN`，账户拒登。需要：

- 升级 Tenant.edition 为 PRO（在 RDS 执行 SQL）
- 充 AI credit
- 移除 quota 限制（设 maxXxx = NULL）

## admin 审批 UI 还没建，临时手动方法

### 1. 列待审申请（用 psql）

```sql
SELECT id, "contactName", email, company, "useCase", "createdAt"
FROM "TrialApplication"
WHERE status = 'PENDING'
ORDER BY "createdAt" ASC;
```

### 2. 通过申请（后续会有 admin UI，现在用 API）

需要：(a) 一个有 `admin:write` grant 的管理员 user 拿 JWT；(b) 决定 tenantCode + tenantName + 临时密码。

```bash
# 临时密码生成：
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"

# 调 approve API
curl -X POST https://kintsugi.example.com/api/admin/trials/<APPLICATION_ID>/approve \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "tenantCode": "acme",
    "tenantName": "Acme Co.",
    "username": "admin",
    "password": "<TEMP_PASSWORD>",
    "note": "已电话核实"
  }'
```

返回 `{ tenantCode, userId }`。**手动通知申请人**（邮件 / 钉钉）：

- baseUrl = https://kintsugi.example.com
- tenantCode = acme
- 用户名 = admin
- 一次性临时密码 = `<TEMP_PASSWORD>`（首次登录后立即修改）
- 试用期到 NOW+14d
- quota = 1ds / 3datasets / 50 LLM/day

### 3. 拒绝申请

```bash
curl -X POST https://kintsugi.example.com/api/admin/trials/<APPLICATION_ID>/reject \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"note": "资质不符 / 已联系客户说明"}'
```

### 4. 给现有 user 加 admin role

如果还没有 `admin:write` 用户，临时用 SQL：

```sql
-- 假设已有 user.id = <UID>，给他建 admin role 并绑定
INSERT INTO "Role" (id, "tenantCode", "appCode", name, permissions, "updatedAt")
VALUES (
  'r-platform-admin',
  '<your-platform-tenant>',
  NULL,
  'admin',
  '{"grants":["*:*:*"]}'::jsonb,
  NOW()
);

INSERT INTO "UserRole" ("userId", "roleId")
VALUES ('<UID>', 'r-platform-admin');
```

`*:*:*` wildcard 在 RbacService 里展开匹配所有 permission key。

## 试用账户升级到 PRO

```sql
UPDATE "Tenant"
SET edition = 'PRO',
    "trialExpiresAt" = NULL,
    "maxDataSources" = NULL,    -- 解除 quota
    "maxDatasets" = NULL,
    "maxDailyLlmCalls" = NULL,
    "aiCredits" = "aiCredits" + <topup_amount>
WHERE "tenantCode" = '<TENANT_CODE>';
```

## 监控

- `[trial-apply]` warn-log：新申请到达
- `[trial-approve]` warn-log：审批通过
- `[trial-reject]` warn-log：审批拒绝
- 后续应加 OTel counter `kintsugi_trial_application_total{status}`
