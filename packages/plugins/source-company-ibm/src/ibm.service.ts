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

import { IBM_CAREERS_URL, IBM_JOB_BASE_URL } from "./ibm.constants";
import { IbmSourceError, ibmErrorMessage } from "./ibm-source.error";

const DEFAULT_RESULTS = 50;
const MAX_RESULTS = 1_000;
const MAX_PAGES = 100;

type JsonRecord = Record<string, unknown>;

interface IbmPage {
  jobs: unknown[];
  totalPages: number | null;
  totalResults: number | null;
  pageSize: number | null;
  hasNext: boolean | null;
}

@SourcePlugin({
  site: Site.IBM,
  name: "IBM",
  category: "company",
  watchMode: "board",
  description: "Official paginated IBM careers board.",
})
@Injectable()
export class IbmService implements IScraper {
  private readonly logger = new Logger(IbmService.name);

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
    client.setHeaders({ Accept: "text/html,application/xhtml+xml" });

    const jobs: JobPostDto[] = [];
    const seenIds = new Set<string>();
    let pageNumber = 0;
    let consumedResults = 0;
    let continuationExpected = false;

    try {
      while (jobs.length < resultsWanted && pageNumber < MAX_PAGES) {
        const page = await this.fetchPage(client, pageNumber);
        if (page.jobs.length === 0) {
          continuationExpected = false;
          break;
        }

        let newJobs = 0;
        for (const rawJob of page.jobs) {
          const job = this.mapToJobPost(rawJob);
          if (seenIds.has(job.id!)) continue;
          seenIds.add(job.id!);
          jobs.push(job);
          newJobs += 1;
          if (jobs.length >= resultsWanted) break;
        }

        consumedResults += page.jobs.length;
        continuationExpected = this.hasAnotherPage(
          page,
          pageNumber,
          consumedResults,
        );
        if (jobs.length >= resultsWanted || !continuationExpected) break;
        if (newJobs === 0) {
          throw new IbmSourceError(
            "SCHEMA_INVALID",
            "IBM pagination repeated a page without yielding a new job.",
          );
        }
        pageNumber += 1;
      }

      if (
        continuationExpected &&
        jobs.length < resultsWanted &&
        pageNumber >= MAX_PAGES - 1
      ) {
        throw new IbmSourceError(
          "SCHEMA_INVALID",
          `IBM pagination exceeded the ${MAX_PAGES}-page safety limit.`,
        );
      }

      this.logger.log(`IBM: scraped ${jobs.length} jobs`);
      return new JobResponseDto(jobs);
    } catch (error: unknown) {
      const sourceError =
        error instanceof IbmSourceError
          ? error
          : new IbmSourceError(
              "SCHEMA_INVALID",
              `Unexpected IBM mapping failure: ${ibmErrorMessage(error)}`,
              error,
            );
      this.logger.error(
        `IBM scrape failed [${sourceError.code}]: ${sourceError.message}`,
      );
      throw sourceError;
    }
  }

  private async fetchPage(
    client: ReturnType<typeof createHttpClient>,
    pageNumber: number,
  ): Promise<IbmPage> {
    const url = new URL(IBM_CAREERS_URL);
    url.searchParams.set("page", String(pageNumber));

    let html: unknown;
    try {
      const response = await client.get<unknown>(url.toString());
      html = response.data;
    } catch (error: unknown) {
      throw new IbmSourceError(
        "HTTP",
        `IBM careers request for page ${pageNumber} failed: ${ibmErrorMessage(error)}`,
        error,
      );
    }

    if (typeof html !== "string") {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM careers did not return an HTML document.",
      );
    }
    this.assertHealthyPage(html);
    return this.extractPage(html);
  }

  private extractPage(html: string): IbmPage {
    const dataMatch =
      /<script[^>]*\bid=(?:"__NEXT_DATA__"|'__NEXT_DATA__')[^>]*>([\s\S]*?)<\/script>/i.exec(
        html,
      );
    if (!dataMatch?.[1]) {
      if (hasValidatedEmptyMarker(html)) return emptyPage();
      throw new IbmSourceError(
        "MARKUP_CHANGED",
        "IBM careers page is missing its __NEXT_DATA__ jobs payload.",
      );
    }

    let nextData: unknown;
    try {
      nextData = JSON.parse(dataMatch[1]);
    } catch (error: unknown) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        `IBM careers returned malformed __NEXT_DATA__: ${ibmErrorMessage(error)}`,
        error,
      );
    }

    const root = asRecord(nextData);
    const props = asRecord(root?.props);
    const pageProps = asRecord(props?.pageProps);
    if (!pageProps) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM careers returned an invalid __NEXT_DATA__ pageProps object.",
      );
    }

    const searchResults =
      asRecord(pageProps.searchResults) ??
      asRecord(pageProps.jobSearch) ??
      asRecord(pageProps.initialState);
    const jobsValue = firstDefined(
      pageProps.jobs,
      pageProps.initialJobs,
      searchResults?.jobs,
      searchResults?.results,
    );
    if (jobsValue === undefined) {
      if (hasValidatedEmptyMarker(html)) return emptyPage();
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM careers returned an invalid payload: expected a jobs collection.",
      );
    }
    if (!Array.isArray(jobsValue)) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM careers returned an invalid payload: expected jobs[].",
      );
    }

    const pagination =
      asRecord(pageProps.pagination) ?? asRecord(searchResults?.pagination);
    const totalPages = optionalNonNegativeInteger(
      pageProps.totalPages,
      pageProps.pageCount,
      searchResults?.totalPages,
      searchResults?.pageCount,
      pagination?.totalPages,
      pagination?.pageCount,
    );
    const totalResults = optionalNonNegativeInteger(
      pageProps.totalResults,
      pageProps.total,
      searchResults?.totalResults,
      searchResults?.total,
      pagination?.totalResults,
      pagination?.total,
    );
    const pageSize = optionalNonNegativeInteger(
      pageProps.pageSize,
      searchResults?.pageSize,
      pagination?.pageSize,
    );
    const hasNext = optionalBoolean(
      pageProps.hasNextPage,
      pageProps.hasNext,
      searchResults?.hasNextPage,
      searchResults?.hasNext,
      pagination?.hasNextPage,
      pagination?.hasNext,
    );

    return {
      jobs: jobsValue,
      totalPages,
      totalResults,
      pageSize,
      hasNext,
    };
  }

  private hasAnotherPage(
    page: IbmPage,
    pageNumber: number,
    consumedResults: number,
  ): boolean {
    if (page.hasNext !== null) return page.hasNext;
    if (page.totalPages !== null) return pageNumber + 1 < page.totalPages;
    if (page.totalResults !== null) return consumedResults < page.totalResults;
    if (page.pageSize !== null && page.pageSize > 0) {
      return page.jobs.length >= page.pageSize;
    }
    return page.jobs.length > 0;
  }

  private mapToJobPost(value: unknown): JobPostDto {
    const listing = asRecord(value);
    if (!listing) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM returned an invalid job: expected an object.",
      );
    }

    const title = firstString(listing.title, listing.name);
    if (!title) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        "IBM returned a job without a title.",
      );
    }
    const sourceId = firstIdentifier(
      listing.id,
      listing.req_id,
      listing.requisition_id,
      listing.job_id,
    );
    const rawJobUrl = firstString(
      listing.url,
      listing.job_url,
      listing.jobUrl,
    );
    if (!rawJobUrl && !sourceId) {
      throw new IbmSourceError(
        "SCHEMA_INVALID",
        `IBM job ${title} has neither an ID nor a detail URL.`,
      );
    }
    const jobUrl = officialIbmUrl(
      rawJobUrl ?? `${IBM_JOB_BASE_URL}/${encodeURIComponent(sourceId!)}`,
      IBM_CAREERS_URL,
      "detail",
    );
    const rawApplyUrl = firstString(
      listing.apply_url,
      listing.applyUrl,
      listing.application_url,
    );
    const applyUrl = rawApplyUrl
      ? officialIbmUrl(rawApplyUrl, jobUrl, "application")
      : jobUrl;
    const identity = sourceId ?? stableHash(jobUrl);
    const id = `ibm-${identity.replace(/^ibm-/i, "")}`;
    const parsedLocations = parseLocationList(collectLocationLabels(listing));
    const description = firstString(
      listing.description,
      listing.description_html,
      listing.summary,
    );

    return new JobPostDto({
      id,
      atsId: sourceId,
      site: Site.IBM,
      title,
      companyName: "IBM",
      jobUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: parsedLocations.location,
      locations: parsedLocations.locations,
      description: description ? stripHtmlTags(description) : null,
      datePosted: firstString(
        listing.posted_date,
        listing.date_posted,
        listing.created_at,
      ),
      isRemote: parsedLocations.remoteMentioned,
      workFromHomeType: parsedLocations.workFromHomeType,
      department: firstString(listing.team, listing.department),
      employmentType: firstString(
        listing.employment_type,
        listing.employmentType,
        listing.job_type,
      ),
    });
  }

  private assertHealthyPage(html: string): void {
    const signal = stripHtmlTags(html.slice(0, 100_000));
    if (
      /just a moment|verify (?:that )?you are human|access denied|request blocked|attention required.*cloudflare/i.test(
        signal,
      )
    ) {
      throw new IbmSourceError(
        "BLOCKED",
        "IBM careers returned a blocking page.",
      );
    }
    if (
      /search function is temporarily unavailable|service (?:is )?temporarily unavailable|please wait (?:a few minutes )?and try again/i.test(
        signal,
      )
    ) {
      throw new IbmSourceError(
        "MARKUP_CHANGED",
        "IBM careers reported that job search is temporarily unavailable.",
      );
    }
  }
}

