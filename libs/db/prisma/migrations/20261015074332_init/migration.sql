-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('SELF_HOST', 'STARTER', 'PRO', 'SCALE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('DOUYIN', 'XIAOHONGSHU', 'WECHAT_MP', 'WEIBO');

-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('BROWSER', 'OFFICIAL_API');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'EXPIRED', 'NEEDS_REAUTH', 'DISABLED', 'BANNED');

-- CreateEnum
CREATE TYPE "CredentialKind" AS ENUM ('STORAGE_STATE', 'OAUTH_TOKEN');

-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('IMAGE_TEXT', 'VIDEO');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "AggregateState" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIAL', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('COVER', 'IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'READY', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('DRAFT_THEN_CONFIRM', 'DIRECT');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('PENDING', 'LEASED', 'RUNNING', 'AWAITING_CONFIRM', 'AWAITING_HUMAN', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReconcileStatus" AS ENUM ('PENDING', 'PRESENT', 'ABSENT', 'REJECTED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'LEASED', 'RUNNING', 'AWAITING_HUMAN', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoginStatus" AS ENUM ('CREATED', 'DISPATCHED', 'QR_READY', 'SCANNED', 'AWAITING_HUMAN', 'CONFIRMED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExecutorStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DRAINING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'SELF_HOST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL DEFAULT 'DOUYIN',
    "authMode" "AuthMode" NOT NULL DEFAULT 'BROWSER',
    "externalId" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "lastHealthOkAt" TIMESTAMP(3),
    "healthError" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "CredentialKind" NOT NULL DEFAULT 'STORAGE_STATE',
    "ciphertext" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "PostKind" NOT NULL DEFAULT 'IMAGE_TEXT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "state" "AggregateState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT,
    "role" "MediaRole" NOT NULL DEFAULT 'IMAGE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" "PublishMode" NOT NULL DEFAULT 'DRAFT_THEN_CONFIRM',
    "status" "TargetStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "reconcileStatus" "ReconcileStatus" NOT NULL DEFAULT 'PENDING',
    "reconcileAt" TIMESTAMP(3),
    "failCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishRun" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "executorId" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" "PublishMode" NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "artifacts" JSONB NOT NULL DEFAULT '[]',
    "eventsLog" JSONB NOT NULL DEFAULT '[]',
    "matchedWork" JSONB,
    "draftRef" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT,
    "provider" "Provider" NOT NULL,
    "status" "LoginStatus" NOT NULL DEFAULT 'CREATED',
    "executorId" TEXT,
    "qrImageKey" TEXT,
    "qrUpdatedAt" TIMESTAMP(3),
    "hint" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Executor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "selectorsVersion" TEXT,
    "status" "ExecutorStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Executor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_orgId_key" ON "Membership"("userId", "orgId");

-- CreateIndex
CREATE INDEX "PlatformAccount_organizationId_status_idx" ON "PlatformAccount"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_organizationId_provider_externalId_key" ON "PlatformAccount"("organizationId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCredential_accountId_key" ON "AccountCredential"("accountId");

-- CreateIndex
CREATE INDEX "Post_organizationId_state_idx" ON "Post"("organizationId", "state");

-- CreateIndex
CREATE INDEX "PostTarget_status_scheduledAt_idx" ON "PostTarget"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostTarget_postId_accountId_key" ON "PostTarget"("postId", "accountId");

-- CreateIndex
CREATE INDEX "PublishRun_status_leaseExpiresAt_idx" ON "PublishRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishRun_targetId_attemptNo_key" ON "PublishRun"("targetId", "attemptNo");

-- CreateIndex
CREATE INDEX "Executor_organizationId_status_idx" ON "Executor"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCredential" ADD CONSTRAINT "AccountCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishRun" ADD CONSTRAINT "PublishRun_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginSession" ADD CONSTRAINT "LoginSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Executor" ADD CONSTRAINT "Executor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
