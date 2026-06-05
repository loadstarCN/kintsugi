-- 试用通知去重字段：scheduler 一旦发过 expiring/expired 邮件，就把对应字段
-- 设成发送时间，下个 tick 就不会重复发。
ALTER TABLE "Tenant" ADD COLUMN "trialExpiringNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "trialExpiredNotifiedAt"  TIMESTAMP(3);
