import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JobPostDto, ScraperInputDto, Site } from "@ever-jobs/models";
import { AnalyticsService } from "@ever-jobs/analytics";
import { JobsService } from "./jobs.service";
import { CompareJobsDto } from "./job-comparison.dto";

const DEFAULT_COMPARE_CONCURRENCY = 5;
const MAX_COMPARE_CONCURRENCY = 10;
const MAX_PUBLIC_ERROR_LENGTH = 500;

export interface SourceComparisonSuccess {
  site: string;
  durationMs: number;
  totalJobs: number;
  withSalary: number;
  remoteJobs: number;
  uniqueCompanies: number;
}

export interface SourceComparisonFailure {
  source: string;
  error: string;
  durationMs: number;
}

export interface JobComparisonResult {
  totalJobs: number;
  concurrency: number;
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: SourceComparisonFailure[];
  comparisons: SourceComparisonSuccess[];
  summary: ReturnType<AnalyticsService["summarize"]>;
}

interface SourceSearchResult {
  source: string;
  durationMs: number;
  jobs: JobPostDto[];
}

/**
 * Runs source searches independently so one source failure cannot obscure the
 * successful comparisons. Work is chunked into bounded `allSettled` batches;
 * this keeps the API responsive without adding another runtime dependency.
 */
@Injectable()
export class JobComparisonService {
  constructor(
    private readonly jobs: JobsService,
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {}

  async compare(input: CompareJobsDto): Promise<JobComparisonResult> {
    const sources = this.requestedSources(input);
    const concurrency = this.resolveConcurrency(input.concurrency);
    const registered = new Set(this.jobs.listRegisteredSources().map(String));
    const tasks = sources.map(
      (source) => async (): Promise<SourceSearchResult> => {
        const startedAt = Date.now();
        if (!registered.has(source)) {
          throw sourceError(source, "Unknown or unavailable source", startedAt);
        }

        const {
          concurrency: _concurrency,
          siteType: _siteType,
          ...criteria
        } = input;
        void _concurrency;
        void _siteType;
        try {
          const jobs = await this.jobs.searchJobs(
            new ScraperInputDto({
              ...criteria,
              siteType: [source as Site],
            }),
          );
          return { source, jobs, durationMs: Date.now() - startedAt };
        } catch (error: unknown) {
          throw sourceError(source, error, startedAt);
        }
      },
    );

    const settled = await settleInBatches(tasks, concurrency);
    const succeeded: SourceSearchResult[] = [];
    const failed: SourceComparisonFailure[] = [];

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      const source = sources[index];
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
        continue;
      }
      const reason = result.reason as Error & { durationMs?: number };
      failed.push({
        source,
        error: sanitizeComparisonError(reason),
        durationMs: reason.durationMs ?? 0,
      });
    }

    const allJobs = succeeded.flatMap(({ jobs }) => jobs);
    const comparisons = succeeded.map((result) => this.toComparison(result));

    return {
      totalJobs: allJobs.length,
      concurrency,
      sourcesRequested: sources,
      sourcesSucceeded: succeeded.map(({ source }) => source),
      sourcesFailed: failed,
      comparisons,
      summary: this.analytics.summarize(allJobs),
    };
  }

  private requestedSources(input: CompareJobsDto): string[] {
    const requested = input.siteType?.map(String) ?? [];
    const values = requested.length
      ? requested
      : this.jobs.listRegisteredSources().map(String);
    return [...new Set(values)];
  }

  private resolveConcurrency(requested: number | undefined): number {
    const configured = this.config.get<number>(
      "watcher.maxConcurrentSources",
      DEFAULT_COMPARE_CONCURRENCY,
    );
    const serverLimit = clampInteger(
      configured,
      1,
      MAX_COMPARE_CONCURRENCY,
      DEFAULT_COMPARE_CONCURRENCY,
    );
    return Math.min(
      clampInteger(requested, 1, MAX_COMPARE_CONCURRENCY, serverLimit),
      serverLimit,
    );
  }

  private toComparison(result: SourceSearchResult): SourceComparisonSuccess {
    const rows = this.analytics.compareSites(result.jobs);
    const row =
      rows.find((candidate) => candidate.site === result.source) ?? rows[0];
    return {
      site: result.source,
      durationMs: result.durationMs,
      totalJobs: row?.totalJobs ?? result.jobs.length,
      withSalary: row?.withSalary ?? 0,
      remoteJobs: row?.remoteJobs ?? 0,
      uniqueCompanies: row?.uniqueCompanies ?? 0,
    };
  }
}

async function settleInBatches<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let offset = 0; offset < tasks.length; offset += concurrency) {
    const batch = tasks.slice(offset, offset + concurrency);
    results.push(...(await Promise.allSettled(batch.map((task) => task()))));
  }
  return results;
}

function sourceError(
  source: string,
  value: unknown,
  startedAt: number,
): Error & { durationMs: number } {
  const message = value instanceof Error ? value.message : String(value);
  return Object.assign(new Error(`${source}: ${message}`), {
    durationMs: Date.now() - startedAt,
  });
}

/** Redact URL/token-like material before a source error reaches a client. */
export function sanitizeComparisonError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(
      /\b(bearer|token|api[-_ ]?key|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, MAX_PUBLIC_ERROR_LENGTH);
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
