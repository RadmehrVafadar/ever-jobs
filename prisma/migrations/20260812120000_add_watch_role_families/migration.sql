ALTER TABLE "JobWatch"
  ADD COLUMN "roleFamilies" JSONB NOT NULL DEFAULT '["software-engineering","data-ai","cybersecurity","cloud-platform-infrastructure"]';
