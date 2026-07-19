import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { JobPostDto } from "@ever-jobs/models";
import {
  JobWatch,
  ObservedJob,
  ScoreBreakdown,
  WATCH_REPOSITORY,
  WatchInitializationMode,
  WatchRepository,
  WatchRun,
} from "../interfaces/watch.types";
import { JobFingerprintService } from "./job-fingerprint.service";
import { JobScoringService } from "./job-scoring.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import {
  ExecuteWatchSourcesInput,
  JobsServiceWatchExecutor,
  WatchSourcesExecutionResult,
} from "./jobs-service-watch.executor";
import { WatcherMetricsService } from "./watcher-metrics.service";

export const WATCH_SOURCE_EXECUTOR = Symbol("WATCH_SOURCE_EXECUTOR");
export const WATCH_EXECUTION_OPTIONS = Symbol("WATCH_EXECUTION_OPTIONS");

export interface WatchExecutionOptions {
  ownerId: string;
  leaseTtlMs: number;
  now: () => Date;
}

export interface RunWatchOptions {
  trigger?: "scheduled" | "manual" | "initialize";
  requireDue?: boolean;
  forceSources?: boolean;
}

const DEFAULT_OPTIONS: WatchExecutionOptions = {
  ownerId: `watcher-${process.pid}-${randomUUID()}`,
  leaseTtlMs: 180_000,
  now: () => new Date(),
};

