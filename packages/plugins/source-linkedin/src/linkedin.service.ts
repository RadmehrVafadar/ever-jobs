import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  CompensationDto,
  CompensationInterval,
  DescriptionFormat,
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import {
  HttpClient,
  LinkedInException,
  createHttpClient,
  extractEmails,
  markdownConverter,
  parseLocationList,
  plainConverter,
  randomSleep,
} from '@ever-jobs/common';

import { LINKEDIN_HEADERS } from './linkedin.constants';
import {
  isJobRemote,
  jobTypeCode,
  parseCompanyIndustry,
  parseJobLevel,
  parseJobType,
} from './linkedin.utils';

const LINKEDIN_PAGE_SIZE = 25;
const LINKEDIN_MAX_RESULTS = 100;
const LINKEDIN_DEFAULT_RECENT_HOURS = 72;
const LINKEDIN_MAX_RECENT_HOURS = 168;
const LINKEDIN_MAX_DETAIL_FETCHES = 5;
const COARSE_INTERNSHIP_TITLE = /\b(?:intern(?:ship)?|co[\s-]?op)\b/i;
const COARSE_ENGINEERING_TITLE =
  /\b(?:software|developer|development|backend|front[\s-]?end|full[\s-]?stack|mobile|ios|android|platform|cloud|infrastructure|site reliability|sre|devops|security|data engineer(?:ing)?|machine learning|ml|ai|developer experience|dx)\b/i;

interface LinkedInDetail {
  text: string;
  jobLevel?: string;
  industry?: string;
  jobType?: ReturnType<typeof parseJobType>;
  applyUrl?: string;
}

@SourcePlugin({
  site: Site.LINKEDIN,
  name: 'LinkedIn',
  category: 'job-board',
  watchMode: 'query',
})
@Injectable()
export class LinkedInService implements IScraper {
  private readonly logger = new Logger(LinkedInService.name);
  private readonly baseUrl = 'https://www.linkedin.com';

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const client = createHttpClient(input);
    client.setHeaders(LINKEDIN_HEADERS);

    const resultsWanted = Math.max(
      0,
      Math.min(input.resultsWanted ?? 15, LINKEDIN_MAX_RESULTS),
    );
    if (resultsWanted === 0) return new JobResponseDto([]);

    const jobs: JobPostDto[] = [];
    const seenIds = new Set<string>();
    let start = Math.max(0, input.offset ?? 0);
    const maximumPages = Math.ceil(resultsWanted / LINKEDIN_PAGE_SIZE) + 1;

    for (let page = 0; page < maximumPages && jobs.length < resultsWanted; page++) {
      this.logger.log(`Fetching LinkedIn public guest jobs, offset ${start}`);

      let raw: unknown;
      try {
        const response = await client.get(
          `${this.baseUrl}/jobs-guest/jobs/api/seeMoreJobPostings/search`,
          { params: this.buildSearchParams(input, start) },
        );
        raw = response.data;
      } catch (error) {
        throw this.failure('SOURCE_HTTP_FAILURE', error);
      }

      const pageJobs = this.parseSearchPage(raw, input);
      if (pageJobs.length === 0) break;

      let added = 0;
      for (const job of pageJobs) {
        if (!job.id || seenIds.has(job.id)) continue;
        seenIds.add(job.id);
        jobs.push(job);
        added++;
        if (jobs.length >= resultsWanted) break;
      }
      if (added === 0 || pageJobs.length < LINKEDIN_PAGE_SIZE) break;

      start += LINKEDIN_PAGE_SIZE;
      await randomSleep(750, 1_750);
    }

