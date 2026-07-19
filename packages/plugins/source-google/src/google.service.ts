import { createHash } from 'crypto';

import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  Country,
  DescriptionFormat,
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import {
  GoogleJobsException,
  createHttpClient,
  markdownConverter,
  parseLocationGeography,
  parseLocationList,
  plainConverter,
  randomSleep,
} from '@ever-jobs/common';

const GOOGLE_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
  'accept-language': 'en-CA,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

const GOOGLE_SEARCH_URL = 'https://www.google.com/search';
const GOOGLE_PAGE_SIZE = 10;
const GOOGLE_MAX_PAGES = 5;

interface GoogleJobRecord {
  id?: unknown;
  title?: unknown;
  company?: unknown;
  companyName?: unknown;
  hiringOrganization?: unknown;
  location?: unknown;
  locations?: unknown;
  jobLocation?: unknown;
  applicantLocationRequirements?: unknown;
  jobLocationType?: unknown;
  datePosted?: unknown;
  description?: unknown;
  url?: unknown;
  jobUrl?: unknown;
  applyUrl?: unknown;
}

interface ParsedGooglePage {
  jobs: JobPostDto[];
  validEmpty: boolean;
  hasMore: boolean;
}

@SourcePlugin({
  site: Site.GOOGLE,
  name: 'Google Jobs',
  category: 'job-board',
  watchMode: 'query',
})
@Injectable()
export class GoogleService implements IScraper {
  private readonly logger = new Logger(GoogleService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const client = createHttpClient(input);
    client.setHeaders(GOOGLE_HEADERS);

    const resultsWanted = Math.max(0, Math.min(input.resultsWanted ?? 15, 100));
    if (resultsWanted === 0) return new JobResponseDto([]);

    const query = this.buildQuery(input.googleSearchTerm ?? input.searchTerm ?? '', input);
    const locationCountry = parseLocationGeography(input.location).countryCode;
    const country =
      locationCountry === 'CA' ||
      (locationCountry === undefined && input.country === Country.CANADA)
        ? 'ca'
        : 'us';
    const jobs: JobPostDto[] = [];
    const seen = new Set<string>();

    this.logger.log(`Fetching Google Jobs for: "${query}"`);

    for (let page = 0; page < GOOGLE_MAX_PAGES && jobs.length < resultsWanted; page++) {
      if (page > 0) await randomSleep(500, 1_250);

      let raw: unknown;
      try {
        const response = await client.get(GOOGLE_SEARCH_URL, {
          params: {
            q: query,
            ibp: 'htl;jobs',
            hl: 'en',
            gl: country,
            start: page * GOOGLE_PAGE_SIZE,
          },
        });
        raw = response.data;
      } catch (error) {
        throw this.failure('SOURCE_HTTP_FAILURE', error);
      }

      const parsed = this.parsePage(raw, input.descriptionFormat);
      if (parsed.jobs.length === 0) {
        if (page === 0 && !parsed.validEmpty) {
          throw new GoogleJobsException(
            'SOURCE_MARKUP_CHANGED: Google Jobs returned no recognized job or empty-state markup',
          );
        }
        break;
      }

      let added = 0;
      for (const job of parsed.jobs) {
        const key = job.id ?? job.applyUrl ?? job.jobUrl;
        if (!key || seen.has(String(key))) continue;
        seen.add(String(key));
        jobs.push(job);
        added++;
        if (jobs.length >= resultsWanted) break;
      }

      if (added === 0 || (!parsed.hasMore && parsed.jobs.length < GOOGLE_PAGE_SIZE)) break;
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private buildQuery(searchTerm: string, input: ScraperInputDto): string {
    const terms = [searchTerm.trim() || 'jobs'];
    if (input.location?.trim()) terms.push(`near ${input.location.trim()}`);
    if (input.isRemote) terms.push('remote');
    if (input.jobType) terms.push(String(input.jobType));
    return `${terms.join(' ')} jobs`.replace(/\s+/g, ' ').trim();
  }

  private parsePage(raw: unknown, format?: DescriptionFormat): ParsedGooglePage {
    if (typeof raw !== 'string') {
      throw new GoogleJobsException('SOURCE_SCHEMA_INVALID: Google Jobs response was not HTML');
    }

    const html = raw.trim();
    if (!html) {
      throw new GoogleJobsException(
        'SOURCE_MARKUP_CHANGED: Google Jobs returned an empty HTML body',
      );
    }
    this.assertNotBlocked(html);

    const $ = cheerio.load(html);
    const jobs: JobPostDto[] = [];

    $('script[type="application/ld+json"]').each((_, script) => {
      const value = $(script).html()?.trim();
      if (!value) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        throw new GoogleJobsException(
          `SOURCE_SCHEMA_INVALID: invalid Google Jobs JSON-LD (${this.errorMessage(error)})`,
        );
      }
      for (const record of this.findJobRecords(parsed, true)) {
        jobs.push(this.mapRecord(record, format));
      }
    });

    $('script[type="application/json"][data-google-jobs]').each((_, script) => {
      const value = $(script).html()?.trim();
      if (!value) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        throw new GoogleJobsException(
          `SOURCE_SCHEMA_INVALID: invalid embedded Google Jobs payload (${this.errorMessage(error)})`,
        );
      }
      for (const record of this.findJobRecords(parsed, false)) {
        jobs.push(this.mapRecord(record, format));
      }
    });

    $('[data-job-id], [data-google-job], .google-jobs-card').each((_, element) => {
      const card = $(element);
      const title = this.firstText(card, [
        '[data-field="title"]',
        '.job-title',
        '.BjJfJf',
        'h2',
        'h3',
      ]);
      const company = this.firstText(card, [
        '[data-field="company"]',
        '.company-name',
        '.vNEEBe',
      ]);
      if (!title || !company) return;

      const locationText = this.firstText(card, [
        '[data-field="location"]',
        '.job-location',
        '.Qk80Jf',
      ]);
      const locations = this.locationDtos(locationText ? [locationText] : []);
      const detailHref = this.firstHref(card, [
        'a[data-field="detail-url"]',
        'a.job-detail-link',
        'a[href]',
      ]);
      const applyHref = this.firstHref(card, [
        'a[data-field="apply-url"]',
        'a.apply-link',
        'a[data-apply-url]',
      ]);
      const id =
        card.attr('data-job-id') ??
        card.attr('data-google-job') ??
        this.stableId(title, company, applyHref ?? detailHref ?? locationText);

      jobs.push(
        new JobPostDto({
          id: `go-${String(id).replace(/^go-/, '')}`,
          title,
          companyName: company,
          jobUrl: detailHref ?? applyHref ?? this.searchFallback(title, company),
          jobUrlDirect: applyHref ?? null,
          applyUrl: applyHref ?? null,
          location: locations[0] ?? null,
          locations,
          datePosted: card.find('time').attr('datetime') ?? null,
          site: Site.GOOGLE,
        }),
      );
    });

    const deduped = new Map<string, JobPostDto>();
    for (const job of jobs) {
      const key = String(job.id ?? job.applyUrl ?? job.jobUrl);
      if (!deduped.has(key)) deduped.set(key, job);
    }

    const validEmpty =
      $('[data-google-jobs-empty], .google-jobs-no-results, [aria-label="No jobs found"]').length > 0 ||
      $('script[type="application/json"][data-google-jobs]').toArray().some((script) => {
        const value = $(script).html() ?? '';
        return /"jobs"\s*:\s*\[\s*\]/.test(value);
      });

    const hasMore = $('[data-google-jobs-next], [data-next-page]').length > 0;
    return { jobs: [...deduped.values()], validEmpty, hasMore };
  }

