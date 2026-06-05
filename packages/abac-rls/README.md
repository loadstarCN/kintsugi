# @kintsugi/abac-rls ⏸️ v2

属性级权限（ABAC） + 行级安全（RLS）。

## 现状

MVP 的 Proxy Guard（`common/tenant.guard.ts`）仅做 tenantCode 归属校验；RBAC（`modules/rbac`）仅做 `<app>:<resource>:<action>` 级粒度。

## 还没做的部分

**ABAC**：按 `user.department`、`row.createdBy`、`request.ip` 等动态属性决策 permit/deny。用策略引擎（open-policy-agent embedded / casbin）。

**RLS**：把"用户只能看本部门"这样的规则**下压到 SQL**，而不是应用层过滤。Postgres 原生 `CREATE POLICY` 是最优方案：

```sql
CREATE POLICY dept_isolation ON orders
  USING (department_id = current_setting('kintsugi.user_dept')::int);
```

Kintsugi 的 InstantApi 在每次 execute 前 `SET kintsugi.user_dept = ...`。

MySQL 没有原生 RLS → 回退到应用层 extraWhere（InstantApi 里已预留 `extraWhere` 接入点）。

## 起点

- 新 NestJS module `abac-rls`：
  - PolicyEvaluator（casbin.js）
  - RlsInjector：在 `InstantApiService.filter/update/delete` 前把 rls clause 注进 extraWhere
- DO JSON 里加 `dataRule: { scope: "dept"|"self"|"all", field: "..." }` 字段，RlsInjector 读它来决定追加 clause。