@Injectable()
export class WatchExecutionService {
  private readonly logger = new Logger(WatchExecutionService.name);
  private readonly options: WatchExecutionOptions;

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    private readonly fingerprintService: JobFingerprintService,
    private readonly scoring: JobScoringService,
    private readonly notifications: NotificationDispatcher,
    @Inject(WATCH_SOURCE_EXECUTOR)
    private readonly executor: JobsServiceWatchExecutor,
    @Optional() private readonly metrics?: WatcherMetricsService,
    @Optional()
    @Inject(WATCH_EXECUTION_OPTIONS)
    options: Partial<WatchExecutionOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async runWatch(
    watchId: string,
    mode?: WatchInitializationMode,
    runOptions: RunWatchOptions = {},
  ): Promise<WatchRun> {
    const watch = await this.repo.getWatch(watchId);
    if (!watch) throw new NotFoundException(`Watch not found: ${watchId}`);

    const startedAt = this.options.now();
    const leaseToken = randomUUID();
    const lease = await this.repo.tryAcquireWatchLease({
      watchId,
      ownerId: this.options.ownerId,
      token: leaseToken,
      now: startedAt,
      expiresAt: new Date(startedAt.getTime() + this.options.leaseTtlMs),
      nextRunAt: new Date(startedAt.getTime() + watch.intervalMinutes * 60_000),
      requireDue: runOptions.requireDue ?? false,
    });
    if (!lease) {
      throw new ConflictException(
        `Watch is already running or is not due: ${watchId}`,
      );
    }

    const heartbeat = setInterval(
      () => {
        const now = this.options.now();
        void this.repo
          .renewWatchLease({
            watchId,
            ownerId: this.options.ownerId,
            token: leaseToken,
            now,
            expiresAt: new Date(now.getTime() + this.options.leaseTtlMs),
          })
          .catch((error: unknown) => {
            this.logger.error(
              `Watch lease heartbeat failed watchId=${watchId}: ${safeError(error)}`,
            );
          });
      },
      Math.max(1_000, Math.floor(this.options.leaseTtlMs / 3)),
    );
    heartbeat.unref?.();

    let run: WatchRun | null = null;
    const effectiveMode =
      mode ?? (watch.initializedAt ? undefined : watch.initializationMode);
    try {
      run = await this.repo.createRun({
        watchId,
        startedAt,
        sourcesRequested: watch.sources,
      });
      const sourceResult = await this.executeSources({
        watch,
        now: startedAt,
        lastRunAt: watch.lastRunAt,
        force: runOptions.forceSources ?? runOptions.trigger !== "scheduled",
      });
      const normalizationFailures: string[] = [];
      const uniqueJobs = this.uniqueJobs(
        sourceResult.jobs,
        normalizationFailures,
      );

      let newJobsDetected = 0;
      let matchesCreated = 0;
      let notificationsSent = 0;
      let jobsNormalized = 0;

      for (const job of uniqueJobs) {
        try {
          if (typeof job.title !== "string" || !job.title.trim()) continue;
          jobsNormalized += 1;
          const breakdown = this.scoring.score(job, watch);
          const observedInput = this.toObserved(job, this.options.now());
          const notificationState = this.initialNotificationState(
            effectiveMode,
            breakdown,
            watch,
          );
          const persisted = await this.repo.persistObservationAndMatch({
            observedJob: observedInput,
            match: {
              watchId,
              score: breakdown.total,
              scoreBreakdown: breakdown,
              matchedTerms: breakdown.matchedKeywords,
              excludedReason: breakdown.exclusionReason,
              status: "new",
              firstMatchedAt: this.options.now(),
              lastMatchedAt: this.options.now(),
              notificationState,
            },
          });

          if (persisted.isNewJob) {
            newJobsDetected += 1;
            this.metrics?.newJobsTotal.inc();
          } else {
            this.metrics?.duplicatesTotal.inc({ kind: "observation" });
          }
          if (persisted.isNewMatch) {
            matchesCreated += 1;
            this.metrics?.matchesTotal.inc({
              band: scoreBand(breakdown.total, watch),
            });
          }
          if (persisted.job.sourcePublishedAt && persisted.isNewJob) {
            this.metrics?.detectionLatency.observe(
              Math.max(
                0,
                (persisted.job.firstSeenAt.getTime() -
                  persisted.job.sourcePublishedAt.getTime()) /
                  1_000,
              ),
            );
          }

          if (
            this.shouldNotify(
              effectiveMode,
              persisted.isNewMatch,
              breakdown,
              watch,
              job,
            )
          ) {
            const type =
              breakdown.total >= watch.urgentScore
                ? ("urgent" as const)
                : ("standard" as const);
            notificationsSent += await this.notifications.dispatch({
              idempotencyKey: "",
              type,
              watch,
              job: persisted.job,
              match: persisted.match,
              detectedAt: this.options.now(),
            });
          }
        } catch (error: unknown) {
          const reason = safeError(error);
          normalizationFailures.push(reason);
          this.logger.warn(
            `Skipping malformed normalized job watchId=${watchId} source=${String(job.site ?? "unknown")}: ${reason}`,
          );
        }
      }

      const completedAt = this.options.now();
      const sourceTargets = this.advanceSourceTargets(
        watch,
        sourceResult,
        completedAt,
      );
      const initializedAt =
        effectiveMode === "baseline" && sourceResult.status !== "failed"
          ? (watch.initializedAt ?? completedAt)
          : watch.initializedAt;
      await this.repo.updateWatch(watch.id, {
        initializedAt,
        lastRunAt: completedAt,
        sourceTargets,
      });

      const status =
        sourceResult.status === "failed"
          ? ("failed" as const)
          : sourceResult.status === "partial" ||
              normalizationFailures.length > 0
            ? ("partial" as const)
            : ("completed" as const);
      const completedRun = await this.repo.completeRun(run.id, {
        status,
        completedAt,
        sourcesRequested: sourceResult.sourcesRequested,
        sourcesSucceeded: sourceResult.sourcesSucceeded,
        sourcesFailed: sourceResult.sourcesFailed,
        jobsFetched: sourceResult.jobs.length,
        jobsNormalized,
        newJobsDetected,
        matchesCreated,
        notificationsSent,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errorSummary:
          sourceResult.failures.length || normalizationFailures.length
            ? [
                ...sourceResult.failures.map(
                  (failure) => `${failure.source}: ${failure.error}`,
                ),
                ...normalizationFailures.map(
                  (failure) => `normalized-job: ${failure}`,
                ),
              ]
                .join("; ")
                .slice(0, 2_000)
            : null,
      });
      this.observeRun(completedRun, sourceResult);
      return completedRun;
    } catch (error: unknown) {
      const completedAt = this.options.now();
      this.logger.error(
        `Watch run failed watchId=${watchId} runId=${run?.id ?? "uncreated"}: ${safeError(error)}`,
      );
      if (!run) throw error;
      const failedRun = await this.repo.completeRun(run.id, {
        status: "failed",
        completedAt,
        errorSummary: safeError(error),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });
      this.metrics?.runsTotal.inc({ status: "failed" });
      this.metrics?.runDuration.observe(
        Math.max(0, (failedRun.durationMs ?? 0) / 1_000),
      );
      return failedRun;
    } finally {
      clearInterval(heartbeat);
      const released = await this.repo.releaseWatchLease({
        watchId,
        ownerId: this.options.ownerId,
        token: leaseToken,
      });
      if (!released) {
        this.logger.warn(
          `Watch lease was not owned at release watchId=${watchId}`,
        );
      }
    }
  }

  private executeSources(
    input: ExecuteWatchSourcesInput,
  ): Promise<WatchSourcesExecutionResult> {
    return this.executor.execute(input);
  }

  private uniqueJobs(
    jobs: JobPostDto[],
    failures: string[] = [],
  ): JobPostDto[] {
    const byFingerprint = new Map<string, JobPostDto>();
    for (const job of jobs) {
      try {
        if (!job || typeof job.title !== "string" || !job.title.trim()) {
          failures.push("missing or non-string title");
          continue;
        }
        byFingerprint.set(this.fingerprintService.fingerprint(job), job);
      } catch (error: unknown) {
        failures.push(safeError(error));
      }
    }
    return [...byFingerprint.values()];
  }

