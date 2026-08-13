import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  Country,
  DescriptionFormat,
  JobPostDto,
  ScraperInputDto,
} from "@ever-jobs/models";
import { parseLocationGeography } from "@ever-jobs/common";
import { JobWatch, WatchSourceExecutor } from "../interfaces/watch.types";
import {
  WatchSourcePlan,
  WatchSourcePlanIssue,
  WatchSourcePlanner,
  WatchSourceMetadata,
  WatchSourceRequest,
  WatchSourceTarget,
} from "./watch-source-planner.service";

/**
 * Application-layer token for the existing JobsService. Keeping the contract
 * here avoids importing an app service into the reusable watcher package.
 */
export const WATCH_JOBS_SERVICE = Symbol("WATCH_JOBS_SERVICE");
export const WATCH_SOURCE_EXECUTION_OPTIONS = Symbol(
  "WATCH_SOURCE_EXECUTION_OPTIONS",
);

export interface WatchJobsSearchDetailedResult {
  jobs: JobPostDto[];
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: Array<{ source: string; error: string }>;
  durationsMs: Record<string, number>;
}

export interface WatchJobsService {
  searchJobs(input: ScraperInputDto): Promise<JobPostDto[]>;
  searchJobsDetailed?(
    input: ScraperInputDto,
  ): Promise<WatchJobsSearchDetailedResult>;
  listRegisteredSources?(): string[];
  listSourceMetadata?(): WatchSourceMetadata[];
}

export interface WatchSourceExecutionOptions {
  maxConcurrency: number;
  maxConcurrencyPerSource: number;
  timeoutMs: number;
  maxJitterMs: number;
  maxQueryTermsPerSource: number;
  resultsWanted: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Test seams; production uses Math.random/setTimeout/Date.now. */
  random: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
}

export const DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS: Readonly<WatchSourceExecutionOptions> =
  Object.freeze({
    maxConcurrency: 5,
    maxConcurrencyPerSource: 1,
    timeoutMs: 12_000,
    maxJitterMs: 1_000,
    maxQueryTermsPerSource: 4,
    resultsWanted: 100,
    retryAttempts: 3,
    retryBaseDelayMs: 1_000,
    retryMaxDelayMs: 30_000,
    random: Math.random,
    sleep: (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(() => resolve(), milliseconds)),
    now: Date.now,
  });

export type WatchSourceFailureCategory =
  | "configuration"
  | "unregistered"
  | "timeout"
  | "source";

export interface WatchSourceFailure {
  source: string;
  requestId: string;
  category: WatchSourceFailureCategory;
  error: string;
  retryable: boolean;
}

export interface WatchSourceRequestResult {
  requestId: string;
  source: string;
  target?: WatchSourceTarget;
  searchTerm?: string;
  location?: string;
  countryCodes?: string[];
  matrixIndex?: number;
  status: "succeeded" | "failed";
  jobsFetched: number;
  durationMs: number;
  failure?: WatchSourceFailure;
}

export interface WatchSourceSummary {
  source: string;
  status: "succeeded" | "partial" | "failed";
  requests: number;
  requestsSucceeded: number;
  requestsFailed: number;
  jobsFetched: number;
  durationMs: number;
}

export interface WatchSourcesExecutionResult {
  status: "completed" | "partial" | "failed";
  jobs: WatchSourceJob[];
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: string[];
  failures: WatchSourceFailure[];
  requestResults: WatchSourceRequestResult[];
  sourceResults: WatchSourceSummary[];
  plan: WatchSourcePlan;
}

/** A normalized source result with the exact target/request that produced it. */
export interface WatchSourceJob {
  job: JobPostDto;
  target: WatchSourceTarget;
  requestId: string;
  searchTerm?: string;
  location?: string;
  countryCodes: string[];
  matrixIndex: number;
}

export interface ExecuteWatchSourcesInput {
  watch: JobWatch;
  now?: Date;
  lastRunAt?: Date | null;
  /** Manual and initialization runs use force=true to query every tier. */
  force?: boolean;
}

interface RequestValue {
  jobs: JobPostDto[];
  durationMs: number;
  reportedFailure?: { source: string; error: string };
}

class WatchSourceTimeoutError extends Error {
  constructor(
    readonly source: string,
    readonly timeoutMs: number,
  ) {
    super(`Source "${source}" exceeded the ${timeoutMs} ms execution timeout`);
    this.name = "WatchSourceTimeoutError";
  }
}

