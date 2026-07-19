ALTER TABLE "JobWatch"
  ADD COLUMN "sourceTargets" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "recentWindowMinutes" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN "weights" JSONB,
  ADD COLUMN "leaseOwnerId" TEXT,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "NotificationDelivery"
  ADD COLUMN "notificationType" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "destinationRef" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "claimOwnerId" TEXT,
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "claimExpiresAt" TIMESTAMP(3);

ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "attemptCount" SET DEFAULT 0;

CREATE INDEX "JobWatch_enabled_nextRunAt_leaseExpiresAt_idx"
  ON "JobWatch"("enabled", "nextRunAt", "leaseExpiresAt");
CREATE INDEX "JobWatch_leaseToken_idx" ON "JobWatch"("leaseToken");
CREATE INDEX "ObservedJob_firstSeenAt_idx" ON "ObservedJob"("firstSeenAt");
CREATE INDEX "WatchMatch_firstMatchedAt_idx" ON "WatchMatch"("firstMatchedAt");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_claimExpiresAt_idx"
  ON "NotificationDelivery"("status", "nextAttemptAt", "claimExpiresAt");
CREATE INDEX "NotificationDelivery_claimToken_idx"
  ON "NotificationDelivery"("claimToken");
CREATE INDEX "NotificationDelivery_createdAt_idx"
  ON "NotificationDelivery"("createdAt");
