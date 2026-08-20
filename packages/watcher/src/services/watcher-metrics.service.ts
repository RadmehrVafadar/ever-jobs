import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { JobWatch } from "../interfaces/watch.types";

export const COMPANY_COVERAGE_METRIC_STATUSES = [
  "configured",
  "active",
  "disabled",
  "uncovered",
  "initialized",
  "degraded",
] as const;

export type CompanyCoverageMetricStatus =
  (typeof COMPANY_COVERAGE_METRIC_STATUSES)[number];

export type CompanyCoverageMetricCounts = Readonly<
  Record<CompanyCoverageMetricStatus, number>
>;

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
  readonly schedulerCapacity: Gauge;
  readonly targetRunsTotal: Counter;
  readonly targetConsecutiveHardFailures: Gauge;
  readonly targetDegraded: Gauge;
  readonly targetLastSuccess: Gauge;
  readonly targetLastNonEmpty: Gauge;
  readonly tier1CoverageDegraded: Gauge;
  readonly companyCoverage: Gauge;

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
      help: "Source publication to first rad.ar detection latency.",
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
    this.schedulerCapacity = new Gauge({
      name: "ever_jobs_watcher_scheduler_capacity",
      help: "Maximum concurrent scheduled watch runs in this process.",
      registers: [this.registry],
    });
    this.targetRunsTotal = new Counter({
      name: "ever_jobs_watcher_target_runs_total",
      help: "Watcher target runs by durable outcome.",
      labelNames: ["watch", "target", "tier", "outcome"],
      registers: [this.registry],
    });
    this.targetConsecutiveHardFailures = new Gauge({
      name: "ever_jobs_watcher_target_consecutive_hard_failures",
      help: "Current consecutive hard failures for a watch target.",
      labelNames: ["watch", "target", "tier"],
      registers: [this.registry],
    });
    this.targetDegraded = new Gauge({
      name: "ever_jobs_watcher_target_degraded",
      help: "Whether a watch target is degraded (1) or healthy (0).",
      labelNames: ["watch", "target", "tier"],
      registers: [this.registry],
    });
    this.targetLastSuccess = new Gauge({
      name: "ever_jobs_watcher_target_last_success_timestamp_seconds",
      help: "Unix timestamp of the latest fully successful target run.",
      labelNames: ["watch", "target", "tier"],
      registers: [this.registry],
    });
    this.targetLastNonEmpty = new Gauge({
      name: "ever_jobs_watcher_target_last_non_empty_timestamp_seconds",
      help: "Unix timestamp of the latest target run that returned jobs.",
      labelNames: ["watch", "target", "tier"],
      registers: [this.registry],
    });
    this.tier1CoverageDegraded = new Gauge({
      name: "ever_jobs_watcher_tier1_coverage_degraded",
      help: "Whether any enabled Tier 1 target in a watch is degraded.",
      labelNames: ["watch"],
      registers: [this.registry],
    });
    this.companyCoverage = new Gauge({
      name: "ever_jobs_watcher_company_coverage",
      help: "Configured company coverage counts by watch and coverage status.",
      labelNames: ["watch_id", "status"],
      registers: [this.registry],
    });
  }

  observeTargetResult(
    watchId: string,
    result: {
      targetKey: string;
      tier: number;
      outcome: string;
      consecutiveHardFailures: number;
      degraded: boolean;
      lastSuccessAt?: Date | null;
      lastNonEmptyAt?: Date | null;
    },
  ): void {
    const labels = {
      watch: watchId,
      target: result.targetKey,
      tier: String(result.tier),
    };
    this.targetRunsTotal.inc({ ...labels, outcome: result.outcome });
    this.targetConsecutiveHardFailures.set(
      labels,
      result.consecutiveHardFailures,
    );
    this.targetDegraded.set(labels, result.degraded ? 1 : 0);
    if (result.lastSuccessAt) {
      this.targetLastSuccess.set(
        labels,
        result.lastSuccessAt.getTime() / 1_000,
      );
    }
    if (result.lastNonEmptyAt) {
      this.targetLastNonEmpty.set(
        labels,
        result.lastNonEmptyAt.getTime() / 1_000,
      );
    }
  }

  setTier1CoverageDegraded(watchId: string, degraded: boolean): void {
    this.tier1CoverageDegraded.set({ watch: watchId }, degraded ? 1 : 0);
  }

  /**
   * Publishes an already-computed company coverage summary. Coverage policy
   * stays with the reporting service; this metrics service only exports the
   * supplied counts under a bounded set of status labels.
   */
  setCompanyCoverage(
    watchId: string,
    counts: CompanyCoverageMetricCounts,
  ): void {
    for (const status of COMPANY_COVERAGE_METRIC_STATUSES) {
      this.companyCoverage.set({ watch_id: watchId, status }, counts[status]);
    }
  }

  /** Replace all company coverage gauges from the current durable watch set. */
  syncCompanyCoverage(
    reports: ReadonlyArray<{
      watchId: string;
      counts: CompanyCoverageMetricCounts;
    }>,
  ): void {
    this.companyCoverage.reset();
    for (const report of reports) {
      this.setCompanyCoverage(report.watchId, report.counts);
    }
  }

  /** Rehydrates current-state gauges from durable watch state after restarts. */
  syncTargetHealth(watches: readonly JobWatch[]): void {
    this.targetConsecutiveHardFailures.reset();
    this.targetDegraded.reset();
    this.targetLastSuccess.reset();
    this.targetLastNonEmpty.reset();
    this.tier1CoverageDegraded.reset();

    for (const watch of watches) {
      const activeTierOneKeys = new Set<string>(
        watch.sourceTargets.length > 0
          ? watch.sourceTargets
              .filter((target) => target.enabled && target.tier === 1)
              .map((target) =>
                target.companySlug
                  ? `${String(target.site)}:${target.companySlug}`
                  : String(target.site),
              )
          : Object.values(watch.targetHealth ?? {})
              .filter((health) => health.tier === 1)
              .map((health) => health.targetKey),
      );
      let coverageDegraded = false;
      for (const health of Object.values(watch.targetHealth ?? {})) {
        const labels = {
          watch: watch.id,
          target: health.targetKey,
          tier: String(health.tier),
        };
        const degraded =
          health.tier === 1 && health.consecutiveHardFailures >= 3;
        this.targetConsecutiveHardFailures.set(
          labels,
          health.consecutiveHardFailures,
        );
        this.targetDegraded.set(labels, degraded ? 1 : 0);
        if (health.lastSuccessAt) {
          this.targetLastSuccess.set(
            labels,
            health.lastSuccessAt.getTime() / 1_000,
          );
        }
        if (health.lastNonEmptyAt) {
          this.targetLastNonEmpty.set(
            labels,
            health.lastNonEmptyAt.getTime() / 1_000,
          );
        }
        if (degraded && activeTierOneKeys.has(health.targetKey)) {
          coverageDegraded = true;
        }
      }
      this.setTier1CoverageDegraded(watch.id, coverageDegraded);
    }
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