/**
 * Executes concrete source requests through the existing JobsService.
 *
 * The executor owns watcher-level concurrency, jitter and a hard deadline;
 * JobsService continues to own scraper discovery, HTTP policy, circuit
 * breaking, retry execution, normalization and source metrics.
 */
@Injectable()
export class JobsServiceWatchExecutor implements WatchSourceExecutor {
  private readonly options: WatchSourceExecutionOptions;
  private readonly limiter: AsyncLimiter;
  private readonly sourceLimiters = new Map<string, AsyncLimiter>();

  constructor(
    @Inject(WATCH_JOBS_SERVICE)
    private readonly jobsService: WatchJobsService,
    private readonly planner: WatchSourcePlanner,
    @Optional()
    @Inject(WATCH_SOURCE_EXECUTION_OPTIONS)
    options?: Partial<WatchSourceExecutionOptions>,
  ) {
    this.options = {
      ...DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS,
      ...options,
    };
    this.options.maxConcurrency = positiveInteger(
      this.options.maxConcurrency,
      DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS.maxConcurrency,
    );
    this.options.timeoutMs = positiveInteger(
      this.options.timeoutMs,
      DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS.timeoutMs,
    );
    this.options.maxConcurrencyPerSource = positiveInteger(
      this.options.maxConcurrencyPerSource,
      DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS.maxConcurrencyPerSource,
    );
    this.options.maxJitterMs = nonNegativeInteger(
      this.options.maxJitterMs,
      DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS.maxJitterMs,
    );
    this.options.maxQueryTermsPerSource = positiveInteger(
      this.options.maxQueryTermsPerSource,
      DEFAULT_WATCH_SOURCE_EXECUTION_OPTIONS.maxQueryTermsPerSource,
    );
    this.limiter = new AsyncLimiter(this.options.maxConcurrency);
  }

  async execute(
    input: ExecuteWatchSourcesInput,
  ): Promise<WatchSourcesExecutionResult> {
    const plan = this.planner.plan(input.watch, {
      now: input.now,
      lastRunAt: input.lastRunAt,
      force: input.force,
      maxQueryTermsPerSource: this.options.maxQueryTermsPerSource,
      sourceMetadata: this.jobsService.listSourceMetadata?.(),
    });
    const planningFailures = this.planningFailures(plan.issues);
    const registeredSources = this.registeredSourceKeys();
    const unregisteredTargetKeys = new Set<string>();

    if (registeredSources) {
      for (const target of plan.targets) {
        if (!registeredSources.has(normalizeSourceKey(target.site))) {
          unregisteredTargetKeys.add(target.key);
          planningFailures.push({
            source: target.key,
            requestId: `configuration:${target.key}`,
            category: "unregistered",
            error: `Source "${target.site}" is not registered in JobsService`,
            retryable: false,
          });
        }
      }
    }

    const executableRequests = plan.requests.filter(
      (request) => !unregisteredTargetKeys.has(request.target.key),
    );
    const settled = await Promise.allSettled(
      executableRequests.map((request) =>
        this.executeWithJitter(request, input.watch),
      ),
    );

    const jobs: WatchSourceJob[] = [];
    const requestResults: WatchSourceRequestResult[] = planningFailures.map(
      (failure) => ({
        requestId: failure.requestId,
        source: failure.source,
        status: "failed",
        jobsFetched: 0,
        durationMs: 0,
        failure,
      }),
    );

    for (const [index, result] of settled.entries()) {
      const request = executableRequests[index];
      if (result.status === "rejected") {
        const failure = this.requestFailure(request, result.reason);
        requestResults.push({
          requestId: request.id,
          source: request.target.key,
          ...requestResultContext(request),
          status: "failed",
          jobsFetched: 0,
          durationMs: sourceFailureDuration(result.reason),
          failure,
        });
        continue;
      }

      jobs.push(
        ...result.value.jobs.map((job) => ({
          job: brandedTargetJob(job, request.target),
          target: request.target,
          requestId: request.id,
          searchTerm: request.searchTerm,
          location: request.location,
          countryCodes: [...request.countryCodes],
          matrixIndex: request.matrixIndex,
        })),
      );
      if (result.value.reportedFailure) {
        const failure: WatchSourceFailure = {
          source: request.target.key,
          requestId: request.id,
          category: "source",
          error: safeErrorMessage(result.value.reportedFailure.error),
          retryable: true,
        };
        requestResults.push({
          requestId: request.id,
          source: request.target.key,
          ...requestResultContext(request),
          status: "failed",
          jobsFetched: result.value.jobs.length,
          durationMs: result.value.durationMs,
          failure,
        });
        continue;
      }

      requestResults.push({
        requestId: request.id,
        source: request.target.key,
        ...requestResultContext(request),
        status: "succeeded",
        jobsFetched: result.value.jobs.length,
        durationMs: result.value.durationMs,
      });
    }

    const sourceResults = this.summarizeSources(requestResults);
    const failures = requestResults.flatMap((result) =>
      result.failure ? [result.failure] : [],
    );
    const successfulRequests = requestResults.filter(
      (result) => result.status === "succeeded",
    ).length;
    const status =
      failures.length === 0
        ? "completed"
        : successfulRequests > 0
          ? "partial"
          : "failed";

    return {
      status,
      jobs,
      sourcesRequested: sourceResults.map((source) => source.source),
      sourcesSucceeded: sourceResults
        .filter((source) => source.status === "succeeded")
        .map((source) => source.source),
      sourcesFailed: sourceResults
        .filter((source) => source.status !== "succeeded")
        .map((source) => source.source),
      failures,
      requestResults,
      sourceResults,
      plan,
    };
  }

