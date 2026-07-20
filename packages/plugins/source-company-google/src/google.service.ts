import * as cheerio from "cheerio";
import { Injectable, Logger } from "@nestjs/common";
import {
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from "@ever-jobs/models";
import { createHttpClient, parseLocationList } from "@ever-jobs/common";
import { SourcePlugin } from "@ever-jobs/plugin";

import {
  GoogleCareersSourceError,
  googleCareersErrorMessage,
} from "./google-source.error";

const APPLICATIONS_BASE_URL =
  "https://www.google.com/about/careers/applications/";
const RESULTS_URL = `${APPLICATIONS_BASE_URL}jobs/results/`;
const DEFAULT_SEARCH_TERM = "software engineering internship OR co-op";
const PAGE_SIZE = 20;
const MAX_RESULTS = 100;
const MAX_SEARCH_PAGES = 25;
const DETAIL_CONCURRENCY = 5;

interface GoogleListingReference {
  sourceId: string;
  title: string;
  detailUrl: string;
  detailFetchUrl: string;
  locations: string[];
  employmentType: string | null;
}

interface GoogleSearchPage {
  total: number;
  listings: GoogleListingReference[];
}

@SourcePlugin({
  site: Site.GOOGLE_CAREERS,
  name: "Google Careers",
  category: "company",
  watchMode: "query",
  description:
    "Official Google Careers results/detail HTML, restricted to Canadian internships and co-ops.",
})
@Injectable()
export class GoogleCareersService implements IScraper {
  private readonly logger = new Logger(GoogleCareersService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = Math.max(
      0,
      Math.min(Math.trunc(input.resultsWanted ?? 50), MAX_RESULTS),
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

    try {
      const references = await this.collectListingReferences(
        client,
        input,
        resultsWanted,
      );
      const jobs = await this.fetchDetails(
        client,
        references.slice(0, resultsWanted),
      );

      this.logger.log(`Google Careers: scraped ${jobs.length} jobs`);
      return new JobResponseDto(jobs);
    } catch (error: unknown) {
      const sourceError =
        error instanceof GoogleCareersSourceError
          ? error
          : new GoogleCareersSourceError(
              "SCHEMA_INVALID",
              `Unexpected Google Careers mapping failure: ${googleCareersErrorMessage(error)}`,
              error,
            );
      this.logger.error(
        `Google Careers scrape failed [${sourceError.code}]: ${sourceError.message}`,
      );
      throw sourceError;
    }
  }

  private async collectListingReferences(
    client: ReturnType<typeof createHttpClient>,
    input: ScraperInputDto,
    resultsWanted: number,
  ): Promise<GoogleListingReference[]> {
    const references: GoogleListingReference[] = [];
    const seen = new Set<string>();
    let total = Number.POSITIVE_INFINITY;

    for (
      let page = 1;
      page <= MAX_SEARCH_PAGES && references.length < resultsWanted;
      page++
    ) {
      const url = this.buildSearchUrl(input.searchTerm, input.location, page);
      const html = await this.fetchHtml(client, url, `results page ${page}`);
      const parsed = this.parseSearchPage(html, url);
      total = parsed.total;

      for (const listing of parsed.listings) {
        if (!isInternshipOrCoop(listing)) continue;
        if (seen.has(listing.sourceId)) continue;
        seen.add(listing.sourceId);
        references.push(listing);
        if (references.length >= resultsWanted) break;
      }

      const exhaustedUpstream = page * PAGE_SIZE >= total;
      if (exhaustedUpstream || parsed.listings.length === 0) break;
    }

    return references;
  }

  private buildSearchUrl(
    searchTerm: string | undefined,
    requestedLocation: string | undefined,
    page: number,
  ): string {
    const params = new URLSearchParams({
      q: searchTerm?.trim() || DEFAULT_SEARCH_TERM,
      location: validatedCanadianSearchLocation(requestedLocation),
      target_level: "INTERN_AND_APPRENTICE",
      hl: "en",
      page: String(page),
    });
    return `${RESULTS_URL}?${params.toString()}`;
  }

  private parseSearchPage(html: string, url: string): GoogleSearchPage {
    this.assertNotBlocked(html, url);
    const $ = cheerio.load(html);
    const pageText = normalizeWhitespace($("body").text());

    if (!/jobs search results/i.test(pageText)) {
      throw new GoogleCareersSourceError(
        "MARKUP_CHANGED",
        'Google Careers results marker "Jobs search results" is missing.',
      );
    }

    const countMatch = /([\d,]+)\s+jobs?\s+matched/i.exec(pageText);
    if (!countMatch) {
      throw new GoogleCareersSourceError(
        "MARKUP_CHANGED",
        "Google Careers result-count marker is missing.",
      );
    }
    const total = Number.parseInt(countMatch[1].replace(/,/g, ""), 10);
    if (!Number.isFinite(total) || total < 0) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers returned an invalid result count: ${countMatch[1]}.`,
      );
    }

    const listings: GoogleListingReference[] = [];
    const cards = $("li.lLd3Je").length
      ? $("li.lLd3Je")
      : $("li").has('a[href*="jobs/results/"]');
    if (total > 0 && cards.length === 0) {
      throw new GoogleCareersSourceError(
        "MARKUP_CHANGED",
        `Google Careers reported ${total} matching jobs but no result cards could be parsed.`,
      );
    }

    cards.each((_index, element) => {
      const card = $(element);
      const href = card.find('a[href*="jobs/results/"]').first().attr("href");
      const ssk = card.attr("ssk") ?? "";
      const hrefId = href?.match(/jobs\/results\/(\d+)(?:-|\/|\?|$)/)?.[1];
      const sourceId = ssk.match(/:(\d+)$/)?.[1] ?? hrefId;
      const title = normalizeWhitespace(
        card.find("h3.QJPWVe").first().text() ||
          card
            .find('a[aria-label^="Learn more about "]')
            .first()
            .attr("aria-label")
            ?.replace(/^Learn more about\s+/i, "") ||
          "",
      );

      if (!sourceId || !href || !title) {
        throw new GoogleCareersSourceError(
          "SCHEMA_INVALID",
          "A Google Careers result card is missing its stable ID, detail URL, or title.",
        );
      }

      const detailFetchUrl = this.resolveResultsHref(href);
      const canonical = new URL(detailFetchUrl);
      canonical.search = "";
      canonical.hash = "";

      const locations = uniqueStrings(
        card
          .find(".wVoYLb span.r0wTof")
          .map((_locationIndex, locationElement) =>
            cleanLocationLabel($(locationElement).text()),
          )
          .get(),
      );
      const employmentType =
        normalizeWhitespace(
          card.find(".RP7SMd").last().find("span").last().text() ||
            card.find(".RP7SMd").last().text(),
        ) || null;

      listings.push({
        sourceId,
        title,
        detailUrl: canonical.toString(),
        detailFetchUrl,
        locations,
        employmentType,
      });
    });

    return { total, listings };
  }

  private async fetchDetails(
    client: ReturnType<typeof createHttpClient>,
    references: GoogleListingReference[],
  ): Promise<JobPostDto[]> {
    const jobs: JobPostDto[] = [];

    for (
      let start = 0;
      start < references.length;
      start += DETAIL_CONCURRENCY
    ) {
      const batch = references.slice(start, start + DETAIL_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (reference) => {
          const html = await this.fetchHtml(
            client,
            reference.detailFetchUrl,
            `detail ${reference.sourceId}`,
          );
          return this.parseDetailPage(html, reference);
        }),
      );

      const failure = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;

      jobs.push(
        ...settled.map(
          (result) => (result as PromiseFulfilledResult<JobPostDto>).value,
        ),
      );
    }

    return jobs;
  }

  private parseDetailPage(
    html: string,
    reference: GoogleListingReference,
  ): JobPostDto {
    this.assertNotBlocked(html, reference.detailFetchUrl);
    const $ = cheerio.load(html);
    const detailRoot = $(`main [data-id="${reference.sourceId}"]`).first();
    const root = detailRoot.length ? detailRoot : $("main .DkhPwc").first();

    if (!root.length) {
      throw new GoogleCareersSourceError(
        "MARKUP_CHANGED",
        `Google Careers detail marker is missing for ${reference.sourceId}.`,
      );
    }

    const title = normalizeWhitespace(root.find("h2.p1N2lc").first().text());
    if (!title || title !== reference.title) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers detail title does not match result ${reference.sourceId}.`,
      );
    }

    const applyHref = root
      .find("#apply-action-button[href]")
      .first()
      .attr("href");
    if (!applyHref) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers detail ${reference.sourceId} has no official application URL.`,
      );
    }
    const applyUrl = new URL(applyHref, reference.detailFetchUrl).toString();
    this.assertOfficialGoogleUrl(applyUrl, "application");

    const detailLocations: string[] = [];
    root.find(".op1BBf span.r0wTof").each((_index, element) => {
      detailLocations.push(cleanLocationLabel($(element).text()));
    });
    root.find(".KwJkGe b").each((_index, element) => {
      const advertised = normalizeWhitespace($(element).text());
      if (!/\bCanada\b/i.test(advertised)) return;
      detailLocations.push(...advertised.split(/\s*;\s*/));
    });

    const locationLabels = uniqueStrings([
      ...detailLocations,
      ...reference.locations,
    ]);
    if (locationLabels.length === 0) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers detail ${reference.sourceId} has no advertised locations.`,
      );
    }
    const parsedLocations = parseLocationList(locationLabels);

    const description = normalizeWhitespace(
      $('meta[name="description"]').attr("content") ||
        root.find(".KwJkGe, .aG5W3, .BDNOWe").text(),
    );
    if (!description) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers detail ${reference.sourceId} has no job description.`,
      );
    }

    const datePosted = this.extractDatePosted($, reference.sourceId);
    const isRemote =
      parsedLocations.remoteMentioned ||
      /\bremote eligible\b/i.test(normalizeWhitespace(root.text()));

    return new JobPostDto({
      id: `google-careers-${reference.sourceId}`,
      site: Site.GOOGLE_CAREERS,
      title,
      companyName: "Google",
      jobUrl: reference.detailUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: parsedLocations.location,
      locations: parsedLocations.locations,
      description,
      datePosted,
      isRemote,
      workFromHomeType: parsedLocations.workFromHomeType,
      employmentType: reference.employmentType,
    });
  }

  private extractDatePosted(
    $: cheerio.CheerioAPI,
    sourceId: string,
  ): string | null {
    const raw =
      $(
        'meta[name="datePosted"], meta[name="date-posted"], meta[itemprop="datePosted"]',
      )
        .first()
        .attr("content") ??
      $("time[data-date-posted][datetime], time.date-posted[datetime]")
        .first()
        .attr("datetime");
    if (!raw) return null;

    const normalized = normalizeExplicitDate(raw);
    if (!normalized) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers detail ${sourceId} exposed an invalid publication date.`,
      );
    }
    return normalized;
  }

  private resolveResultsHref(href: string): string {
    const resolved = href.startsWith("jobs/results/")
      ? new URL(href, APPLICATIONS_BASE_URL)
      : new URL(href, RESULTS_URL);
    this.assertOfficialGoogleUrl(resolved.toString(), "detail");
    return resolved.toString();
  }

  private assertOfficialGoogleUrl(url: string, kind: string): void {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !["www.google.com", "careers.google.com"].includes(parsed.hostname)
    ) {
      throw new GoogleCareersSourceError(
        "SCHEMA_INVALID",
        `Google Careers returned a non-official ${kind} URL.`,
      );
    }
  }

  private async fetchHtml(
    client: ReturnType<typeof createHttpClient>,
    url: string,
    label: string,
  ): Promise<string> {
    try {
      const response = await client.get<string>(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      if (typeof response.data !== "string") {
        throw new GoogleCareersSourceError(
          "SCHEMA_INVALID",
          `Google Careers ${label} did not return HTML.`,
        );
      }
      return response.data;
    } catch (error: unknown) {
      if (error instanceof GoogleCareersSourceError) throw error;
      throw new GoogleCareersSourceError(
        "HTTP",
        `Google Careers ${label} request failed: ${googleCareersErrorMessage(error)}`,
        error,
      );
    }
  }

  private assertNotBlocked(html: string, url: string): void {
    const $ = cheerio.load(html);
    const signalText = normalizeWhitespace(
      `${$("title").text()} ${$("body").text().slice(0, 20_000)}`,
    );
    if (
      /our systems have detected unusual traffic|verify (?:that )?you are human|before you continue to google|access denied|automated queries/i.test(
        signalText,
      ) ||
      $('form[action*="Captcha"], form[action*="sorry/index"]').length > 0
    ) {
      throw new GoogleCareersSourceError(
        "BLOCKED",
        `Google Careers returned a blocking or consent page for ${new URL(url).pathname}.`,
      );
    }
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanLocationLabel(value: string): string {
  return normalizeWhitespace(value).replace(/^;+\s*/, "");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = cleanLocationLabel(value);
    const key = normalized.toLocaleLowerCase("en-CA");
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function normalizeExplicitDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp)
    ? null
    : new Date(timestamp).toISOString().slice(0, 10);
}

function isInternshipOrCoop(listing: GoogleListingReference): boolean {
  if (/\bapprentice(?:ship)?\b/i.test(listing.title)) return false;
  return /\bintern(?:ship)?\b|\bco[\s-]?op\b/i.test(
    `${listing.title} ${listing.employmentType ?? ""}`,
  );
}

function validatedCanadianSearchLocation(
  requested: string | undefined,
): string {
  const normalized = normalizeWhitespace(requested ?? "");
  if (!normalized) return "Canada";

  const parsed = parseLocationList([normalized]);
  const locations = [
    ...parsed.locations,
    ...(parsed.location ? [parsed.location] : []),
  ];
  return locations.some(
    (location) =>
      typeof location.country === "string" &&
      location.country.toLocaleLowerCase("en-CA") === "canada",
  )
    ? normalized
    : "Canada";
}
