import {
  ConflictException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { JobPostDto, LocationDto } from "@ever-jobs/models";
import {
  JobWatch,
  ObservedJob,
  ScoreBreakdown,
  WATCH_REPOSITORY,
  WatchInitializationMode,
  WatchRepository,
  WatchRun,
  WatchTargetHealth,
  WatchTargetRunResult,
} from "../interfaces/watch.types";
import {
  CANONICAL_EPISODE_WINDOW_MS,
  JobFingerprintService,
} from "./job-fingerprint.service";
import { JobScoringService } from "./job-scoring.service";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import {
  ExecuteWatchSourcesInput,
  JobsServiceWatchExecutor,
  WatchSourceJob,
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
  targetKeys?: string[];
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
    const executionWatch = this.selectTargets(watch, runOptions.targetKeys);

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
    try {
      run = await this.repo.createRun({
        watchId,
        startedAt,
        sourcesRequested:
          executionWatch.sourceTargets.length > 0
            ? executionWatch.sourceTargets.map(targetKey)
            : executionWatch.sources,
      });
      const sourceResult = await this.executeSources({
        watch: executionWatch,
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

      for (const sourceJob of uniqueJobs) {
        const { job, target } = sourceJob;
        try {
          if (typeof job.title !== "string" || !job.title.trim()) continue;
          jobsNormalized += 1;
          const breakdown = this.scoring.score(sourceJob, watch);
          const targetMode = this.initializationModeForTarget(
            watch,
            target.initializedAt,
            mode,
          );
          const observedInput = this.toObserved(sourceJob, this.options.now());
          const notificationState = this.initialNotificationState(
            targetMode,
            breakdown,
            watch,
          );
          const notificationSuppressionReason =
            this.initialNotificationSuppressionReason(
              targetMode,
              breakdown,
              watch,
            );
          const persisted = await this.repo.persistObservationAndMatch({
            observedJob: observedInput,
            canonicalEpisodeAnchorWindowMs:
              observedInput.canonicalEpisodeStartedAt
                ? CANONICAL_EPISODE_WINDOW_MS
                : undefined,
            match: {
              watchId,
              canonicalEpisodeKey: observedInput.canonicalEpisodeKey,
              sourceTargetKey: target.key,
              score: breakdown.total,
              scoreBreakdown: breakdown,
              matchedTerms: breakdown.matchedKeywords,
              excludedReason: breakdown.exclusionReason,
              status: "new",
              firstMatchedAt: this.options.now(),
              lastMatchedAt: this.options.now(),
              notificationState,
              notificationSuppressionReason,
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
              targetMode,
              persisted.match.notificationState,
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
        mode,
      );
      const { targetHealth, targetResults, coverageDegraded } =
        this.advanceTargetHealth(watch, sourceResult, completedAt);
      const initializedAt = this.watchInitializedAt(
        watch,
        sourceTargets,
        sourceResult,
        completedAt,
        mode,
      );
      await this.repo.updateWatch(watch.id, {
        initializedAt,
        lastRunAt: completedAt,
        nextRunAt: this.nextWatchRunAt(watch, sourceTargets, completedAt),
        sourceTargets,
        targetHealth,
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
        targetResults,
        coverageDegraded,
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
      for (const targetResult of targetResults) {
        this.metrics?.observeTargetResult(watch.id, targetResult);
      }
      this.metrics?.setTier1CoverageDegraded(watch.id, coverageDegraded);
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
    jobs: WatchSourceJob[],
    failures: string[] = [],
  ): WatchSourceJob[] {
    const byFingerprint = new Map<string, WatchSourceJob>();
    for (const sourceJob of jobs) {
      try {
        const { job } = sourceJob;
        if (!job || typeof job.title !== "string" || !job.title.trim()) {
          failures.push("missing or non-string title");
          continue;
        }
        byFingerprint.set(this.fingerprintService.fingerprint(job), sourceJob);
      } catch (error: unknown) {
        failures.push(safeError(error));
      }
    }
    return [...byFingerprint.values()];
  }

  private shouldNotify(
    mode: WatchInitializationMode | undefined,
    notificationState: "pending" | "sent" | "failed" | "suppressed",
    breakdown: ScoreBreakdown,
    watch: JobWatch,
    job: JobPostDto,
  ): boolean {
    if (breakdown.exclusionReason || breakdown.missingRequired.length > 0)
      return false;
    if (breakdown.total < watch.minimumScore || mode === "baseline")
      return false;
    if (notificationState !== "pending") return false;
    if (mode === "notify-all") return true;
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

  private initialNotificationSuppressionReason(
    mode: WatchInitializationMode | undefined,
    breakdown: ScoreBreakdown,
    watch: JobWatch,
  ): "baseline" | "eligibility" | null {
    if (mode === "baseline") return "baseline";
    if (
      breakdown.exclusionReason ||
      breakdown.missingRequired.length > 0 ||
      breakdown.total < watch.digestScore
    ) {
      return "eligibility";
    }
    return null;
  }

  private toObserved(
    sourceJob: WatchSourceJob,
    now: Date,
  ): Omit<ObservedJob, "id" | "createdAt" | "updatedAt"> {
    const { job, target } = sourceJob;
    const locations = storedLocations(job);
    const location = locationText(locations[0] ?? job.location);
    const publishedAt = job.datePosted ? new Date(job.datePosted) : null;
    const canonicalOptions = {
      employerOwnedListing: target.kind === "direct" || target.kind === "ats",
    };
    const usesObservationAnchor =
      this.fingerprintService.usesObservationEpisodeAnchor(
        job,
        canonicalOptions,
      );
    return {
      fingerprint: this.fingerprintService.fingerprint(job),
      source: String(job.site ?? "unknown"),
      sourceTargetKey: target.key,
      sourceType: job.atsType ?? null,
      externalJobId: stringOrNull(job.id ?? job.atsId),
      company: stringOrNull(job.companyName),
      normalizedCompany: this.fingerprintService.normalizeText(job.companyName),
      title: job.title.trim(),
      normalizedTitle: this.fingerprintService.normalizeText(job.title),
      location: location || null,
      normalizedLocation: this.fingerprintService.normalizeLocation(location),
      locations,
      canonicalKey: this.fingerprintService.canonicalFingerprint(
        job,
        canonicalOptions,
      ),
      canonicalEpisodeKey: this.fingerprintService.canonicalEpisodeFingerprint(
        job,
        now,
        canonicalOptions,
      ),
      canonicalEpisodeStartedAt: usesObservationAnchor ? now : null,
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
    requestedMode?: WatchInitializationMode,
  ): JobWatch["sourceTargets"] {
    const plannedByKey = new Map(
      result.plan.targets.map((target) => [target.key, target] as const),
    );
    const summariesByKey = new Map(
      result.sourceResults.map((summary) => [summary.source, summary] as const),
    );
    return (watch.sourceTargets ?? []).map((target) => {
      const key = targetKey(target);
      const planned = plannedByKey.get(key);
      if (!planned) return target;
      const summary = summariesByKey.get(key);
      const targetMode = this.initializationModeForTarget(
        watch,
        planned.initializedAt,
        requestedMode,
      );
      const initializedAt =
        targetMode === "baseline" && summary?.status === "succeeded"
          ? (target.initializedAt ?? completedAt)
          : target.initializedAt;
      return {
        ...target,
        initializedAt,
        lastRunAt: completedAt,
        nextRunAt: new Date(
          completedAt.getTime() + target.intervalMinutes * 60_000,
        ),
      };
    });
  }

  private selectTargets(
    watch: JobWatch,
    requestedKeys: string[] | undefined,
  ): JobWatch {
    if (requestedKeys === undefined || requestedKeys.length === 0) return watch;

    const keys = requestedKeys.map((key) => key.trim());
    if (keys.some((key) => !key)) {
      throw new BadRequestException(
        "WATCH_TARGET_UNKNOWN: target keys must be non-empty",
      );
    }
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException(
        "WATCH_TARGET_DUPLICATE: target keys must be unique",
      );
    }
    if ((watch.sourceTargets?.length ?? 0) === 0) {
      throw new BadRequestException(`WATCH_TARGET_UNKNOWN: ${keys.join(", ")}`);
    }

    const configured = new Map(
      watch.sourceTargets.map((target) => [targetKey(target), target] as const),
    );
    const selected = keys.map((key) => {
      const target = configured.get(key);
      if (!target) {
        throw new BadRequestException(`WATCH_TARGET_UNKNOWN: ${key}`);
      }
      if (!target.enabled) {
        throw new BadRequestException(`WATCH_TARGET_DISABLED: ${key}`);
      }
      return target;
    });

    return { ...watch, sourceTargets: selected };
  }

  private initializationModeForTarget(
    watch: JobWatch,
    initializedAt: Date | null | undefined,
    requestedMode?: WatchInitializationMode,
  ): WatchInitializationMode | undefined {
    if (requestedMode === "baseline") return "baseline";
    const effectiveInitializedAt =
      initializedAt === undefined ? watch.initializedAt : initializedAt;
    if (!effectiveInitializedAt) return "baseline";
    return requestedMode;
  }

  private advanceTargetHealth(
    watch: JobWatch,
    result: WatchSourcesExecutionResult,
    completedAt: Date,
  ): {
    targetHealth: Record<string, WatchTargetHealth>;
    targetResults: WatchTargetRunResult[];
    coverageDegraded: boolean;
  } {
    const plannedByKey = new Map(
      [...result.plan.targets, ...result.plan.skippedTargets].map(
        (target) => [target.key, target] as const,
      ),
    );
    const targetHealth: Record<string, WatchTargetHealth> = {
      ...(watch.targetHealth ?? {}),
    };
    const targetResults: WatchTargetRunResult[] = [];

    for (const summary of result.sourceResults) {
      const planned = plannedByKey.get(summary.source);
      const previous = targetHealth[summary.source];
      const tier = planned?.tier ?? previous?.tier ?? 3;
      const succeeded = summary.status === "succeeded";
      const hardFailure = summary.status === "failed";
      const nonEmpty = summary.jobsFetched > 0;
      const consecutiveHardFailures = hardFailure
        ? (previous?.consecutiveHardFailures ?? 0) + 1
        : 0;
      const degraded = tier === 1 && consecutiveHardFailures >= 3;
      const health: WatchTargetHealth = {
        targetKey: summary.source,
        tier,
        successCount: (previous?.successCount ?? 0) + (succeeded ? 1 : 0),
        hardFailureCount:
          (previous?.hardFailureCount ?? 0) + (hardFailure ? 1 : 0),
        emptyRunCount:
          (previous?.emptyRunCount ?? 0) + (succeeded && !nonEmpty ? 1 : 0),
        partialRunCount:
          (previous?.partialRunCount ?? 0) +
          (summary.status === "partial" ? 1 : 0),
        consecutiveHardFailures,
        lastAttemptAt: completedAt,
        lastSuccessAt: succeeded
          ? completedAt
          : (previous?.lastSuccessAt ?? null),
        lastNonEmptyAt: nonEmpty
          ? completedAt
          : (previous?.lastNonEmptyAt ?? null),
        degradedAt: degraded ? (previous?.degradedAt ?? completedAt) : null,
      };
      targetHealth[summary.source] = health;
      targetResults.push({
        targetKey: summary.source,
        tier,
        status: summary.status,
        outcome: hardFailure
          ? "hard_failure"
          : summary.status === "partial"
            ? "partial"
            : nonEmpty
              ? "success"
              : "empty",
        requests: summary.requests,
        requestsSucceeded: summary.requestsSucceeded,
        requestsFailed: summary.requestsFailed,
        jobsFetched: summary.jobsFetched,
        durationMs: summary.durationMs,
        empty: succeeded && !nonEmpty,
        hardFailure,
        consecutiveHardFailures,
        degraded,
        lastSuccessAt: health.lastSuccessAt,
        lastNonEmptyAt: health.lastNonEmptyAt,
      });
    }

    const activeTierOneKeys = new Set<string>(
      watch.sourceTargets.length > 0
        ? watch.sourceTargets
            .filter((target) => target.enabled && target.tier === 1)
            .map(targetKey)
        : [...plannedByKey.values()]
            .filter((target) => target.tier === 1)
            .map((target) => target.key),
    );
    const coverageDegraded = [...activeTierOneKeys].some(
      (key) => (targetHealth[key]?.consecutiveHardFailures ?? 0) >= 3,
    );
    return { targetHealth, targetResults, coverageDegraded };
  }

  private watchInitializedAt(
    watch: JobWatch,
    sourceTargets: JobWatch["sourceTargets"],
    result: WatchSourcesExecutionResult,
    completedAt: Date,
    requestedMode?: WatchInitializationMode,
  ): Date | null | undefined {
    if (sourceTargets.length > 0) {
      const allEnabledTargetsInitialized = sourceTargets
        .filter((target) => target.enabled)
        .every((target) =>
          target.initializedAt === undefined
            ? Boolean(watch.initializedAt)
            : Boolean(target.initializedAt),
        );
      return allEnabledTargetsInitialized
        ? (watch.initializedAt ?? completedAt)
        : watch.initializedAt;
    }

    const effectiveMode = this.initializationModeForTarget(
      watch,
      watch.initializedAt,
      requestedMode,
    );
    return effectiveMode === "baseline" && result.status === "completed"
      ? (watch.initializedAt ?? completedAt)
      : watch.initializedAt;
  }

  private nextWatchRunAt(
    watch: JobWatch,
    sourceTargets: JobWatch["sourceTargets"],
    completedAt: Date,
  ): Date | null {
    if (sourceTargets.length === 0) {
      return new Date(completedAt.getTime() + watch.intervalMinutes * 60_000);
    }
    const enabledTargets = sourceTargets.filter((target) => target.enabled);
    if (enabledTargets.length === 0) {
      return new Date(completedAt.getTime() + watch.intervalMinutes * 60_000);
    }
    if (enabledTargets.some((target) => !target.nextRunAt)) return null;
    return enabledTargets.reduce(
      (earliest, target) =>
        (target.nextRunAt as Date).getTime() < earliest.getTime()
          ? (target.nextRunAt as Date)
          : earliest,
      enabledTargets[0].nextRunAt as Date,
    );
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

function targetKey(target: { site: string; companySlug?: string }): string {
  return target.companySlug
    ? `${String(target.site)}:${target.companySlug}`
    : String(target.site);
}

function storedLocations(job: JobPostDto): LocationDto[] {
  const candidates =
    Array.isArray(job.locations) && job.locations.length > 0
      ? job.locations
      : job.location
        ? [job.location]
        : [];
  const locations: LocationDto[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates as unknown[]) {
    const location = storedLocation(candidate);
    if (!location) continue;
    const key = [location.city, location.state, location.country]
      .map((part) =>
        String(part ?? "")
          .trim()
          .toLowerCase(),
      )
      .join("\u001f");
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
  }
  return locations;
}

function storedLocation(value: unknown): LocationDto | null {
  if (typeof value === "string") {
    const city = value.trim();
    return city ? new LocationDto({ city }) : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const city = stringOrNull(record.city);
  const state = stringOrNull(record.state);
  const country = stringOrNull(record.country);
  if (!city && !state && !country) return null;
  return new LocationDto({ city, state, country });
}

function locationText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return [record.city, record.state, record.country]
    .map(stringOrNull)
    .filter((part): part is string => Boolean(part))
    .join(", ");
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
