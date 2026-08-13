import * as cheerio from 'cheerio';
import { Injectable, Logger } from '@nestjs/common';
import { createHttpClient, extractEmails, htmlToPlainText, markdownConverter } from '@ever-jobs/common';
import {
  Country,
  DescriptionFormat,
  getCountryDisplayName,
  IScraper,
  JobPostDto,
  JobResponseDto,
  LocationDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import { SourcePlugin } from '@ever-jobs/plugin';
import { YelloSourceError } from './yello-source.error';

const DEFAULT_RESULTS = 50;
const MAX_RESULTS = 250;
const PAGE_SIZE = 25;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 4;
interface YelloSearchResponse {
  html?: unknown;
  count_on_page?: unknown;
  display_count_text?: unknown;
  more_requisitions?: unknown;
}

interface YelloListing {
  opaqueId: string;
  requisitionId: string;
  title: string;
  jobUrl: string;
}

@SourcePlugin({
  site: Site.YELLO,
  name: 'Yello',
  category: 'ats',
  isAts: true,
  description: 'Official public Yello Enterprise job boards.',
})
@Injectable()
export class YelloService implements IScraper {
  private readonly logger = new Logger(YelloService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const boardToken = input.companySlug?.trim();
    if (!boardToken) {
      throw new YelloSourceError('INVALID_INPUT', 'Yello requires a job-board token in `companySlug`.');
    }

    const origin = resolveOrigin(input.companyUrl);
    const resultsWanted = normalizeLimit(input.resultsWanted);
    if (resultsWanted === 0) return new JobResponseDto([]);

    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      userAgent: input.userAgent,
      timeout: input.requestTimeout ?? 12,
      retries: input.retries ?? 3,
      retryDelay: input.retryDelay ?? 1_000,
      retryBackoff: input.retryBackoff ?? 'exponential',
      retryMaxDelay: input.retryMaxDelay ?? 12_000,
    });
    client.setHeaders({
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${origin}/job_boards/${encodeURIComponent(boardToken)}`,
    });

    const countryFilterId = input.country === undefined
      ? null
      : await this.resolveCountryFilter(client, origin, boardToken, input.country);
    const candidates: YelloListing[] = [];
    const seen = new Set<string>();
    const candidateBudget = input.country === undefined || countryFilterId !== null
      ? resultsWanted
      : Math.min(MAX_RESULTS, Math.max(PAGE_SIZE, resultsWanted * 3));
    let advertisedTotal: number | null = null;
    let page = 1;
    let more = true;

    while (more && page <= MAX_PAGES && candidates.length < candidateBudget) {
      const response = await this.fetchSearchPage(
        client,
        origin,
        boardToken,
        input.searchTerm,
        countryFilterId,
        page,
      );
      const html = typeof response.html === 'string' ? response.html : null;
      if (html === null) {
        throw new YelloSourceError('SCHEMA_INVALID', 'Yello search response is missing its HTML result fragment.');
      }

      const pageListings = parseListingHtml(html, origin);
      const pageCount = nonNegativeInteger(response.count_on_page) ?? pageListings.length;
      const pageAdvertisedTotal = parseAdvertisedTotal(response.display_count_text);
      if (pageAdvertisedTotal !== null) {
        advertisedTotal = Math.max(advertisedTotal ?? 0, pageAdvertisedTotal);
      }
      if (((advertisedTotal ?? 0) > 0 || pageCount > 0) && pageListings.length === 0) {
        throw new YelloSourceError(
          'MARKUP_CHANGED',
          `Yello advertised ${advertisedTotal || pageCount} result(s) but no job cards were extracted.`,
        );
      }

      for (const listing of pageListings) {
        if (seen.has(listing.opaqueId)) continue;
        seen.add(listing.opaqueId);
        candidates.push(listing);
        if (candidates.length >= candidateBudget) break;
      }

      more = response.more_requisitions === true || response.more_requisitions === 'true';
      page += 1;
    }

    if ((advertisedTotal ?? 0) > 0 && candidates.length === 0) {
      throw new YelloSourceError(
        'MARKUP_CHANGED',
        `Yello advertised ${advertisedTotal} result(s) but extraction returned zero jobs.`,
      );
    }

    const companyName = deriveCompanyName(origin);
    const jobs: JobPostDto[] = [];
    for (let offset = 0; offset < candidates.length && jobs.length < resultsWanted; offset += DETAIL_CONCURRENCY) {
      const batch = candidates.slice(offset, offset + DETAIL_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((listing) => this.fetchDetail(client, listing, origin, companyName, input.descriptionFormat)),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          if (matchesCountry(result.value, input.country)) jobs.push(result.value);
        } else {
          this.logger.warn(`Yello detail request failed: ${errorMessage(result.reason)}`);
        }
        if (jobs.length >= resultsWanted) break;
      }
    }

    if (
      candidates.length > 0 &&
      jobs.length === 0 &&
      (input.country === undefined || countryFilterId !== null)
    ) {
      throw new YelloSourceError(
        'MARKUP_CHANGED',
        `Yello returned ${candidates.length} job card(s), but no detail page could be extracted.`,
      );
    }

    this.logger.log(`Yello: scraped ${jobs.length} jobs from ${boardToken}`);
    return new JobResponseDto(jobs.slice(0, resultsWanted), {
      advertisedCount: advertisedTotal,
    });
  }

  private async fetchSearchPage(
    client: ReturnType<typeof createHttpClient>,
    origin: string,
    boardToken: string,
    searchTerm: string | undefined,
    countryFilterId: number | null,
    page: number,
  ): Promise<YelloSearchResponse> {
    const url = `${origin}/job_boards/${encodeURIComponent(boardToken)}/search`;
    try {
      const response = await client.get<YelloSearchResponse>(url, {
        params: {
          query: searchTerm?.trim() ?? '',
          filters: countryFilterId === null ? '' : String(countryFilterId),
          page_number: page,
        },
      });
      if (!response.data || typeof response.data !== 'object') {
        throw new YelloSourceError('SCHEMA_INVALID', 'Yello search did not return a JSON object.');
      }
      return response.data;
    } catch (error: unknown) {
      if (error instanceof YelloSourceError) throw error;
      throw new YelloSourceError('HTTP', `Yello search page ${page} failed: ${errorMessage(error)}`, error);
    }
  }

  private async resolveCountryFilter(
    client: ReturnType<typeof createHttpClient>,
    origin: string,
    boardToken: string,
    country: Country,
  ): Promise<number | null> {
    const boardUrl = `${origin}/job_boards/${encodeURIComponent(boardToken)}?locale=en`;
    try {
      const response = await client.get<unknown>(boardUrl, {
        responseType: 'text',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (typeof response.data !== 'string') return null;
      const $ = cheerio.load(response.data);
      const component = $('defined-field-answers-filter-container').filter((_, element) =>
        $(element).attr('field-label')?.trim().toLowerCase() === 'country/region',
      ).first();
      const encodedFilters = component.attr('v-bind:filters');
      if (!encodedFilters) return null;
      const answers = JSON.parse(encodedFilters) as unknown;
      if (!Array.isArray(answers)) return null;
      const expected = getCountryDisplayName(country).toLowerCase();
      for (const answer of answers) {
        if (!answer || typeof answer !== 'object') continue;
        const record = answer as Record<string, unknown>;
        if (typeof record.label !== 'string' || record.label.trim().toLowerCase() !== expected) continue;
        const id = nonNegativeInteger(record.id);
        if (id !== null) return id;
      }
    } catch (error: unknown) {
      this.logger.warn(`Yello country-filter discovery failed; using detail filtering: ${errorMessage(error)}`);
    }
    return null;
  }

  private async fetchDetail(
    client: ReturnType<typeof createHttpClient>,
    listing: YelloListing,
    origin: string,
    companyName: string,
    format: DescriptionFormat | undefined,
  ): Promise<JobPostDto> {
    let html: unknown;
    try {
      const response = await client.get<unknown>(listing.jobUrl, {
        responseType: 'text',
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      html = response.data;
    } catch (error: unknown) {
      throw new YelloSourceError('HTTP', `Yello job ${listing.opaqueId} failed: ${errorMessage(error)}`, error);
    }
    if (typeof html !== 'string') {
      throw new YelloSourceError('SCHEMA_INVALID', `Yello job ${listing.opaqueId} did not return HTML.`);
    }

    const $ = cheerio.load(html);
    const title = $('.details-top__title h1').first().text().trim() || listing.title;
    const metaSpans = $('.details-top__title > span').toArray().map((node) => $(node).text().trim());
    const requisitionId = metaSpans[0] || listing.requisitionId;
    const locations = parseYelloLocations(metaSpans[1]);
    const descriptionHtml = $('.job-details__description .inner').first().html()?.trim() ?? '';
    const applyHref = $('#apply-button').attr('href');
    const applyUrl = applyHref ? absoluteUrl(applyHref, origin) : listing.jobUrl;
    const secondary = new Map<string, string>();
    $('.secondary-details__group').each((_, element) => {
      const label = $(element).find('.secondary-details__title').text().trim();
      const value = $(element).find('.secondary-details__content').text().trim();
      if (label && value) secondary.set(label.toLowerCase(), value);
    });
    if (!title || !requisitionId) {
      throw new YelloSourceError('MARKUP_CHANGED', `Yello job ${listing.opaqueId} is missing title or requisition id.`);
    }

    const description = convertDescription(descriptionHtml, format);
    return new JobPostDto({
      id: `yello-${listing.opaqueId}`,
      title,
      companyName,
      jobUrl: listing.jobUrl,
      jobUrlDirect: applyUrl,
      applyUrl,
      location: locations[0] ?? null,
      locations,
      description,
      emails: extractEmails(description),
      isRemote: locations.some((location) => /remote/i.test(location.city ?? '')),
      department: secondary.get('service line/business area') ?? null,
      employmentType: secondary.get('position type') ?? null,
      site: Site.YELLO,
      atsId: requisitionId,
      atsType: 'yello',
    });
  }
}

function parseListingHtml(html: string, origin: string): YelloListing[] {
  const $ = cheerio.load(html);
  const listings: YelloListing[] = [];
  $('.search-results__item').each((_, element) => {
    const anchor = $(element).find('a.search-results__req_title[href*="/jobs/"]').first();
    const href = anchor.attr('href') ?? '';
    const match = /\/jobs\/([^/?#]+)/.exec(href);
    const title = anchor.text().trim();
    const requisitionId = $(element).find('.search-results__jobinfo > div span').first().text().trim();
    if (!match?.[1] || !title || !requisitionId) return;
    listings.push({
      opaqueId: decodeURIComponent(match[1]),
      requisitionId,
      title,
      jobUrl: absoluteUrl(href, origin),
    });
  });
  return listings;
}

function parseYelloLocations(raw: string | undefined): LocationDto[] {
  if (!raw) return [];
  return raw.split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    const match = /^([A-Z]{3})-(.+)$/.exec(value);
    const code = match?.[1];
    const city = match?.[2] ?? value;
    const country = code === 'CAN' ? 'Canada' : code === 'USA' ? 'United States' : code ?? null;
    return new LocationDto({ city, country });
  });
}

function matchesCountry(job: JobPostDto, country: Country | undefined): boolean {
  if (country === undefined) return true;
  const expected = country === Country.CANADA ? 'canada' : country === Country.USA ? 'united states' : country.toLowerCase();
  return (job.locations ?? []).some((location) => String(location.country ?? '').toLowerCase() === expected);
}

function convertDescription(html: string, format: DescriptionFormat | undefined): string | null {
  if (!html) return null;
  if (format === DescriptionFormat.HTML) return html;
  if (format === DescriptionFormat.MARKDOWN) return markdownConverter(html) ?? html;
  return htmlToPlainText(html);
}

function resolveOrigin(companyUrl: string | undefined): string {
  if (!companyUrl?.trim()) {
    throw new YelloSourceError(
      'INVALID_INPUT',
      'Yello requires `companyUrl` to identify the official employer board origin.',
    );
  }
  try {
    const url = new URL(companyUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    return url.origin;
  } catch (error: unknown) {
    throw new YelloSourceError('INVALID_INPUT', `Invalid Yello companyUrl: ${errorMessage(error)}`, error);
  }
}

function absoluteUrl(value: string, origin: string): string {
  return new URL(value, `${origin}/`).toString();
}

function deriveCompanyName(origin: string): string {
  const subdomain = new URL(origin).hostname.split('.')[0] || 'Yello employer';
  return subdomain.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeLimit(value: number | undefined): number {
  const candidate = value ?? DEFAULT_RESULTS;
  if (!Number.isFinite(candidate)) return DEFAULT_RESULTS;
  return Math.max(0, Math.min(MAX_RESULTS, Math.floor(candidate)));
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseAdvertisedTotal(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /([\d,]+)\s+results?/i.exec(value);
  return match ? nonNegativeInteger(match[1].replace(/,/g, '')) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