  private assertNotBlocked(html: string): void {
    const normalized = html.toLowerCase();
    const blocked =
      normalized.includes('/sorry/index') ||
      normalized.includes('unusual traffic from your computer network') ||
      normalized.includes('id="captcha-form"') ||
      normalized.includes('consent.google.com') ||
      normalized.includes('before you continue to google search') ||
      normalized.includes('/httpservice/retry/enablejs');
    if (blocked) {
      throw new GoogleJobsException('SOURCE_BLOCKED: Google Jobs returned a challenge or JS-only shell');
    }
  }

  private findJobRecords(value: unknown, requireJobPostingType: boolean): GoogleJobRecord[] {
    const found: GoogleJobRecord[] = [];
    const visit = (candidate: unknown): void => {
      if (Array.isArray(candidate)) {
        candidate.forEach(visit);
        return;
      }
      if (!candidate || typeof candidate !== 'object') return;
      const object = candidate as Record<string, unknown>;
      const rawType = object['@type'];
      const types = Array.isArray(rawType) ? rawType : [rawType];
      const isJobPosting = types.some((type) => String(type).toLowerCase() === 'jobposting');
      const looksNormalized =
        typeof object.title === 'string' &&
        (typeof object.company === 'string' ||
          typeof object.companyName === 'string' ||
          typeof object.hiringOrganization === 'object');
      if ((requireJobPostingType && isJobPosting) || (!requireJobPostingType && looksNormalized)) {
        found.push(object as GoogleJobRecord);
        return;
      }
      Object.values(object).forEach(visit);
    };
    visit(value);
    return found;
  }

