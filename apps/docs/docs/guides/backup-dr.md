# 备份与灾难恢复（Aliyun RDS + OSS）

部署方式不走 Docker。元数据库是托管 PostgreSQL，对象存储是 OSS。本文写给 oncall：
**真出事了能 30 分钟内做出第一步动作**。

> 写完后请按"演练一次再下班"原则做一次 dry run。备份没演练 = 没备份。

---

## 一句话恢复策略

| 故障                   | RTO    | RPO     | 第一步                                            |
| ---------------------- | ------ | ------- | ------------------------------------------------- |
| 误删 dataset / page 行 | 5 min  | 0       | RDS PITR 拉副本 → 业务库导回                      |
| RDS 实例挂             | 30 min | < 1 min | 从备份新建实例 → 切 DSN                           |
| 整 region 不可用       | 4 h    | < 5 min | 跨 region 备份 + 冷启 server 群                   |
| 核心 secret 泄漏       | 10 min | 0       | rotate JWT_SECRET / KMS DEK + 失效全部 access key |

---

## 1. RDS（元数据库）

### 自动备份

托管 PostgreSQL 实例后台默认每天一次全量 + 持续 WAL 归档，**保留 7 天**。
检查路径：**RDS 控制台 → 备份恢复 → 备份策略**。

oncall 需做：

- 把保留期改到 **30 天**（合规审计要求）；
- 打开**跨 region 备份**到至少一个异地 region（通常是 `cn-shanghai` 主 + `cn-beijing` 备）；
- 给 oncall 钉钉机器人加"备份失败 / 备份延迟 > 24h"告警。

### 临时恢复（PITR）

误删一行、误 update 一批数据时**不要直接还原主库**——会回滚生产其他流量。流程：

1. RDS 控制台 → 备份恢复 → **按时间点克隆实例**（1-2 min 内即可生效到目标时间）
2. 选恢复时间 = 故障**之前 30 秒**
3. 拿到新实例 DSN，本地用 `pg_dump --table=<被删表>` 导出受影响行
4. 在生产库里 `INSERT ... ON CONFLICT DO NOTHING` 导回
5. 临时实例用完即销毁

> kintsugi 自身的 audit_log 通常已经记了 `afterJson`（写前镜像也有，用 `beforeJson` 字段）。
> 90% 的"误删一行"可以**直接从 audit_log 恢复**，不必拉 PITR 副本。先查 audit。

### 实例挂 / 全部恢复

1. **冻结写流量**：把 nginx 上游全部摘掉（`deploy/nginx.conf` 里把 server pool 注释）
2. RDS 控制台 → **从备份新建实例**，等 5-10 min
3. 把新实例 endpoint 写到 `.env` 的 `METADATA_DATABASE_URL`（注意 `?sslmode=disable` 别忘）
4. 恢复出来的库已含全部 schema（备份是 logical dump）。先 baseline 让 prisma 知道起点，再跑后续未应用的 migration：
   `pnpm --filter @kintsugi/server prisma:resolve-baseline && pnpm --filter @kintsugi/server prisma:deploy`
5. nginx 上游恢复，看 `pm2 logs server` 确认 `[Nest] Application started` 出现
6. `curl /api/health` 必须返回 `{"status":"ok"}`

---

## 2. 客户业务数据库（用户连进来的 DataSource）

**不是我们的责任范围**——我们只 read（DBAgent scan）和 read/write（Instant API）他们自己的 RDS。
但出事时仍可能背锅。Runbook：

- 把"客户应自行做 RDS 备份"写进 onboarding 邮件
- 我们存的 `Datasource.connectionString` 是 AES-GCM 加密的（v1，每条 record 自带 salt）；
  解密 key 在 `.env` 的 `KINTSUGI_CRYPTO_KEY`（32 字节 hex）；丢了 = 全部 datasource 必须由用户重新填密码

---

## 3. 用户上传的文件（OSS）

- bucket：`kintsugi-prod-uploads`（dataset 导入 / page assets）
- 默认开**版本化**（OSS 控制台 → 基础设置 → 版本控制 → 开启），误删可还原 30 天
- 跨 region 复制到 `kintsugi-dr-uploads`（控制台 → 数据复制 → 跨区域复制）
- 凭据：service 用 RAM 子账号 `kintsugi-server-prod`，权限只到这两个 bucket，**不要**给 `oss:DeleteObject` 之外的危险权限
  到 server 的 root 账号

---

## 4. Server 进程（无状态）

server 进程本身**完全无状态**——挂了 pm2 自动拉起，DSN 在 `.env`，重启即恢复。

唯二需要保留的本机文件：

- `.env`：放在 server 机器的 `/opt/kintsugi/.env`，权限 `0600`，**不要**进 git；改完同步到所有节点
- nginx config：`deploy/nginx.conf` 是 source-of-truth，机器上的 `/etc/nginx/conf.d/kintsugi.conf` 是它的拷贝

灾备机做法：另起一台 ECS，把仓库 + `.env` 拷过去，`pnpm install && pnpm --filter @kintsugi/server build && pm2 start ecosystem.config.js`，
nginx upstream 切过去就完事。

---

## 5. 密钥事故响应

**时间窗目标：从知道泄漏到所有受影响 token 失效 ≤ 10 分钟。**

| 泄漏的东西                      | 立即动作                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                    | 改 `.env` → 重启 server → 所有现存 JWT 立即 401（用户被迫重登）                                                  |
| `KINTSUGI_CRYPTO_KEY`           | 走 versioned ciphertext 平滑迁移：先加新 key，先解密用旧 key、写入用新 key；下发后台 rotate job 重写所有 v0 → v1 |
| Access key（单条）              | `DELETE /api/access-keys/:accessKey` 立即失效                                                                    |
| 所有 access key（怀疑批量泄漏） | `UPDATE "AccessKey" SET "revokedAt" = NOW()`（直连 RDS 跑 SQL）                                                  |
| `DEEPSEEK_API_KEY` 等 LLM 凭据  | 在 provider 控制台 rotate；`.env` 改完 server 重启；查近 24h `LlmCallLog` 是否被异常调用                         |
| Aliyun OSS RAM AK/SK            | RAM 控制台禁用旧 AK → 新建一对 → 改 `.env` → 重启                                                                |

每条都需要在 `audit_log` 里手工写一条 `action='security.incident.rotate.<key>'`，
便于事后审计回溯（`AuditService.list` + 按 traceparent 检索）。

---

## 6. 演练清单（每季度跑一次）

- [ ] PITR 克隆一个新实例（不切流量），验证目标时间点的某条 audit_log 行存在
- [ ] 从 OSS dr-bucket 拉一个老版本对象到本地，校验 ETag
- [ ] 在 staging rotate `JWT_SECRET`，确认所有 staging 客户端被踢
- [ ] `pnpm --filter @kintsugi/server bcrypt:cleanup` dry-run（access key 反向退化场景）
- [ ] 给一台 server 机器拔网线 5 分钟，看 pm2 + nginx 是否正确摘掉它

演练记录请落到内部 wiki 的"DR 演练日志"页面，**只有演练过的步骤才算这份文档生效**。