  private shouldNotify(
    mode: WatchInitializationMode | undefined,
    isNewMatch: boolean,
    breakdown: ScoreBreakdown,
    watch: JobWatch,
    job: JobPostDto,
  ): boolean {
    if (breakdown.exclusionReason || breakdown.missingRequired.length > 0)
      return false;
    if (breakdown.total < watch.minimumScore || mode === "baseline")
      return false;
    if (mode === "notify-all") return true;
    if (!isNewMatch) return false;
    if (mode === "recent-only") {
      if (!job.datePosted) return true;
      const postedAt = new Date(job.datePosted).getTime();
      return (
        Number.isFinite(postedAt) &&
        this.options.now().getTime() - postedAt <=
          (watch.recentWindowMinutes ?? 180) * 60_000
      );
    }
    return true;
  }

  private initialNotificationState(
    mode: WatchInitializationMode | undefined,
    breakdown: ScoreBreakdown,
    watch: JobWatch,
  ): "pending" | "suppressed" {
    if (
      mode === "baseline" ||
      breakdown.exclusionReason ||
      breakdown.missingRequired.length > 0 ||
      breakdown.total < watch.digestScore
    )
      return "suppressed";
    return "pending";
  }

  private toObserved(
    job: JobPostDto,
    now: Date,
  ): Omit<ObservedJob, "id" | "createdAt" | "updatedAt"> {
    const location =
      typeof job.location === "string"
        ? job.location
        : [job.location?.city, job.location?.state, job.location?.country]
            .filter(Boolean)
            .join(", ");
    const publishedAt = job.datePosted ? new Date(job.datePosted) : null;
    return {
      fingerprint: this.fingerprintService.fingerprint(job),
      source: String(job.site ?? "unknown"),
      sourceType: job.atsType ?? null,
      externalJobId: stringOrNull(job.id ?? job.atsId),
      company: stringOrNull(job.companyName),
      normalizedCompany: this.fingerprintService.normalizeText(job.companyName),
      title: job.title.trim(),
      normalizedTitle: this.fingerprintService.normalizeText(job.title),
      location: location || null,
      normalizedLocation: this.fingerprintService.normalizeLocation(location),
      workplaceType: job.isRemote
        ? "remote"
        : normalizeOptional(job.workFromHomeType),
      employmentType: normalizeOptional(
        job.employmentType ?? job.jobType?.join(","),
      ),
      description: stringOrNull(job.description),
      descriptionHash: this.fingerprintService.descriptionHash(job.description),
      jobUrl: stringOrNull(job.jobUrl),
      applicationUrl: stringOrNull(
        job.applyUrl ?? job.jobUrlDirect ?? job.jobUrl,
      ),
      sourcePublishedAt:
        publishedAt && Number.isFinite(publishedAt.getTime())
          ? publishedAt
          : null,
      firstSeenAt: now,
      lastSeenAt: now,
      closedAt: null,
      rawPayload: job,
    };
  }

  private advanceSourceTargets(
    watch: JobWatch,
    result: WatchSourcesExecutionResult,
    completedAt: Date,
  ): JobWatch["sourceTargets"] {
    const executed = new Set(result.plan.targets.map((target) => target.key));
    return (watch.sourceTargets ?? []).map((target) => {
      const key = target.companySlug
        ? `${String(target.site)}:${target.companySlug}`
        : String(target.site);
      if (!executed.has(key)) return target;
      return {
        ...target,
        lastRunAt: completedAt,
        nextRunAt: new Date(
          completedAt.getTime() + target.intervalMinutes * 60_000,
        ),
      };
    });
  }

  private observeRun(
    run: WatchRun,
    sourceResult: WatchSourcesExecutionResult,
  ): void {
    this.metrics?.runsTotal.inc({ status: run.status });
    this.metrics?.runDuration.observe(
      Math.max(0, (run.durationMs ?? 0) / 1_000),
    );
    for (const source of sourceResult.sourceResults) {
      this.metrics?.sourceRequestsTotal.inc({
        source: source.source,
        status: source.status,
      });
      this.metrics?.jobsFetchedTotal.inc(
        { source: source.source },
        source.jobsFetched,
      );
      this.metrics?.sourceDuration.observe(
        { source: source.source },
        Math.max(0, source.durationMs / 1_000),
      );
    }
  }
}

function normalizeOptional(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : String(value);
  const trimmed = text.trim();
  return trimmed || null;
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value
    .replace(/https:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(
      /((?:authorization|token|api[-_ ]?key|secret)[=: ]+)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 2_000);
}

function scoreBand(score: number, watch: JobWatch): string {
  if (score >= watch.urgentScore) return "urgent";
  if (score >= watch.minimumScore) return "immediate";
  if (score >= watch.digestScore) return "digest";
  return "silent";
}