  private mapRecord(record: GoogleJobRecord, format?: DescriptionFormat): JobPostDto {
    const title = this.stringValue(record.title);
    const company =
      this.stringValue(record.companyName) ||
      this.stringValue(record.company) ||
      this.organizationName(record.hiringOrganization);
    if (!title || !company) {
      throw new GoogleJobsException('SOURCE_SCHEMA_INVALID: Google Jobs record omitted title/company');
    }

    const locationStrings = [
      ...this.locationStrings(record.locations),
      ...this.locationStrings(record.location),
      ...this.schemaLocationStrings(record.jobLocation),
      ...this.schemaLocationStrings(record.applicantLocationRequirements),
    ];
    if (String(record.jobLocationType).toUpperCase() === 'TELECOMMUTE') {
      locationStrings.push('Remote');
    }
    const locations = this.locationDtos(locationStrings);
    const jobUrl =
      this.stringValue(record.jobUrl) ||
      this.stringValue(record.url) ||
      this.searchFallback(title, company);
    const applyUrl = this.externalUrl(this.stringValue(record.applyUrl));
    const rawDescription = this.stringValue(record.description);

    return new JobPostDto({
      id: `go-${this.stringValue(record.id) || this.stableId(title, company, applyUrl || jobUrl)}`,
      title,
      companyName: company,
      jobUrl,
      jobUrlDirect: applyUrl || null,
      applyUrl: applyUrl || null,
      location: locations[0] ?? null,
      locations,
      datePosted: this.dateValue(record.datePosted),
      description: this.renderDescription(rawDescription, format),
      isRemote: locationStrings.some((value) => /remote|telecommute/i.test(value)),
      site: Site.GOOGLE,
    });
  }

  private schemaLocationStrings(value: unknown): string[] {
    const entries = Array.isArray(value) ? value : value ? [value] : [];
    const locations: string[] = [];
    for (const entry of entries) {
      if (typeof entry === 'string') {
        locations.push(entry);
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const object = entry as Record<string, unknown>;
      const address =
        object.address && typeof object.address === 'object'
          ? (object.address as Record<string, unknown>)
          : object;
      const rendered = [address.addressLocality, address.addressRegion, address.addressCountry]
        .map((part) => this.stringValue(part))
        .filter(Boolean)
        .join(', ');
      if (rendered) locations.push(rendered);
      else if (this.stringValue(object.name)) locations.push(this.stringValue(object.name));
    }
    return locations;
  }

  private locationStrings(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap((entry) => this.locationStrings(entry));
    const rendered = this.stringValue(value);
    if (!rendered) return [];
    return rendered
      .split(/\s*(?:;|\||\n|\s\/\s)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private locationDtos(values: string[]) {
    return parseLocationList(values).locations;
  }

  private organizationName(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return this.stringValue((value as Record<string, unknown>).name);
  }

  private renderDescription(value: string, format?: DescriptionFormat): string | null {
    if (!value) return null;
    if (format === DescriptionFormat.PLAIN) return plainConverter(value) ?? value;
    if (format === DescriptionFormat.MARKDOWN) return markdownConverter(value) ?? value;
    return value;
  }

  private dateValue(value: unknown): string | null {
    const rendered = this.stringValue(value);
    if (!rendered) return null;
    const date = new Date(rendered);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private firstText(card: cheerio.Cheerio<any>, selectors: string[]): string {
    for (const selector of selectors) {
      const value = card.find(selector).first().text().trim();
      if (value) return value;
    }
    return '';
  }

  private firstHref(card: cheerio.Cheerio<any>, selectors: string[]): string | null {
    for (const selector of selectors) {
      const element = card.find(selector).first();
      const raw = element.attr('data-apply-url') ?? element.attr('href');
      if (!raw) continue;
      try {
        return new URL(raw, GOOGLE_SEARCH_URL).toString();
      } catch {
        continue;
      }
    }
    return null;
  }

  private externalUrl(value: string): string {
    if (!value) return '';
    try {
      const url = new URL(value);
      return /(^|\.)google\.[a-z.]+$/i.test(url.hostname) ? '' : url.toString();
    } catch {
      return '';
    }
  }

  private stableId(...values: unknown[]): string {
    return createHash('sha256')
      .update(values.map((value) => this.stringValue(value)).join('\u001f'))
      .digest('hex')
      .slice(0, 24);
  }

  private searchFallback(title: string, company: string): string {
    return `${GOOGLE_SEARCH_URL}?q=${encodeURIComponent(`${title} ${company} jobs`)}`;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private failure(code: string, error: unknown): GoogleJobsException {
    return new GoogleJobsException(`${code}: ${this.errorMessage(error)}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
