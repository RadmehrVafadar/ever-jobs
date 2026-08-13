import * as cheerio from 'cheerio';
import { Injectable, Logger } from '@nestjs/common';
import { createHttpClient, extractEmails, htmlToPlainText, markdownConverter } from '@ever-jobs/common';
import {
  DescriptionFormat,
  IScraper,
  JobPostDto,
  JobResponseDto,
  JobType,
  LocationDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import { SourcePlugin } from '@ever-jobs/plugin';
import { AccentureSourceError } from './accenture-source.error';

const SEARCH_URL = 'https://www.accenture.com/api/accenture/elastic/findjobs';
const DEFAULT_RESULTS = 50;
const MAX_RESULTS = 250;
const PAGE_SIZE = 25;
const MAX_PAGES = 20;
const DETAIL_CONCURRENCY = 4;
const DETAIL_LIMIT = 25;

interface AccentureSearchResponse {
  data?: unknown;
  totalHits?: { total?: unknown } | unknown;
}

type JsonRecord = Record<string, unknown>;

@SourcePlugin({
  site: Site.ACCENTURE,
  name: 'Accenture Canada',
  category: 'company',
  description: 'Official localized Accenture Canada careers search.',
})
@Injectable()
export class AccentureService implements IScraper {
  private readonly logger = new Logger(AccentureService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
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
    client.setHeaders({ Accept: 'application/json', Referer: 'https://www.accenture.com/ca-en/careers/jobsearch' });

    const jobs: JobPostDto[] = [];
    const seen = new Set<string>();
    let startIndex = 0;
    let advertisedTotal: number | null = null;

    for (let page = 0; page < MAX_PAGES && jobs.length < resultsWanted; page += 1) {
      const response = await this.fetchPage(client, input.searchTerm, startIndex);
      const records = response.data;
      if (!Array.isArray(records)) {
        throw new AccentureSourceError('SCHEMA_INVALID', 'Accenture search response is missing its data array.');
      }
      const totalHits = asRecord(response.totalHits);
      advertisedTotal = nonNegativeInteger(totalHits?.total) ?? advertisedTotal;

      let mappedOnPage = 0;
      for (const value of records) {
        const job = mapAccentureJob(value, input.descriptionFormat);
        if (!job || !job.atsId || seen.has(job.atsId)) continue;
        seen.add(job.atsId);
        jobs.push(job);
        mappedOnPage += 1;
        if (jobs.length >= resultsWanted) break;
      }
      if ((advertisedTotal ?? 0) > 0 && records.length > 0 && mappedOnPage === 0 && jobs.length === 0) {
        throw new AccentureSourceError(
          'MARKUP_CHANGED',
          `Accenture advertised ${advertisedTotal} result(s), but no jobs were extracted.`,
        );
      }
      startIndex += records.length;
      const reachedKnownEnd = advertisedTotal !== null
        ? startIndex >= advertisedTotal
        : records.length < PAGE_SIZE;
      if (records.length === 0 || reachedKnownEnd) break;
    }

    if ((advertisedTotal ?? 0) > 0 && jobs.length === 0) {
      throw new AccentureSourceError(
        'MARKUP_CHANGED',
        `Accenture advertised ${advertisedTotal} result(s), but extraction returned zero jobs.`,
      );
    }

    const selected = jobs.slice(0, resultsWanted);
    await this.enrichDetails(client, selected, input.descriptionFormat);

    this.logger.log(`Accenture Canada: scraped ${selected.length} jobs`);
    return new JobResponseDto(selected, { advertisedCount: advertisedTotal });
  }

  private async fetchPage(
    client: ReturnType<typeof createHttpClient>,
    searchTerm: string | undefined,
    startIndex: number,
  ): Promise<AccentureSearchResponse> {
    const form = new URLSearchParams({
      startIndex: String(startIndex),
      maxResultSize: String(PAGE_SIZE),
      jobKeyword: searchTerm?.trim() ?? '',
      jobCountry: 'Canada',
      jobLanguage: 'en',
      countrySite: 'ca-en',
      sortBy: '2',
      searchType: 'vectorSearch',
      enableQueryBoost: 'true',
      minScore: '0.6',
      getFeedbackJudgmentEnabled: 'true',
      useCleanEmbedding: 'true',
      score: 'true',
      totalHits: 'true',
      debugQuery: 'false',
      jobFilters: '[]',
    });
    try {
      const response = await client.post<AccentureSearchResponse>(SEARCH_URL, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!response.data || typeof response.data !== 'object') {
        throw new AccentureSourceError('SCHEMA_INVALID', 'Accenture search did not return a JSON object.');
      }
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AccentureSourceError) throw error;
      throw new AccentureSourceError('HTTP', `Accenture search failed: ${errorMessage(error)}`, error);
    }
  }

  private async enrichDetails(
    client: ReturnType<typeof createHttpClient>,
    jobs: JobPostDto[],
    format: DescriptionFormat | undefined,
  ): Promise<void> {
    const detailJobs = jobs.slice(0, DETAIL_LIMIT);
    for (let offset = 0; offset < detailJobs.length; offset += DETAIL_CONCURRENCY) {
      const batch = detailJobs.slice(offset, offset + DETAIL_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (job) => {
          const response = await client.get<unknown>(job.jobUrl, {
            responseType: 'text',
            headers: { Accept: 'text/html,application/xhtml+xml' },
          });
          if (typeof response.data !== 'string') {
            throw new AccentureSourceError(
              'SCHEMA_INVALID',
              `Accenture detail ${job.atsId ?? job.jobUrl} did not return HTML.`,
            );
          }
          enrichFromDetail(job, response.data, format);
        }),
      );
      for (const result of settled) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `Accenture detail enrichment failed; retaining feed record: ${errorMessage(result.reason)}`,
          );
        }
      }
    }
  }
}

