import { Injectable, Logger } from "@nestjs/common";
import {
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from "@ever-jobs/models";
import {
  createHttpClient,
  parseLocationList,
  stripHtmlTags,
} from "@ever-jobs/common";
import { SourcePlugin } from "@ever-jobs/plugin";

import { UberSourceError, uberErrorMessage } from "./uber-source.error";

const API_URL = "https://www.uber.com/api/loadSearchJobsResults";
const PAGE_SIZE = 50;
const REQUEST_DELAY_MS = 500;
const DEFAULT_RESULTS = 100;
const MAX_RESULTS = 1_000;
const MAX_PAGES = 100;
const DEFAULT_LOCALE = "en";

const UBER_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0",
  "x-csrf-token": "x",
};

type JsonRecord = Record<string, unknown>;

interface UberPage {
  results: unknown[];
  totalResults: number | null;
}

@SourcePlugin({
  site: Site.UBER,
  name: "Uber",
  category: "company",
  watchMode: "board",
  description: "Official paginated Uber careers board.",
})
@Injectable()
export class UberService implements IScraper {
  private readonly logger = new Logger(UberService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = normalizeResultsWanted(
      input.resultsWanted,
      DEFAULT_RESULTS,
    );
    if (resultsWanted === 0) return new JobResponseDto([]);

    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      userAgent: input.userAgent,
      timeout: input.requestTimeout ?? 12,
      retries: input.retries ?? 3,
      retryDelay: input.retryDelay ?? 1_000,
      retryBackoff: input.retryBackoff ?? "exponential",
      retryMaxDelay: input.retryMaxDelay ?? 12_000,
      rateDelayMin: input.rateDelayMin,
      rateDelayMax: input.rateDelayMax,
    });
    client.setHeaders(UBER_HEADERS);

    const jobs: JobPostDto[] = [];
    const seenIds = new Set<string>();
    let pageNumber = 0;
    let consumedResults = 0;
    let continuationExpected = false;

    try {
      while (jobs.length < resultsWanted && pageNumber < MAX_PAGES) {
        const page = await this.fetchPage(client, pageNumber);
        if (page.results.length === 0) {
          continuationExpected = false;
          break;
        }

        let newJobs = 0;
        for (const rawJob of page.results) {
          const job = this.mapToJobPost(rawJob);
          if (seenIds.has(job.id!)) continue;
          seenIds.add(job.id!);
          jobs.push(job);
          newJobs += 1;
          if (jobs.length >= resultsWanted) break;
        }

        consumedResults += page.results.length;
        if (jobs.length >= resultsWanted) break;
        continuationExpected =
          page.totalResults !== null
            ? consumedResults < page.totalResults
            : page.results.length >= PAGE_SIZE;
        if (!continuationExpected) break;
        if (newJobs === 0) {
          throw new UberSourceError(
            "SCHEMA_INVALID",
            "Uber pagination repeated a page without yielding a new job.",
          );
        }

        pageNumber += 1;
        await this.delay(REQUEST_DELAY_MS);
      }

      if (
        continuationExpected &&
        jobs.length < resultsWanted &&
        pageNumber >= MAX_PAGES - 1
      ) {
        throw new UberSourceError(
          "SCHEMA_INVALID",
          `Uber pagination exceeded the ${MAX_PAGES}-page safety limit.`,
        );
      }

      this.logger.log(`Uber: scraped ${jobs.length} jobs`);
      return new JobResponseDto(jobs);
    } catch (error: unknown) {
      const sourceError =
        error instanceof UberSourceError
          ? error
          : new UberSourceError(
              "SCHEMA_INVALID",
              `Unexpected Uber mapping failure: ${uberErrorMessage(error)}`,
              error,
            );
      this.logger.error(
        `Uber scrape failed [${sourceError.code}]: ${sourceError.message}`,
      );
      throw sourceError;
    }
  }

  private async fetchPage(
    client: ReturnType<typeof createHttpClient>,
    page: number,
  ): Promise<UberPage> {
    let rawPayload: unknown;
    try {
      const response = await client.post<unknown>(API_URL, {
        params: {
          location: [],
          department: [],
          team: [],
        },
        limit: PAGE_SIZE,
        page,
        localeCode: DEFAULT_LOCALE,
      });
      rawPayload = response.data;
    } catch (error: unknown) {
      throw new UberSourceError(
        "HTTP",
        `Uber careers request for page ${page} failed: ${uberErrorMessage(error)}`,
        error,
      );
    }

    assertJsonResponse(rawPayload);
    const root = asRecord(rawPayload);
    const data = asRecord(root?.data);
    if (!data || !Array.isArray(data.results)) {
      throw new UberSourceError(
        "SCHEMA_INVALID",
        "Uber returned an invalid response: expected data.results[].",
      );
    }

    let totalResults: number | null = null;
    if (data.totalResults !== undefined && data.totalResults !== null) {
      if (
        typeof data.totalResults !== "number" ||
        !Number.isInteger(data.totalResults) ||
        data.totalResults < 0
      ) {
        throw new UberSourceError(
          "SCHEMA_INVALID",
          "Uber returned an invalid data.totalResults value.",
        );
      }
      totalResults = data.totalResults;
    }

    return { results: data.results, totalResults };
  }

  private mapToJobPost(value: unknown): JobPostDto {
    const job = asRecord(value);
    if (!job) {
      throw new UberSourceError(
        "SCHEMA_INVALID",
        "Uber returned an invalid job: expected an object.",
      );
    }

    const title = firstString(job.title);
    if (!title) {
      throw new UberSourceError(
        "SCHEMA_INVALID",
        "Uber returned a job without a title.",
      );
    }

    const sourceId = firstIdentifier(job.id, job.job_id, job.requisition_id);
    const rawJobUrl = firstString(
      job.absolute_url,
      job.job_url,
      job.url,
    );
    if (!rawJobUrl) {
      throw new UberSourceError(
        "SCHEMA_INVALID",
        `Uber job ${sourceId ?? title} has no official detail URL.`,
      );
    }
    const jobUrl = officialUberUrl(rawJobUrl, API_URL, "detail");
    const rawApplyUrl = firstString(job.apply_url, job.applyUrl);
    const applyUrl = rawApplyUrl
      ? officialUberUrl(rawApplyUrl, jobUrl, "application")
      : jobUrl;

    const identity = sourceId ?? stableHash(jobUrl);
    const id = `uber-${identity.replace(/^uber-/i, "")}`;
    const locationLabels = collectLocationLabels(job);
    const parsedLocations = parseLocationList(locationLabels);
    const description = firstString(job.description, job.description_html);

    return new JobPostDto({
      id,
      atsId: sourceId,
      site: Site.UBER,
      title,
      companyName: "Uber",
      jobUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: parsedLocations.location,
      locations: parsedLocations.locations,
      description: description ? stripHtmlTags(description) : null,
      department: firstString(job.department, job.business_unit),
      team: firstString(job.team, job.sub_team),
      employmentType: firstString(
        job.time_type,
        job.employment_type,
        job.job_type,
      ),
      datePosted: firstString(
        job.creation_date,
        job.created_at,
        job.posted_date,
      ),
      isRemote: parsedLocations.remoteMentioned,
      workFromHomeType: parsedLocations.workFromHomeType,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function collectLocationLabels(job: JsonRecord): string[] {
  const labels: string[] = [];
  const locations = job.locations;
  if (Array.isArray(locations)) {
    for (const value of locations) {
      const label = locationLabel(value);
      if (label) labels.push(label);
    }
  } else {
    const label = locationLabel(locations);
    if (label) labels.push(label);
  }

  const primary = locationLabel(job.location);
  if (primary) labels.push(primary);
  const legacy = compoundLocation(job.city, job.region ?? job.state, job.country);
  if (legacy) labels.push(legacy);
  return uniqueStrings(labels);
}

function locationLabel(value: unknown): string | null {
  if (typeof value === "string") return normalizeWhitespace(value) || null;
  const record = asRecord(value);
  if (!record) return null;
  return (
    firstString(record.name, record.label, record.display_name) ??
    compoundLocation(
      record.city,
      record.region ?? record.state,
      record.country,
    )
  );
}

function compoundLocation(...values: unknown[]): string | null {
  const parts = values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeWhitespace)
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function officialUberUrl(value: string, base: string, kind: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch (error: unknown) {
    throw new UberSourceError(
      "SCHEMA_INVALID",
      `Uber returned an invalid ${kind} URL.`,
      error,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "uber.com" && !parsed.hostname.endsWith(".uber.com"))
  ) {
    throw new UberSourceError(
      "SCHEMA_INVALID",
      `Uber returned a non-official ${kind} URL.`,
    );
  }
  return parsed.toString();
}

function assertJsonResponse(value: unknown): void {
  if (typeof value !== "string") return;
  const text = value.slice(0, 20_000);
  if (
    /<!doctype html|<html|just a moment|verify (?:that )?you are human|access denied|request blocked|cloudflare/i.test(
      text,
    )
  ) {
    throw new UberSourceError(
      "BLOCKED",
      "Uber returned an HTML or blocking page instead of its jobs payload.",
    );
  }
  throw new UberSourceError(
    "SCHEMA_INVALID",
    "Uber returned a non-JSON jobs payload.",
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = normalizeWhitespace(value);
    if (normalized) return normalized;
  }
  return null;
}

function firstIdentifier(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalizeResultsWanted(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), MAX_RESULTS));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("en-CA");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
