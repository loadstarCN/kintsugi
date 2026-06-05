-- 防 trial apply dedup race：
-- TrialService.apply 之前用 findFirst + create 两步检查重复 PENDING；
-- 两个并发请求会都过 dedup check 都成功 insert。
-- 加 PG partial unique index → DB 层强制：(email) where status='PENDING' 唯一。
-- 第二个并发 insert 直接 P2002，service catch 转 CONFLICT。
--
-- 不影响已 APPROVED / REJECTED 的旧记录（partial 谓词 status='PENDING' 排除它们）。

CREATE UNIQUE INDEX IF NOT EXISTS "TrialApplication_email_pending_unique"
ON "TrialApplication" ("email") WHERE status = 'PENDING';