function mapAccentureJob(value: unknown, format: DescriptionFormat | undefined): JobPostDto | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const title = stringValue(raw.title);
  const requisitionId = stringValue(raw.requisitionId) ?? stringValue(raw.guid)?.replace(/_en$/i, '');
  const detailTemplate = stringValue(raw.jobDetailUrl);
  if (!title || !requisitionId || !detailTemplate) return null;

  const jobUrl = detailTemplate.replace('{0}', 'ca-en');
  if (!isHttpUrl(jobUrl)) return null;
  const applyUrl = stringValue(raw.internalReferURL);
  const locationStrings = stringArray(raw.location);
  const locations = locationStrings.map(parseLocation);
  const rawDescription = stringValue(raw.jobDescription) ?? stringValue(raw.jobDescriptionClean) ?? '';
  const description = convertDescription(rawDescription, format);
  const employmentType = stringValue(raw.employeeType) ?? stringValue(raw.jobScheduleDescription);
  const internship = /\b(intern(?:ship)?|co[ -]?op|student)\b/i.test(`${title} ${employmentType ?? ''}`);

  return new JobPostDto({
    id: `accenture-${requisitionId}`,
    title,
    companyName: 'Accenture Canada',
    jobUrl,
    jobUrlDirect: applyUrl && isHttpUrl(applyUrl) ? applyUrl : jobUrl,
    applyUrl: applyUrl && isHttpUrl(applyUrl) ? applyUrl : jobUrl,
    location: locations[0] ?? null,
    locations,
    description,
    emails: extractEmails(description),
    datePosted: isoDate(stringValue(raw.updateDate)),
    isRemote: /remote/i.test(stringValue(raw.remoteType) ?? '') || locationStrings.some((item) => /remote/i.test(item)),
    jobType: internship ? [JobType.INTERNSHIP] : null,
    employmentType: employmentType ?? null,
    department: stringArray(raw.jobFamilyGroup)[0] ?? stringValue(raw.businessArea) ?? null,
    team: stringValue(raw.jobProfile) ?? null,
    skills: [...stringArray(raw.skill), ...stringArray(raw.workdaySkill)],
    site: Site.ACCENTURE,
    atsId: requisitionId,
    atsType: 'accenture',
  });
}

