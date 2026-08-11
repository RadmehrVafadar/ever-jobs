ALTER TABLE "JobWatch"
  ADD COLUMN "notificationRoutes" JSONB NOT NULL DEFAULT '[]';
