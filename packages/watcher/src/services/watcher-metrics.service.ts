import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Metrics owned by the watcher worker. A private registry prevents duplicate
 * metric registration when WatcherModule is imported by both the API and CLI.
 */
@Injectable()
export class WatcherMetricsService {
  readonly registry = new Registry();
  readonly runsTotal: Counter;
  readonly sourceRequestsTotal: Counter;
  readonly jobsFetchedTotal: Counter;
  readonly newJobsTotal: Counter;
  readonly matchesTotal: Counter;
  readonly notificationsTotal: Counter;
  readonly duplicatesTotal: Counter;
  readonly runDuration: Histogram;
  readonly sourceDuration: Histogram;
  readonly detectionLatency: Histogram;
  readonly notificationLatency: Histogram;
  readonly schedulerLastPoll: Gauge;
  readonly schedulerActiveRuns: Gauge;

  constructor() {
    this.runsTotal = new Counter({
      name: "ever_jobs_watcher_runs_total",
      help: "Watcher runs by terminal status.",
      labelNames: ["status"],
      registers: [this.registry],
    });
    this.sourceRequestsTotal = new Counter({
      name: "ever_jobs_watcher_source_requests_total",
      help: "Watcher source executions by source and status.",
      labelNames: ["source", "status"],
      registers: [this.registry],
    });
    this.jobsFetchedTotal = new Counter({
      name: "ever_jobs_watcher_jobs_fetched_total",
      help: "Jobs fetched by watcher source executions.",
      labelNames: ["source"],
      registers: [this.registry],
    });
    this.newJobsTotal = new Counter({
      name: "ever_jobs_watcher_new_jobs_total",
      help: "New observed jobs persisted by the watcher.",
      registers: [this.registry],
    });
    this.matchesTotal = new Counter({
      name: "ever_jobs_watcher_matches_total",
      help: "New watch matches persisted by score band.",
      labelNames: ["band"],
      registers: [this.registry],
    });
    this.notificationsTotal = new Counter({
      name: "ever_jobs_watcher_notifications_total",
      help: "Watcher notification deliveries by provider and status.",
      labelNames: ["provider", "status"],
      registers: [this.registry],
    });
    this.duplicatesTotal = new Counter({
      name: "ever_jobs_watcher_duplicates_suppressed_total",
      help: "Duplicate observations or deliveries suppressed.",
      labelNames: ["kind"],
      registers: [this.registry],
    });
    this.runDuration = new Histogram({
      name: "ever_jobs_watcher_run_duration_seconds",
      help: "End-to-end watch run duration.",
      buckets: [1, 5, 15, 30, 60, 120, 180, 300],
      registers: [this.registry],
    });
    this.sourceDuration = new Histogram({
      name: "ever_jobs_watcher_source_duration_seconds",
      help: "Per-source watcher request duration.",
      labelNames: ["source"],
      buckets: [0.25, 1, 3, 5, 10, 12, 30, 60],
      registers: [this.registry],
    });
    this.detectionLatency = new Histogram({
      name: "ever_jobs_watcher_detection_latency_seconds",
      help: "Source publication to first Ever Jobs detection latency.",
      buckets: [30, 60, 180, 300, 900, 3600, 21600, 86400],
      registers: [this.registry],
    });
    this.notificationLatency = new Histogram({
      name: "ever_jobs_watcher_notification_latency_seconds",
      help: "First detection to successful notification latency.",
      buckets: [1, 5, 15, 30, 60, 180, 300, 900],
      registers: [this.registry],
    });
    this.schedulerLastPoll = new Gauge({
      name: "ever_jobs_watcher_scheduler_last_poll_timestamp_seconds",
      help: "Unix timestamp of the most recent completed scheduler poll.",
      registers: [this.registry],
    });
    this.schedulerActiveRuns = new Gauge({
      name: "ever_jobs_watcher_scheduler_active_runs",
      help: "Number of watch runs active in this process.",
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
