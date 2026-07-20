import * as cheerio from "cheerio";
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
  htmlToPlainText,
  parseLocationList,
} from "@ever-jobs/common";
import { SourcePlugin } from "@ever-jobs/plugin";

import {
  ShopifySourceError,
  shopifyErrorMessage,
} from "./shopify-source.error";

const SHOPIFY_CAREERS_URL = "https://www.shopify.com/careers";
const MAX_RESULTS = 100;
const DETAIL_CONCURRENCY = 5;
const PUBLIC_JID_PATTERN =
  /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;
const INTERNSHIP_PATTERN = /\b(?:intern(?:ship)?|co[\s-]?op)\b/i;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
const ENGINEERING_DISCIPLINE_PATTERN =
  /\b(?:software|engineer(?:ing)?|develop(?:er|ment)|back[ -]?end|front[ -]?end|full[ -]?stack|mobile|ios|android|developer experience|\bdx\b|platform|cloud|infrastructure|site reliability|\bsre\b|devops|security|data engineer(?:ing)?|machine learning|\bml\b|artificial intelligence|\bai\b)\b/i;

interface ShopifyListingReference {
  publicJid: string;
  title: string;
  detailUrl: string;
  locationLabel: string;
  department: string | null;
}

type JsonRecord = Record<string, unknown>;

@SourcePlugin({
  site: Site.SHOPIFY,
  name: "Shopify",
  category: "company",
  watchMode: "board",
  description:
    "Official Shopify server-rendered careers board and public job-detail route payload.",
})
@Injectable()
export class ShopifyService implements IScraper {
  private readonly logger = new Logger(ShopifyService.name);

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
      const boardHtml = await this.fetchHtml(
        client,
        SHOPIFY_CAREERS_URL,
        "careers board",
      );
      const listings = this.parseBoard(boardHtml);
      const candidates = listings.filter(
        (listing) =>
          INTERNSHIP_PATTERN.test(listing.title) ||
          ENGINEERING_DISCIPLINE_PATTERN.test(listing.department ?? ""),
      );
      const jobs = await this.fetchQualifyingDetails(
        client,
        candidates,
        resultsWanted,
      );

