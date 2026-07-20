ALTER TABLE "JobWatch"
  ADD COLUMN "targetHealth" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "ObservedJob"
  ADD COLUMN "sourceTargetKey" TEXT,
  ADD COLUMN "locations" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "canonicalKey" TEXT,
  ADD COLUMN "canonicalEpisodeKey" TEXT,
  ADD COLUMN "canonicalEpisodeStartedAt" TIMESTAMP(3);

ALTER TABLE "WatchMatch"
  ADD COLUMN "canonicalEpisodeKey" TEXT,
  ADD COLUMN "sourceTargetKey" TEXT,
  ADD COLUMN "notificationSuppressionReason" TEXT;

ALTER TABLE "WatchRun"
  ADD COLUMN "targetResults" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "coverageDegraded" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ObservedJob_sourceTargetKey_idx"
  ON "ObservedJob"("sourceTargetKey");
CREATE INDEX "ObservedJob_canonicalKey_lastSeenAt_idx"
  ON "ObservedJob"("canonicalKey", "lastSeenAt");
CREATE INDEX "ObservedJob_canonicalEpisodeKey_idx"
  ON "ObservedJob"("canonicalEpisodeKey");
CREATE INDEX "ObservedJob_canonicalKey_canonicalEpisodeStartedAt_idx"
  ON "ObservedJob"("canonicalKey", "canonicalEpisodeStartedAt");
CREATE UNIQUE INDEX "WatchMatch_watchId_canonicalEpisodeKey_key"
  ON "WatchMatch"("watchId", "canonicalEpisodeKey");