  /**
   * Compatibility adapter for the original WatchSourceExecutor interface.
   * New orchestration should call execute() once per watch so tier planning and
   * board de-multiplication remain effective.
   */
  async search(input: {
    watch: JobWatch;
    searchTerm: string;
    sources: string[];
  }): Promise<JobPostDto[]> {
    const result = await this.execute({
      watch: {
        ...input.watch,
        sources: input.sources,
        searchTerms: [input.searchTerm],
      },
      force: true,
    });
    if (result.status === "failed" && result.failures.length > 0) {
      throw new Error(
        result.failures.map((failure) => failure.error).join("; "),
      );
    }
    return result.jobs.map(({ job }) => job);
  }

  private async executeWithJitter(
    request: WatchSourceRequest,
    watch: JobWatch,
  ): Promise<RequestValue> {
    const jitterMs = Math.floor(
      Math.max(0, Math.min(1, this.options.random())) *
        (this.options.maxJitterMs + 1),
    );
    if (jitterMs > 0) await this.options.sleep(jitterMs);
    return this.sourceLimiter(request.target.site).run(() =>
      this.limiter.run(() => this.executeRequest(request, watch)),
    );
  }

  private sourceLimiter(source: string): AsyncLimiter {
    const key = normalizeSourceKey(source);
    const existing = this.sourceLimiters.get(key);
    if (existing) return existing;
    const limiter = new AsyncLimiter(this.options.maxConcurrencyPerSource);
    this.sourceLimiters.set(key, limiter);
    return limiter;
  }

  private async executeRequest(
    request: WatchSourceRequest,
    watch: JobWatch,
  ): Promise<RequestValue> {
    const startedAt = this.options.now();
    const scraperInput = this.toScraperInput(request, watch);
    const search = async (): Promise<RequestValue> => {
      if (this.jobsService.searchJobsDetailed) {
        const detailed =
          await this.jobsService.searchJobsDetailed(scraperInput);
        const reportedFailure = detailed.sourcesFailed.find(
          (failure) =>
            normalizeSourceKey(failure.source) ===
            normalizeSourceKey(request.target.site),
        );
        return {
          jobs: detailed.jobs,
          durationMs:
            detailed.durationsMs[request.target.site] ??
            Math.max(0, this.options.now() - startedAt),
          reportedFailure,
        };
      }

      const jobs = await this.jobsService.searchJobs(scraperInput);
      return {
        jobs,
        durationMs: Math.max(0, this.options.now() - startedAt),
      };
    };

    try {
      return await withTimeout(
        search(),
        this.options.timeoutMs,
        () =>
          new WatchSourceTimeoutError(
            request.target.key,
            this.options.timeoutMs,
          ),
      );
    } catch (error) {
      if (error && typeof error === "object") {
        Object.assign(error, {
          sourceDurationMs: Math.max(0, this.options.now() - startedAt),
        });
      }
      throw error;
    }
  }

  private toScraperInput(
    request: WatchSourceRequest,
    watch: JobWatch,
  ): ScraperInputDto {
    return new ScraperInputDto({
      siteType: [request.target.site],
      companySlug: request.target.companySlug,
      companyUrl: request.target.companyUrl,
      searchTerm: request.searchTerm,
      googleSearchTerm: request.searchTerm,
      location:
        request.target.mode === "board-search"
          ? undefined
          : (request.location ??
            request.target.searchScope.locations[0] ??
            watch.locations[0] ??
            "Canada"),
      country: countryForRequest(request, watch),
      resultsWanted: request.target.resultsWanted ?? this.options.resultsWanted,
      descriptionFormat: DescriptionFormat.MARKDOWN,
      requestTimeout: Math.max(1, Math.ceil(this.options.timeoutMs / 1_000)),
      maxConcurrentCompanies: 1,
      retries: this.options.retryAttempts,
      retryDelay: this.options.retryBaseDelayMs,
      retryBackoff: "exponential",
      retryMaxDelay: this.options.retryMaxDelayMs,
    });
  }

