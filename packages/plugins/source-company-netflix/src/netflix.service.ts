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

import {
  NetflixSourceError,
  netflixErrorMessage,
} from "./netflix-source.error";

const API_URL = "https://jobs.netflix.com/api/search";
const CAREERS_BASE = "https://jobs.netflix.com/jobs/";
const DEFAULT_RESULTS = 50;
const MAX_RESULTS = 1_000;
const MAX_PAGES = 100;

type JsonRecord = Record<string, unknown>;

interface NetflixPage {
  postings: unknown[];
  totalPages: number | null;
  totalResults: number | null;
  hasNext: boolean | null;
}

@SourcePlugin({
  site: Site.NETFLIX,
  name: "Netflix",
  category: "company",
  watchMode: "board",
  description: "Official paginated Netflix careers board.",
})
@Injectable()
export class NetflixService implements IScraper {
  private readonly logger = new Logger(NetflixService.name);

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
    client.setHeaders({ Accept: "application/json" });

    const jobs: JobPostDto[] = [];
    const seenIds = new Set<string>();
    let pageNumber = 1;
    let consumedResults = 0;
    let continuationExpected = false;

    try {
      while (jobs.length < resultsWanted && pageNumber <= MAX_PAGES) {
        const page = await this.fetchPage(client, pageNumber);
        if (page.postings.length === 0) {
          continuationExpected = false;
          break;
        }

        let newJobs = 0;
        for (const rawPosting of page.postings) {
          const job = this.mapToJobPost(rawPosting);
          if (seenIds.has(job.id!)) continue;
          seenIds.add(job.id!);
          jobs.push(job);
          newJobs += 1;
          if (jobs.length >= resultsWanted) break;
        }

        consumedResults += page.postings.length;
        continuationExpected = this.hasAnotherPage(
          page,
          pageNumber,
          consumedResults,
        );
        if (jobs.length >= resultsWanted || !continuationExpected) break;
        if (newJobs === 0) {
          throw new NetflixSourceError(
            "SCHEMA_INVALID",
            "Netflix pagination repeated a page without yielding a new job.",
          );
        }
        pageNumber += 1;
      }

      if (
        continuationExpected &&
        jobs.length < resultsWanted &&
        pageNumber >= MAX_PAGES
      ) {
        throw new NetflixSourceError(
          "SCHEMA_INVALID",
          `Netflix pagination exceeded the ${MAX_PAGES}-page safety limit.`,
        );
      }

      this.logger.log(`Netflix: scraped ${jobs.length} jobs`);
      return new JobResponseDto(jobs);
    } catch (error: unknown) {
      const sourceError =
        error instanceof NetflixSourceError
          ? error
          : new NetflixSourceError(
              "SCHEMA_INVALID",
              `Unexpected Netflix mapping failure: ${netflixErrorMessage(error)}`,
              error,
            );
      this.logger.error(
        `Netflix scrape failed [${sourceError.code}]: ${sourceError.message}`,
      );
      throw sourceError;
    }
  }

  private async fetchPage(
    client: ReturnType<typeof createHttpClient>,
    pageNumber: number,
  ): Promise<NetflixPage> {
    const url = new URL(API_URL);
    url.searchParams.set("page", String(pageNumber));

    let rawPayload: unknown;
    try {
      const response = await client.get<unknown>(url.toString());
      rawPayload = response.data;
    } catch (error: unknown) {
      throw new NetflixSourceError(
        "HTTP",
        `Netflix careers request for page ${pageNumber} failed: ${netflixErrorMessage(error)}`,
        error,
      );
    }

    assertJsonResponse(rawPayload);
    const root = asRecord(rawPayload);
    const records = asRecord(root?.records);
    const postings = Array.isArray(records?.postings)
      ? records.postings
      : Array.isArray(root?.postings)
        ? root.postings
        : null;
    if (!postings) {
      throw new NetflixSourceError(
        "SCHEMA_INVALID",
        "Netflix returned an invalid response: expected records.postings[] or postings[].",
      );
    }

    const info = asRecord(root?.info);
    const postingInfo = asRecord(info?.postings);
    const pagination = asRecord(root?.pagination) ?? asRecord(records?.pagination);
    const totalPages = optionalNonNegativeInteger(
      records?.total_pages,
      records?.totalPages,
      root?.total_pages,
      root?.totalPages,
      postingInfo?.num_pages,
      postingInfo?.total_pages,
      pagination?.total_pages,
      pagination?.totalPages,
    );
    const totalResults = optionalNonNegativeInteger(
      records?.total,
      records?.total_results,
      root?.total,
      root?.total_results,
      postingInfo?.total,
      pagination?.total,
    );
    const hasNext = optionalBoolean(
      records?.has_next,
      records?.hasNext,
      root?.has_next,
      root?.hasNext,
      postingInfo?.has_next,
      pagination?.has_next,
      pagination?.hasNext,
    );

    return { postings, totalPages, totalResults, hasNext };
  }

  private hasAnotherPage(
    page: NetflixPage,
    pageNumber: number,
    consumedResults: number,
  ): boolean {
    if (page.hasNext !== null) return page.hasNext;
    if (page.totalPages !== null) return pageNumber < page.totalPages;
    if (page.totalResults !== null) return consumedResults < page.totalResults;
    return page.postings.length > 0;
  }

  private mapToJobPost(value: unknown): JobPostDto {
    const posting = asRecord(value);
    if (!posting) {
      throw new NetflixSourceError(
        "SCHEMA_INVALID",
        "Netflix returned an invalid posting: expected an object.",
      );
    }

    const title = firstString(posting.text, posting.title, posting.name);
    if (!title) {
      throw new NetflixSourceError(
        "SCHEMA_INVALID",
        "Netflix returned a posting without a title.",
      );
    }
    const sourceId = firstIdentifier(
      posting.external_id,
      posting.externalId,
      posting.id,
      posting.job_id,
    );
    const rawJobUrl = firstString(posting.url, posting.job_url, posting.jobUrl);
    if (!rawJobUrl && !sourceId) {
      throw new NetflixSourceError(
        "SCHEMA_INVALID",
        `Netflix posting ${title} has neither an ID nor a detail URL.`,
      );
    }
    const jobUrl = officialNetflixUrl(
      rawJobUrl ?? `${CAREERS_BASE}${encodeURIComponent(sourceId!)}`,
      API_URL,
      "detail",
    );
    const rawApplyUrl = firstString(
      posting.apply_url,
      posting.applyUrl,
      posting.external_apply_url,
    );
    const applyUrl = rawApplyUrl
      ? officialNetflixUrl(rawApplyUrl, jobUrl, "application")
      : jobUrl;
    const identity = sourceId ?? stableHash(jobUrl);
    const id = `netflix-${identity.replace(/^netflix-/i, "")}`;

    const parsedLocations = parseLocationList(collectLocationLabels(posting));
    const description = firstString(
      posting.description,
      posting.description_html,
      posting.content,
    );

    return new JobPostDto({
      id,
      atsId: sourceId,
      site: Site.NETFLIX,
      title,
      companyName: "Netflix",
      jobUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: parsedLocations.location,
      locations: parsedLocations.locations,
      description: description ? stripHtmlTags(description) : null,
      datePosted: firstString(
        posting.created_at,
        posting.date_posted,
        posting.posted_at,
        posting.updated_at,
      ),
      isRemote: parsedLocations.remoteMentioned,
      workFromHomeType: parsedLocations.workFromHomeType,
      department: firstString(
        posting.team,
        posting.organization,
        posting.department,
      ),
      employmentType: firstString(
        posting.employment_type,
        posting.employmentType,
        posting.type,
      ),
    });
  }
}

