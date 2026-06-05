-- CreateEnum
CREATE TYPE "Edition" AS ENUM ('PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('production', 'daily', 'development');

-- CreateEnum
CREATE TYPE "DialectId" AS ENUM ('postgres', 'mysql', 'mssql', 'oracle', 'sqlite', 'mariadb', 'tidb');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('KintsugiPage', 'KintsugiSearch', 'KintsugiChats', 'KintsugiReport', 'List', 'Form', 'Dashboard', 'ReactSubApp');

-- CreateEnum
CREATE TYPE "BffScriptType" AS ENUM ('BEFORE_HOOK', 'AFTER_HOOK', 'ENDPOINT', 'PUBLIC_FUNCTION');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('pending', 'scanning', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "Tenant" (
    "tenantCode" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "edition" "Edition" NOT NULL DEFAULT 'PRO',
    "aiCredits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxDataSources" INTEGER,
    "maxDatasets" INTEGER,
    "maxDailyLlmCalls" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("tenantCode")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "passwordHash" TEXT NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailedLoginAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "appCode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Application" (
    "appCode" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "Environment" NOT NULL DEFAULT 'development',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("appCode")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "dialect" "DialectId" NOT NULL,
    "displayName" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "database" TEXT NOT NULL,
    "schema" TEXT,
    "username" TEXT NOT NULL,
    "passwordCiphertext" TEXT NOT NULL,
    "sslMode" TEXT,
    "extraParams" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "lastScanStatus" "ScanStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "rawSnapshot" JSONB,
    "inferredModel" JSONB,
    "errorMessage" TEXT,
    "tokensUsed" INTEGER,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "datasetCode" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "schemaName" TEXT,
    "tableName" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "doJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastModifiedBy" TEXT,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("datasetCode")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "type" "PageType" NOT NULL,
    "name" TEXT NOT NULL,
    "routePath" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReactSubApp" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "sourceFiles" JSONB NOT NULL,
    "publishedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReactSubApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "tree" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BffScript" (
    "id" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "scriptName" TEXT NOT NULL,
    "type" "BffScriptType" NOT NULL,
    "boundDataset" TEXT,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastSubmitter" TEXT,
    "lastSubmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BffScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomSql" (
    "sqlCode" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sqlName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "paramsSchema" JSONB,
    "lastSubmitter" TEXT,
    "lastSubmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomSql_pkey" PRIMARY KEY ("sqlCode")
);

-- CreateTable
CREATE TABLE "WebhookSub" (
    "id" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretCipher" TEXT NOT NULL,
    "events" TEXT[],
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "payloadJson" JSONB NOT NULL,
    "lastHttpStatus" INTEGER,
    "lastResponse" TEXT,
    "lastErrorMsg" TEXT,
    "lastDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessKey" (
    "accessKey" TEXT NOT NULL,
    "appCode" TEXT NOT NULL,
    "secretKeyHash" TEXT NOT NULL,
    "prevSecretKeyHash" TEXT,
    "prevValidUntil" TIMESTAMP(3),
    "createdBy" TEXT,
    "boundUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessKey_pkey" PRIMARY KEY ("accessKey")
);

-- CreateTable
CREATE TABLE "AccessKeyNonce" (
    "accessKey" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessKeyNonce_pkey" PRIMARY KEY ("accessKey","nonce")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "appCode" TEXT,
    "userId" TEXT,
    "accessKey" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "traceparent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCreditTx" (
    "id" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "delta" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JwtRevocation" (
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JwtRevocation_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "User_tenantCode_idx" ON "User"("tenantCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantCode_username_key" ON "User"("tenantCode", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantCode_appCode_name_key" ON "Role"("tenantCode", "appCode", "name");

-- CreateIndex
CREATE INDEX "Application_tenantCode_idx" ON "Application"("tenantCode");

-- CreateIndex
CREATE INDEX "DataSource_appCode_idx" ON "DataSource"("appCode");

-- CreateIndex
CREATE INDEX "ScanJob_dataSourceId_idx" ON "ScanJob"("dataSourceId");

-- CreateIndex
CREATE INDEX "Dataset_appCode_idx" ON "Dataset"("appCode");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_appCode_dataSourceId_tableName_key" ON "Dataset"("appCode", "dataSourceId", "tableName");

-- CreateIndex
CREATE INDEX "Page_appCode_idx" ON "Page"("appCode");

-- CreateIndex
CREATE UNIQUE INDEX "ReactSubApp_pageId_key" ON "ReactSubApp"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_appCode_key" ON "Menu"("appCode");

-- CreateIndex
CREATE INDEX "BffScript_appCode_idx" ON "BffScript"("appCode");

-- CreateIndex
CREATE UNIQUE INDEX "BffScript_appCode_scriptName_key" ON "BffScript"("appCode", "scriptName");

-- CreateIndex
CREATE INDEX "CustomSql_appCode_idx" ON "CustomSql"("appCode");

-- CreateIndex
CREATE UNIQUE INDEX "CustomSql_appCode_sqlName_key" ON "CustomSql"("appCode", "sqlName");

-- CreateIndex
CREATE INDEX "WebhookSub_appCode_idx" ON "WebhookSub"("appCode");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subId_createdAt_idx" ON "WebhookDelivery"("subId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AccessKey_appCode_idx" ON "AccessKey"("appCode");

-- CreateIndex
CREATE INDEX "AccessKey_boundUserId_idx" ON "AccessKey"("boundUserId");

-- CreateIndex
CREATE INDEX "AccessKeyNonce_expiresAt_idx" ON "AccessKeyNonce"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantCode_createdAt_idx" ON "AuditLog"("tenantCode", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_accessKey_idx" ON "AuditLog"("accessKey");

-- CreateIndex
CREATE INDEX "AiCreditTx_tenantCode_createdAt_idx" ON "AiCreditTx"("tenantCode", "createdAt");

-- CreateIndex
CREATE INDEX "JwtRevocation_expiresAt_idx" ON "JwtRevocation"("expiresAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantCode_fkey" FOREIGN KEY ("tenantCode") REFERENCES "Tenant"("tenantCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantCode_fkey" FOREIGN KEY ("tenantCode") REFERENCES "Tenant"("tenantCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReactSubApp" ADD CONSTRAINT "ReactSubApp_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BffScript" ADD CONSTRAINT "BffScript_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomSql" ADD CONSTRAINT "CustomSql_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSub" ADD CONSTRAINT "WebhookSub_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subId_fkey" FOREIGN KEY ("subId") REFERENCES "WebhookSub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessKey" ADD CONSTRAINT "AccessKey_appCode_fkey" FOREIGN KEY ("appCode") REFERENCES "Application"("appCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantCode_fkey" FOREIGN KEY ("tenantCode") REFERENCES "Tenant"("tenantCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCreditTx" ADD CONSTRAINT "AiCreditTx_tenantCode_fkey" FOREIGN KEY ("tenantCode") REFERENCES "Tenant"("tenantCode") ON DELETE CASCADE ON UPDATE CASCADE;