      this.logger.log(`Shopify: scraped ${jobs.length} qualifying internships`);
      return new JobResponseDto(jobs);
    } catch (error: unknown) {
      const sourceError =
        error instanceof ShopifySourceError
          ? error
          : new ShopifySourceError(
              "SCHEMA_INVALID",
              `Unexpected Shopify mapping failure: ${shopifyErrorMessage(error)}`,
              error,
            );
      this.logger.error(
        `Shopify scrape failed [${sourceError.code}]: ${sourceError.message}`,
      );
      throw sourceError;
    }
  }

  private parseBoard(html: string): ShopifyListingReference[] {
    this.assertNotBlocked(html, SHOPIFY_CAREERS_URL);
    const $ = cheerio.load(html);
    const pageText = normalizeWhitespace($("body").text());
    if (!/find your quest/i.test(pageText) || !/job postings/i.test(pageText)) {
      throw new ShopifySourceError(
        "MARKUP_CHANGED",
        "Shopify careers board markers are missing.",
      );
    }

    const anchors = $("a.compact-list-layout");
    const listings: ShopifyListingReference[] = [];
    anchors.each((_index, element) => {
      const anchor = $(element);
      const href = anchor.attr("href") ?? "";
      const publicJid = PUBLIC_JID_PATTERN.exec(href)?.[1]?.toLowerCase();
      const title = normalizeWhitespace(anchor.find("h4").first().text());
      const locationLabel = normalizeWhitespace(
        anchor.find(".location span").first().text() ||
          anchor.find(".location").first().text(),
      );

      if (!publicJid || !title || !locationLabel) {
        throw new ShopifySourceError(
          "SCHEMA_INVALID",
          "A Shopify careers card is missing its public JID, title, or location.",
        );
      }

      const detailUrl = new URL(href, SHOPIFY_CAREERS_URL).toString();
      this.assertOfficialShopifyUrl(detailUrl, "detail");
      const departmentContainer = anchor.closest('[id^="accordionBody_"]');
      const department = normalizeWhitespace(
        departmentContainer.attr("data-department") ||
          departmentContainer
            .attr("id")
            ?.replace(/^accordionBody_/, "")
            .replace(/[_-]+/g, " ") ||
          "",
      );

      listings.push({
        publicJid,
        title,
        detailUrl,
        locationLabel,
        department: department || null,
      });
    });

    return listings;
  }

  private async fetchQualifyingDetails(
    client: ReturnType<typeof createHttpClient>,
    candidates: ShopifyListingReference[],
    resultsWanted: number,
  ): Promise<JobPostDto[]> {
    const jobs: JobPostDto[] = [];

    for (
      let start = 0;
      start < candidates.length;
      start += DETAIL_CONCURRENCY
    ) {
      const batch = candidates.slice(start, start + DETAIL_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (reference) => {
          const html = await this.fetchHtml(
            client,
            reference.detailUrl,
            `detail ${reference.publicJid}`,
          );
          return this.parseDetailPage(html, reference);
        }),
      );

      const failure = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;

      for (const result of settled) {
        const job = (result as PromiseFulfilledResult<JobPostDto>).value;
        if (!this.isQualifyingInternship(job)) continue;
        jobs.push(job);
        if (jobs.length >= resultsWanted) return jobs;
      }
    }

    return jobs;
  }

  private parseDetailPage(
    html: string,
    reference: ShopifyListingReference,
  ): JobPostDto {
    this.assertNotBlocked(html, reference.detailUrl);
    const posting = this.extractPublicPosting(html);
    const linkedData = asRecord(posting.linkedData);
    const nestedJob = asRecord(posting.job);

    const publicJid = firstString(posting.id, posting.jobId)?.toLowerCase();
    const title = firstString(posting.title, linkedData?.title);
    if (
      publicJid !== reference.publicJid ||
      !title ||
      title !== reference.title
    ) {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify detail identity does not match public JID ${reference.publicJid}.`,
      );
    }

    const rawDescription = firstString(
      posting.descriptionPlain,
      linkedData?.description,
      posting.descriptionHtml,
    );
    if (!rawDescription) {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify detail ${publicJid} has no description.`,
      );
    }
    const description = /<[^>]+>/.test(rawDescription)
      ? htmlToPlainText(rawDescription)
      : normalizeWhitespace(rawDescription);

    const dateRaw = firstString(posting.publishedDate, linkedData?.datePosted);
    const datePosted = dateRaw ? normalizeExplicitDate(dateRaw) : null;
    if (!datePosted) {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify detail ${publicJid} has no valid publication date.`,
      );
    }

    const externalLink = firstString(posting.externalLink, posting.applyLink);
    const applyUrl = externalLink
      ? this.validatePublicApplicationUrl(externalLink, publicJid)
      : `${SHOPIFY_CAREERS_URL}?ashby_jid=${encodeURIComponent(publicJid)}`;

    const locationLabels = uniqueStrings([
      ...splitAdvertisedLocations(reference.locationLabel),
      ...splitAdvertisedLocations(firstString(posting.locationName) ?? ""),
      ...this.structuredLocationLabels(linkedData),
    ]);
    if (locationLabels.length === 0) {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify detail ${publicJid} has no advertised locations.`,
      );
    }
    const parsedLocations = parseLocationList(locationLabels);
    const employmentType = firstString(
      posting.employmentType,
      nestedJob?.employmentType,
      linkedData?.employmentType,
    );
    const department = firstString(
      posting.departmentName,
      reference.department,
    );
    const remoteStructured =
      firstString(linkedData?.jobLocationType)?.toUpperCase() === "TELECOMMUTE";

    return new JobPostDto({
      id: `shopify-${publicJid}`,
      site: Site.SHOPIFY,
      title,
      companyName: "Shopify",
      jobUrl: reference.detailUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: parsedLocations.location,
      locations: parsedLocations.locations,
      description,
      datePosted,
      isRemote: parsedLocations.remoteMentioned || remoteStructured,
      workFromHomeType: parsedLocations.workFromHomeType,
      department,
      employmentType,
      atsId: publicJid,
    });
  }

  private isQualifyingInternship(job: JobPostDto): boolean {
    const internshipEvidence = INTERNSHIP_PATTERN.test(
      `${job.title} ${job.employmentType ?? ""}`,
    );
    const disciplineEvidence = ENGINEERING_DISCIPLINE_PATTERN.test(
      `${job.title} ${job.department ?? ""}`,
    );
    return internshipEvidence && disciplineEvidence;
  }

  private extractPublicPosting(html: string): JsonRecord {
    const enqueuePattern = /streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g;
    let match: RegExpExecArray | null;
    let sawPayload = false;
    let lastError: unknown;

    while ((match = enqueuePattern.exec(html)) !== null) {
      sawPayload = true;
      try {
        const serialized = JSON.parse(match[1]);
        if (typeof serialized !== "string") continue;
        const flattened = JSON.parse(serialized);
        if (!Array.isArray(flattened)) continue;
        const decoded = decodeFlattenedPayload(flattened);
        const posting = findNestedRecord(decoded, "jobPosting");
        if (posting) return posting;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    if (!sawPayload) {
      throw new ShopifySourceError(
        "MARKUP_CHANGED",
        "Shopify public detail stream payload is missing.",
      );
    }
    throw new ShopifySourceError(
      "SCHEMA_INVALID",
      `Shopify public detail payload could not be decoded${
        lastError ? `: ${shopifyErrorMessage(lastError)}` : ""
      }.`,
      lastError,
    );
  }

  private structuredLocationLabels(linkedData: JsonRecord | null): string[] {
    if (!linkedData) return [];
    const remote =
      firstString(linkedData.jobLocationType)?.toUpperCase() === "TELECOMMUTE";
    const labels = this.placeLabels(linkedData.jobLocation, false);
    labels.push(
      ...this.placeLabels(linkedData.applicantLocationRequirements, remote),
    );
    return labels;
  }

  private placeLabels(value: unknown, remote: boolean): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const labels: string[] = [];
    for (const item of values) {
      const place = asRecord(item);
      if (!place) continue;
      const address = asRecord(place.address);
      const addressLabel = address
        ? uniqueStrings([
            firstString(address.addressLocality) ?? "",
            firstString(address.addressRegion) ?? "",
            firstString(address.addressCountry) ?? "",
          ]).join(", ")
        : "";
      const name = firstString(place.name, addressLabel);
      if (!name) continue;
      labels.push(remote ? `Remote - ${name}` : name);
    }
    return labels;
  }

  private validatePublicApplicationUrl(url: string, publicJid: string): string {
    this.assertOfficialShopifyUrl(url, "application");
    const parsed = new URL(url);
    if (
      parsed.pathname.replace(/\/$/, "") !== "/careers" ||
      parsed.searchParams.get("ashby_jid")?.toLowerCase() !== publicJid
    ) {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify detail ${publicJid} returned an unexpected public application URL.`,
      );
    }
    return parsed.toString();
  }

  private assertOfficialShopifyUrl(url: string, kind: string): void {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.shopify.com") {
      throw new ShopifySourceError(
        "SCHEMA_INVALID",
        `Shopify returned a non-official ${kind} URL.`,
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
        throw new ShopifySourceError(
          "SCHEMA_INVALID",
          `Shopify ${label} did not return HTML.`,
        );
      }
      return response.data;
    } catch (error: unknown) {
      if (error instanceof ShopifySourceError) throw error;
      throw new ShopifySourceError(
        "HTTP",
        `Shopify ${label} request failed: ${shopifyErrorMessage(error)}`,
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
      /just a moment|verify (?:that )?you are human|access denied|request blocked|attention required.*cloudflare/i.test(
        signalText,
      ) ||
      $('#challenge-form, form[action*="cdn-cgi/challenge"]').length > 0
    ) {
      throw new ShopifySourceError(
        "BLOCKED",
        `Shopify returned a blocking page for ${new URL(url).pathname}.`,
      );
    }
  }
}

function decodeFlattenedPayload(flattened: unknown[]): unknown {
  const cache = new Map<number, unknown>();

  const hydrate = (index: number): unknown => {
    if (index < 0) return null;
    if (cache.has(index)) return cache.get(index);
    const raw = flattened[index];

    if (raw === null || typeof raw !== "object") {
      cache.set(index, raw);
      return raw;
    }

    if (Array.isArray(raw)) {
      if (raw[0] === "SingleFetchClassInstance" && typeof raw[1] === "number") {
        const value = hydrate(raw[1]);
        cache.set(index, value);
        return value;
      }
      const result: unknown[] = [];
      cache.set(index, result);
      for (const entry of raw) {
        result.push(typeof entry === "number" ? hydrate(entry) : entry);
      }
      return result;
    }

    const result = Object.create(null) as JsonRecord;
    cache.set(index, result);
    for (const [encodedKey, encodedValue] of Object.entries(raw)) {
      const keyIndex = /^_(\d+)$/.exec(encodedKey)?.[1];
      if (!keyIndex) continue;
      const key = hydrate(Number.parseInt(keyIndex, 10));
      if (typeof key !== "string") continue;
      if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
        throw new Error(`Forbidden Shopify payload key: ${key}`);
      }
      result[key] =
        typeof encodedValue === "number" ? hydrate(encodedValue) : encodedValue;
    }
    return result;
  };

  return hydrate(0);
}

function findNestedRecord(value: unknown, key: string): JsonRecord | null {
  const seen = new Set<object>();
  const visit = (candidate: unknown): JsonRecord | null => {
    if (!candidate || typeof candidate !== "object") return null;
    if (seen.has(candidate)) return null;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }

    const record = candidate as JsonRecord;
    const direct = asRecord(record[key]);
    if (direct) return direct;
    for (const entry of Object.values(record)) {
      const found = visit(entry);
      if (found) return found;
    }
    return null;
  };
  return visit(value);
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

function splitAdvertisedLocations(value: string): string[] {
  return value
    .split(/\s*(?:;|\|)\s*/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
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
