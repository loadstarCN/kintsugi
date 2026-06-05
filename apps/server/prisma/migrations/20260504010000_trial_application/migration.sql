-- Round 10: 试用账户 + 申请使用流程

-- 1. Edition 加 TRIAL 值
ALTER TYPE "Edition" ADD VALUE IF NOT EXISTS 'TRIAL' BEFORE 'PRO';

-- 2. TrialStatus enum
DO $$ BEGIN
  CREATE TYPE "TrialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Tenant 加 trialExpiresAt
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "trialExpiresAt" TIMESTAMP(3);

-- 4. TrialApplication 表
CREATE TABLE IF NOT EXISTS "TrialApplication" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "useCase" TEXT,
    "status" "TrialStatus" NOT NULL DEFAULT 'PENDING',
    "approvedTenantCode" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "TrialApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TrialApplication_status_createdAt_idx" ON "TrialApplication"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "TrialApplication_email_idx" ON "TrialApplication"("email");