function collectLocationLabels(posting: JsonRecord): string[] {
  const labels: string[] = [];
  if (Array.isArray(posting.locations)) {
    for (const value of posting.locations) {
      const label = locationLabel(value);
      if (label) labels.push(label);
    }
  }
  for (const value of [posting.location, posting.location_string]) {
    const label = locationLabel(value);
    if (label) labels.push(label);
  }
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

function officialNetflixUrl(value: string, base: string, kind: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch (error: unknown) {
    throw new NetflixSourceError(
      "SCHEMA_INVALID",
      `Netflix returned an invalid ${kind} URL.`,
      error,
    );
  }
  const officialHost =
    parsed.hostname === "netflix.com" ||
    parsed.hostname.endsWith(".netflix.com") ||
    parsed.hostname === "netflix.net" ||
    parsed.hostname.endsWith(".netflix.net");
  if (parsed.protocol !== "https:" || !officialHost) {
    throw new NetflixSourceError(
      "SCHEMA_INVALID",
      `Netflix returned a non-official ${kind} URL.`,
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
    throw new NetflixSourceError(
      "BLOCKED",
      "Netflix returned an HTML or blocking page instead of its jobs payload.",
    );
  }
  throw new NetflixSourceError(
    "SCHEMA_INVALID",
    "Netflix returned a non-JSON jobs payload.",
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

function optionalNonNegativeInteger(...values: unknown[]): number | null {
  const defined = values.find((value) => value !== undefined && value !== null);
  if (defined === undefined) return null;
  if (
    typeof defined !== "number" ||
    !Number.isInteger(defined) ||
    defined < 0
  ) {
    throw new NetflixSourceError(
      "SCHEMA_INVALID",
      "Netflix returned invalid pagination metadata.",
    );
  }
  return defined;
}

function optionalBoolean(...values: unknown[]): boolean | null {
  const defined = values.find((value) => value !== undefined && value !== null);
  if (defined === undefined) return null;
  if (typeof defined !== "boolean") {
    throw new NetflixSourceError(
      "SCHEMA_INVALID",
      "Netflix returned invalid pagination metadata.",
    );
  }
  return defined;
}

function normalizeResultsWanted(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
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
