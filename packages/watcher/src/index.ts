export * from "./watcher.module";
export * from "./interfaces/watch.types";
export * from "./services/job-fingerprint.service";
export * from "./services/geography-classification.service";
export * from "./services/job-scoring.service";
export * from "./services/watch-execution.service";
export * from "./services/daily-digest.service";
export * from "./services/default-watch";
export * from "./services/default-watch-seeder.service";
export * from "./services/canadian-tech-internships.preset";
export * from "./services/canadian-tech-adjacent-internships.preset";
export * from "./services/prestige-internships-v2.preset";
export * from "./services/watch-preset.service";
export * from "./services/company-coverage.service";
export * from "./services/notification-dispatcher.service";
export * from "./services/notification-routing.service";
export * from "./services/discord-notification.provider";
export * from "./services/webhook-notification.provider";
export * from "./services/jobs-service-watch.executor";
export {
  WATCH_SOURCE_TIER_INTERVAL_MINUTES,
  WatchSourcePlanner,
} from "./services/watch-source-planner.service";
export type {
  WatchSourceKind,
  WatchSourceMetadata,
  WatchSourcePlan,
  WatchSourcePlanIssue,
  WatchSourcePlanIssueCode,
  WatchSourcePlanOptions,
  WatchSourceRequest,
  WatchSourceTarget as PlannedWatchSourceTarget,
  WatchSourceTier,
} from "./services/watch-source-planner.service";
export * from "./services/watch-validation.service";
export * from "./services/watcher-metrics.service";
export * from "./services/watcher-scheduler.service";
export * from "./persistence/in-memory-watch.repository";
export * from "./persistence/prisma-watch.repository";
export * from "./persistence/watcher-prisma.service";