function enrichFromDetail(
  job: JobPostDto,
  html: string,
  format: DescriptionFormat | undefined,
): void {
  const $ = cheerio.load(html);
  const posting = findJobPostingJsonLd($);
  if (!posting) {
    throw new AccentureSourceError(
      'MARKUP_CHANGED',
      `Accenture detail ${job.atsId ?? job.jobUrl} is missing JobPosting JSON-LD.`,
    );
  }

  const title = stringValue(posting.title);
  const descriptionHtml = stringValue(posting.description);
  const employmentType = stringValue(posting.employmentType);
  const datePosted = isoDate(stringValue(posting.datePosted));
  const locations = parseStructuredLocations(posting.jobLocation);
  const identifier = asRecord(posting.identifier);
  const detailId = stringValue(identifier?.value);
  const hiringOrganization = structuredName(posting.hiringOrganization);
  const applyHref = $(
    'a.rad-job-details-hero__apply-cta[href], a[aria-label^="Apply for this job"][href]',
  ).first().attr('href');
  const detailSkills = stringArray(posting.skills);

  if (detailId && job.atsId && detailId !== job.atsId) {
    throw new AccentureSourceError(
      'SCHEMA_INVALID',
      `Accenture detail requisition ${detailId} does not match feed requisition ${job.atsId}.`,
    );
  }
  if (title) job.title = title;
  if (hiringOrganization) {
    job.companyName = hiringOrganization === 'Accenture'
      ? 'Accenture Canada'
      : hiringOrganization;
  }
  if (descriptionHtml) {
    job.description = convertDescription(descriptionHtml, format);
    job.emails = extractEmails(job.description);
  }
  if (employmentType) job.employmentType = employmentType;
  if (datePosted) job.datePosted = datePosted;
  if (locations.length > 0) {
    job.locations = locations;
    job.location = locations[0];
  }
  if (detailSkills.length > 0) {
    job.skills = [...new Set([...(job.skills ?? []), ...detailSkills])];
  }
  if (applyHref && isHttpUrl(applyHref)) {
    job.applyUrl = applyHref;
    job.jobUrlDirect = applyHref;
  }
  job.isRemote = job.isRemote === true || locations.some((location) =>
    /remote/i.test(`${location.city ?? ''} ${location.state ?? ''}`),
  );
  if (/\b(intern(?:ship)?|co[ -]?op|student)\b/i.test(`${job.title} ${job.employmentType ?? ''}`)) {
    job.jobType = [JobType.INTERNSHIP];
  }
}

function findJobPostingJsonLd($: cheerio.CheerioAPI): JsonRecord | null {
  let found: JsonRecord | null = null;
  $('script[type="application/ld+json"]').each((_, element) => {
    if (found) return false;
    const source = $(element).text().trim();
    if (!source) return;
    try {
      found = walkForJobPosting(JSON.parse(source));
    } catch {
      // Other JSON-LD blocks can be malformed or unrelated; continue.
    }
    return found ? false : undefined;
  });
  return found;
}

function walkForJobPosting(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkForJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const type = record['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return record;
  return record['@graph'] === undefined ? null : walkForJobPosting(record['@graph']);
}

function parseStructuredLocations(value: unknown): LocationDto[] {
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const locations: LocationDto[] = [];
  for (const entry of entries) {
    const place = asRecord(entry);
    const address = asRecord(place?.address);
    if (!address) continue;
    const city = stringValue(address.addressLocality);
    const state = stringValue(address.addressRegion);
    const country = structuredName(address.addressCountry);
    if (!city && !state && !country) continue;
    locations.push(new LocationDto({ city, state, country }));
  }
  return locations;
}

function structuredName(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  const record = asRecord(value);
  return stringValue(record?.name);
}

function parseLocation(value: string): LocationDto {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  return new LocationDto({ city: parts[0] ?? null, state: parts[1] ?? null, country: 'Canada' });
}

function convertDescription(value: string, format: DescriptionFormat | undefined): string | null {
  if (!value) return null;
  if (format === DescriptionFormat.HTML) return value;
  if (format === DescriptionFormat.MARKDOWN) return markdownConverter(value) ?? value;
  return htmlToPlainText(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
    : [];
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