    // Detail requests are the most expensive and rate-sensitive part of the
    // public guest surface. Keep them bounded inside the watcher's 12-second
    // source budget; the remaining listing cards are still retained.
    const detailCandidates = jobs
      .filter((job) => this.isCoarseInternshipCandidate(job.title))
      .slice(0, LINKEDIN_MAX_DETAIL_FETCHES);
    for (const [index, job] of detailCandidates.entries()) {
      const detail = await this.fetchDescription(client, job.jobUrl, input.descriptionFormat);
      job.description = detail.text;
      job.jobLevel = detail.jobLevel ?? job.jobLevel;
      job.companyIndustry = detail.industry ?? job.companyIndustry;
      job.jobType = detail.jobType ?? job.jobType;
      job.emails = extractEmails(detail.text);
      if (detail.applyUrl) {
        job.applyUrl = detail.applyUrl;
        job.jobUrlDirect = detail.applyUrl;
      }
      if (index + 1 < detailCandidates.length) await randomSleep(750, 1_750);
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private buildSearchParams(
    input: ScraperInputDto,
    start: number,
  ): Record<string, string | number> {
    const hoursOld = Math.max(
      1,
      Math.min(input.hoursOld ?? LINKEDIN_DEFAULT_RECENT_HOURS, LINKEDIN_MAX_RECENT_HOURS),
    );
    const params: Record<string, string | number> = {
      keywords: input.searchTerm ?? '',
      location: input.location ?? '',
      distance: input.distance ?? 50,
      start,
      sortBy: 'DD',
      f_TPR: `r${Math.round(hoursOld * 3600)}`,
    };

    if (input.easyApply) params.f_AL = 'true';
    if (input.jobType) {
      const code = jobTypeCode(input.jobType);
      if (code) params.f_JT = code;
    }
    if (input.isRemote) params.f_WT = '2';
    if (input.linkedinCompanyIds?.length) params.f_C = input.linkedinCompanyIds.join(',');
    return params;
  }

  private parseSearchPage(raw: unknown, input: ScraperInputDto): JobPostDto[] {
    if (typeof raw !== 'string') {
      throw new LinkedInException('SOURCE_SCHEMA_INVALID: LinkedIn guest response was not HTML');
    }
    const html = raw.trim();
    if (!html) {
      throw new LinkedInException(
        'SOURCE_MARKUP_CHANGED: LinkedIn guest search returned an empty HTML body',
      );
    }
    this.assertNotBlocked(html, 'search');

    const $ = cheerio.load(html);
    const cards = $('li').has('.base-search-card');
    if (cards.length === 0) {
      const validEmpty =
        $('.jobs-search-no-results-banner, [data-test-id="no-results"]').length > 0 ||
        /\bno (?:matching )?jobs (?:were )?found\b/i.test($.text());
      if (validEmpty) return [];
      throw new LinkedInException(
        'SOURCE_MARKUP_CHANGED: LinkedIn guest response contained no recognized cards or empty state',
      );
    }

    const jobs: JobPostDto[] = [];
    cards.each((_, element) => {
      const job = this.extractJobFromCard($, $(element), input);
      if (!job) {
        throw new LinkedInException(
          'SOURCE_MARKUP_CHANGED: LinkedIn guest card omitted a stable ID, URL, or title',
        );
      }
      jobs.push(job);
    });
    return jobs;
  }

  private extractJobFromCard(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
    _input: ScraperInputDto,
  ): JobPostDto | null {
    const root = card.find('.base-search-card').first();
    const link = root.find('.base-search-card__full-link, a.base-card__full-link').first();
    const rawUrl = link.attr('href');
    if (!rawUrl) return null;

    let jobUrl: string;
    try {
      const parsed = new URL(rawUrl, this.baseUrl);
      parsed.search = '';
      parsed.hash = '';
      jobUrl = parsed.toString().replace(/\/$/, '');
    } catch {
      return null;
    }

    const urn = root.attr('data-entity-urn') ?? card.attr('data-entity-urn') ?? '';
    const jobId = urn.match(/jobPosting:(\d+)/i)?.[1] ?? jobUrl.match(/-(\d+)(?:\/)?$/)?.[1];
    const title = root.find('.base-search-card__title').text().trim();
    if (!jobId || !title) return null;

    const companyAnchor = root.find('.base-search-card__subtitle a').first();
    const companyName = companyAnchor.text().trim() || null;
    const companyUrl = companyAnchor.attr('href') || null;
    const locationText = root.find('.job-search-card__location').text().trim();
    const parsedLocations = parseLocationList([locationText]);
    const locations = parsedLocations.locations;
    const datePosted = root.find('time').attr('datetime') || null;

    let compensation: CompensationDto | null = null;
    const salaryText = root.find('.job-search-card__salary-info').text().trim();
    const salaryMatch = salaryText.match(
      /\$?([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?([\d,]+(?:\.\d+)?)/i,
    );
    if (salaryMatch) {
      compensation = new CompensationDto({
        minAmount: Number(salaryMatch[1].replace(/,/g, '')),
        maxAmount: Number(salaryMatch[2].replace(/,/g, '')),
        currency: 'USD',
        interval: /(?:hour|hr)\b/i.test(salaryText)
          ? CompensationInterval.HOURLY
          : CompensationInterval.YEARLY,
      });
    }

    return new JobPostDto({
      id: `li-${jobId}`,
      title,
      companyName,
      companyUrl,
      jobUrl,
      location: locations[0] ?? parsedLocations.location,
      locations,
      compensation,
      datePosted,
      isRemote: isJobRemote(title, '', locationText),
      site: Site.LINKEDIN,
    });
  }

  private async fetchDescription(
    client: HttpClient,
    jobUrl: string,
    format?: DescriptionFormat,
  ): Promise<LinkedInDetail> {
    let raw: unknown;
    try {
      const response = await client.get(jobUrl);
      raw = response.data;
    } catch (error) {
      throw this.failure('SOURCE_HTTP_FAILURE', error);
    }
    if (typeof raw !== 'string') {
      throw new LinkedInException('SOURCE_SCHEMA_INVALID: LinkedIn detail response was not HTML');
    }
    this.assertNotBlocked(raw, 'detail');

    const $ = cheerio.load(raw);
    const description = $('.show-more-less-html__markup, .description__text').first();
    if (!description.length) {
      throw new LinkedInException(
        'SOURCE_MARKUP_CHANGED: LinkedIn detail response omitted the job description',
      );
    }

    const rawHtml = description.html() ?? '';
    const text =
      format === DescriptionFormat.PLAIN
        ? plainConverter(rawHtml) ?? rawHtml
        : format === DescriptionFormat.MARKDOWN
          ? markdownConverter(rawHtml) ?? rawHtml
          : rawHtml;
    const criteria = $('.description__job-criteria-list').first();

    return {
      text,
      jobLevel: parseJobLevel($, criteria) ?? undefined,
      industry: parseCompanyIndustry($, criteria) ?? undefined,
      jobType: parseJobType($, criteria),
      applyUrl: this.extractExternalApplyUrl($) ?? undefined,
    };
  }

  private extractExternalApplyUrl($: cheerio.CheerioAPI): string | null {
    const selectors = [
      'a[data-tracking-control-name="public_jobs_apply-link-offsite"]',
      'a[data-apply-url]',
      'a.apply-button[href]',
      'a[data-tracking-control-name*="apply"][href]',
    ];
    for (const selector of selectors) {
      for (const element of $(selector).toArray()) {
        const candidate = $(element).attr('data-apply-url') ?? $(element).attr('href');
        const external = this.toExternalUrl(candidate);
        if (external) return external;
      }
    }
    return null;
  }

  private toExternalUrl(value?: string): string | null {
    if (!value) return null;
    try {
      const url = new URL(value, this.baseUrl);
      if (/(^|\.)linkedin\.com$|(^|\.)linkedin\.cn$/i.test(url.hostname)) {
        if (/\/(?:redir|redirect)/i.test(url.pathname)) {
          const redirected = url.searchParams.get('url');
          return redirected ? this.toExternalUrl(decodeURIComponent(redirected)) : null;
        }
        return null;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  }

  private assertNotBlocked(html: string, page: 'search' | 'detail'): void {
    const normalized = html.toLowerCase();
    const blocked =
      normalized.includes('/checkpoint/challenge') ||
      normalized.includes('security verification') ||
      normalized.includes('class="challenge-dialog') ||
      normalized.includes('id="captcha-internal"') ||
      normalized.includes('authwall-join-form') ||
      normalized.includes('data-test-id="authwall"');
    if (blocked) {
      throw new LinkedInException(`SOURCE_BLOCKED: LinkedIn public ${page} page was blocked`);
    }
  }

  private isCoarseInternshipCandidate(title: string): boolean {
    return COARSE_INTERNSHIP_TITLE.test(title) && COARSE_ENGINEERING_TITLE.test(title);
  }

  private failure(code: string, error: unknown): LinkedInException {
    const message = error instanceof Error ? error.message : String(error);
    return new LinkedInException(`${code}: ${message}`);
  }
}