function collectLocationLabels(listing: JsonRecord): string[] {
  const labels: string[] = [];
  if (Array.isArray(listing.locations)) {
    for (const value of listing.locations) {
      const label = locationLabel(value);
      if (label) labels.push(label);
    }
  }
  const primary = locationLabel(listing.location);
  if (primary) labels.push(primary);
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

function officialIbmUrl(value: string, base: string, kind: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch (error: unknown) {
    throw new IbmSourceError(
      "SCHEMA_INVALID",
      `IBM returned an invalid ${kind} URL.`,
      error,
    );
  }
  const officialHost =
    parsed.hostname === "ibm.com" ||
    parsed.hostname.endsWith(".ibm.com") ||
    parsed.hostname === "ibmglobal.avature.net" ||
    parsed.hostname.endsWith(".ibmglobal.avature.net");
  if (parsed.protocol !== "https:" || !officialHost) {
    throw new IbmSourceError(
      "SCHEMA_INVALID",
      `IBM returned a non-official ${kind} URL.`,
    );
  }
  return parsed.toString();
}

function hasValidatedEmptyMarker(html: string): boolean {
  const signal = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const boardMarker = /search jobs|job search|open positions/i.test(signal);
  const emptyMarker =
    /\b0\s+(?:results|jobs|openings|items)\b|\b1\s*[\u2013-]\s*0\s+of\s+0\s+items\b|\bno\s+(?:jobs|positions|openings)\s+(?:found|available)\b/i.test(
      signal,
    );
  return boardMarker && emptyMarker;
}

function emptyPage(): IbmPage {
  return {
    jobs: [],
    totalPages: 0,
    totalResults: 0,
    pageSize: null,
    hasNext: false,
  };
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
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
    throw new IbmSourceError(
      "SCHEMA_INVALID",
      "IBM returned invalid pagination metadata.",
    );
  }
  return defined;
}

function optionalBoolean(...values: unknown[]): boolean | null {
  const defined = values.find((value) => value !== undefined && value !== null);
  if (defined === undefined) return null;
  if (typeof defined !== "boolean") {
    throw new IbmSourceError(
      "SCHEMA_INVALID",
      "IBM returned invalid pagination metadata.",
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