  private registeredSourceKeys(): Set<string> | null {
    if (!this.jobsService.listRegisteredSources) return null;
    return new Set(
      this.jobsService
        .listRegisteredSources()
        .map((source) => normalizeSourceKey(source)),
    );
  }

  private planningFailures(
    issues: WatchSourcePlanIssue[],
  ): WatchSourceFailure[] {
    return issues
      .filter((issue) => issue.severity === "error")
      .map((issue, index) => ({
        source: issue.source,
        requestId: `configuration:${index + 1}`,
        category: "configuration" as const,
        error: issue.message,
        retryable: false,
      }));
  }

  private requestFailure(
    request: WatchSourceRequest,
    reason: unknown,
  ): WatchSourceFailure {
    const timedOut = reason instanceof WatchSourceTimeoutError;
    return {
      source: request.target.key,
      requestId: request.id,
      category: timedOut ? "timeout" : "source",
      error: safeErrorMessage(reason),
      retryable: true,
    };
  }

  private summarizeSources(
    requestResults: WatchSourceRequestResult[],
  ): WatchSourceSummary[] {
    const summaries = new Map<string, WatchSourceSummary>();
    for (const request of requestResults) {
      const summary = summaries.get(request.source) ?? {
        source: request.source,
        status: "succeeded" as const,
        requests: 0,
        requestsSucceeded: 0,
        requestsFailed: 0,
        jobsFetched: 0,
        durationMs: 0,
      };
      summary.requests += 1;
      summary.jobsFetched += request.jobsFetched;
      summary.durationMs += request.durationMs;
      if (request.status === "succeeded") summary.requestsSucceeded += 1;
      else summary.requestsFailed += 1;
      summary.status =
        summary.requestsFailed === 0
          ? "succeeded"
          : summary.requestsSucceeded > 0
            ? "partial"
            : "failed";
      summaries.set(request.source, summary);
    }
    return [...summaries.values()];
  }
}

class AsyncLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function countryForRequest(
  request: WatchSourceRequest,
  watch: JobWatch,
): Country {
  const configuredCodes =
    request.countryCodes.length > 0
      ? request.countryCodes
      : request.target.searchScope.countryCodes.length > 0
        ? request.target.searchScope.countryCodes
        : watch.countryCodes;
  const available = new Set(
    configuredCodes.map((countryCode) => countryCode.trim().toUpperCase()),
  );
  const parsedCountry = parseLocationGeography(request.location).countryCode;
  const locationCountry =
    parsedCountry === "US" && (available.has("US") || available.has("USA"))
      ? "US"
      : parsedCountry === "CA" && (available.has("CA") || available.has("CAN"))
        ? "CA"
        : undefined;
  const countryCode =
    locationCountry ?? configuredCodes[0]?.trim().toUpperCase();
  if (!countryCode || countryCode === "CA" || countryCode === "CAN") {
    return Country.CANADA;
  }
  if (countryCode === "US" || countryCode === "USA") return Country.USA;
  return (Object.values(Country) as string[]).includes(countryCode)
    ? (countryCode as Country)
    : Country.CANADA;
}

function brandedTargetJob(
  job: JobPostDto,
  target: WatchSourceTarget,
): JobPostDto {
  const companyName =
    target.kind === "ats" ? target.companyName?.trim() : undefined;
  return companyName ? new JobPostDto({ ...job, companyName }) : job;
}

function normalizeSourceKey(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown source execution error";
  return raw
    .replace(
      /((?:authorization|token|api[-_ ]?key|secret)[=: ]+)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 500);
}

function sourceFailureDuration(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const duration = (error as { sourceDurationMs?: unknown }).sourceDurationMs;
  return typeof duration === "number" && Number.isFinite(duration)
    ? Math.max(0, duration)
    : 0;
}

function requestResultContext(
  request: WatchSourceRequest,
): Pick<
  WatchSourceRequestResult,
  "target" | "searchTerm" | "location" | "countryCodes" | "matrixIndex"
> {
  return {
    target: request.target,
    searchTerm: request.searchTerm,
    location: request.location,
    countryCodes: [...request.countryCodes],
    matrixIndex: request.matrixIndex,
  };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
