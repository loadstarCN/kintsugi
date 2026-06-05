-- 付费订阅相关字段 + UpgradeRequest 表
-- 与试用过期同款"通知去重"模式：notifiedAt 字段下个 billing cycle 由
-- approveUpgrade 重置为 null（让下次到期再次触发提醒）。

-- 1) Tenant 加付费订阅状态
ALTER TABLE "Tenant" ADD COLUMN "currentPlanCode"             TEXT;
ALTER TABLE "Tenant" ADD COLUMN "subscriptionExpiresAt"       TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "autoRenew"                   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "subscriptionExpiringNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "subscriptionExpiredNotifiedAt"  TIMESTAMP(3);

-- 2) UpgradeRequest 状态枚举
CREATE TYPE "UpgradeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 3) UpgradeRequest 表
CREATE TABLE "UpgradeRequest" (
    "id"                      TEXT                  NOT NULL,
    "tenantCode"              TEXT                  NOT NULL,
    "requestedPlanCode"       TEXT                  NOT NULL,
    "requestedDurationMonths" INTEGER               NOT NULL,
    "contactName"             TEXT                  NOT NULL,
    "contactEmail"            TEXT                  NOT NULL,
    "phone"                   TEXT,
    "note"                    TEXT,
    "status"                  "UpgradeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy"              TEXT,
    "reviewNote"              TEXT,
    "reviewedAt"              TIMESTAMP(3),
    "approvedExpiresAt"       TIMESTAMP(3),
    "createdAt"               TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UpgradeRequest_status_createdAt_idx" ON "UpgradeRequest"("status", "createdAt");
CREATE INDEX "UpgradeRequest_tenantCode_status_idx" ON "UpgradeRequest"("tenantCode", "status");

ALTER TABLE "UpgradeRequest"
  ADD CONSTRAINT "UpgradeRequest_tenantCode_fkey"
  FOREIGN KEY ("tenantCode") REFERENCES "Tenant"("tenantCode")
  ON DELETE CASCADE ON UPDATE CASCADE;
