import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { SourcePlugin } from '@ever-jobs/plugin';
import {
  IScraper,
  JobPostDto,
  JobResponseDto,
  LocationDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import {
  createHttpClient,
  extractEmails,
  htmlToPlainText,
  randomSleep,
} from '@ever-jobs/common';
import {
  SF_DELAY_MAX,
  SF_DELAY_MIN,
  SF_HEADERS,
  SF_PAGE_SIZE,
  SF_RMK_DEFAULT_LOCALE,
  SF_RMK_MAX_PAGES,
  SF_RMK_PAGE_SIZE,
  SF_VANITY_PAGE_SIZE,
  buildSfCareerUrl,
  buildSfODataUrl,
  buildSfRmkJobsUrl,
  buildSfVanityListingUrl,
  isSfJobDetailUrl,
  parseSfSlug,
  resolveSfUrl,
} from './successfactors.constants';
import { SuccessFactorsExtractionError } from './successfactors.error';
import {
  SfJsonLdJobLocation,
  SfJsonLdJobPosting,
  SfJobPosting,
  SfODataResponse,
  SfRmkJob,
  SfRmkSearchRequest,
  SfRmkSearchResponse,
  SfVanityPageResult,
} from './successfactors.types';

interface SfODataScrapeResult {
  jobs: JobPostDto[];
  /** Exact total exposed by upstream count metadata, or null when unknown. */
  advertisedResultCount: number | null;
  /** Positive source evidence used for drift detection; not exposed as a total. */
  positiveResultCount: number;
}

interface SfVanityContext {
  companyName: string;
  identity: string;
  sourceKey: string;
  url: string;
}

interface SfPaginationMetadata {
  advertisedResultCount: number | null;
  nextStartRow: number | null;
}

/**
 * SAP SuccessFactors adapter.
 *
 * Two intentionally separate entry paths are supported:
 *
 * 1. `companyUrl` is authoritative for branded/vanity domains. The adapter
 *    keeps the supplied `/go/`, `/search/`, or `/job/` path and never replaces
 *    it with a guessed `*.successfactors.com` hostname.
 * 2. With no `companyUrl`, the legacy `{instance}:{companyId}` slug continues
 *    to use the public OData endpoint before its historical HTML fallback.
 */
@SourcePlugin({
  site: Site.SUCCESSFACTORS,
  name: 'SuccessFactors',
  category: 'ats',
  isAts: true,
})
@Injectable()
export class SuccessFactorsService implements IScraper {
  private readonly logger = new Logger(SuccessFactorsService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const companyUrl = input.companyUrl?.trim();
    if (companyUrl) {
      return this.scrapeVanityPortal(input, companyUrl);
    }

    const companySlug = input.companySlug?.trim();
    if (!companySlug) {
      this.logger.warn(
        'SuccessFactors scrape requires either `companyUrl` or `companySlug`',
      );
      return new JobResponseDto([]);
    }

    const resultsWanted = this.normalizeResultsWanted(input.resultsWanted);
    if (resultsWanted === 0) return new JobResponseDto([]);

    const { instance, companyId } = parseSfSlug(companySlug);
    const odata = await this.scrapeOData(
      input,
      instance,
      companyId,
      resultsWanted,
    );
    if (odata.jobs.length > 0) {
      this.logger.log(
        `SuccessFactors OData returned ${odata.jobs.length} jobs for ${instance}`,
      );
      return new JobResponseDto(odata.jobs, {
        advertisedCount: odata.advertisedResultCount ?? undefined,
      });
    }

    this.logger.log(
      'SuccessFactors: OData returned zero normalized results, falling back to HTML',
    );
    const legacyHtml = await this.scrapeLegacyHtml(
      input,
      instance,
      companyId,
      resultsWanted,
    );
    if (legacyHtml.jobs.length > 0) {
      return new JobResponseDto(legacyHtml.jobs, {
        advertisedCount: legacyHtml.advertisedResultCount ?? undefined,
      });
    }

    const knownCounts = [
      odata.advertisedResultCount,
      legacyHtml.advertisedResultCount,
    ].filter((value): value is number => value !== null);
    const advertisedResultCount =
      knownCounts.length > 0 ? Math.max(...knownCounts) : null;
    const positiveResultCount = Math.max(
      odata.positiveResultCount,
      legacyHtml.positiveResultCount,
      advertisedResultCount ?? 0,
    );
    if (positiveResultCount > 0) {
      throw new SuccessFactorsExtractionError(
        companySlug,
        positiveResultCount,
      );
    }

    return new JobResponseDto([], {
      advertisedCount: advertisedResultCount ?? undefined,
    });
  }

  /** Scrape a caller-supplied branded career domain without rewriting it. */
  private async scrapeVanityPortal(
    input: ScraperInputDto,
    companyUrl: string,
  ): Promise<JobResponseDto> {
    const context = this.resolveVanityContext(input, companyUrl);
    if (!context) return new JobResponseDto([]);

    const resultsWanted = this.normalizeResultsWanted(input.resultsWanted);
    if (resultsWanted === 0) return new JobResponseDto([]);

    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });
    client.setHeaders(SF_HEADERS);

    if (isSfJobDetailUrl(context.url)) {
      try {
        const response = await client.get<unknown>(context.url);
        const html = this.responseHtml(response.data);
        const job = this.parseVanityDetailPage(html, context);
        return new JobResponseDto(job ? [job] : []);
      } catch (err: any) {
        this.logger.warn(
          `SuccessFactors detail fetch failed (${context.url}): ${err.message}`,
        );
        return new JobResponseDto([]);
      }
    }

    const collected = new Map<string, JobPostDto>();
    let startRow = Math.max(0, Math.floor(input.offset ?? 0));
    let advertisedResultCount: number | null = null;

    while (collected.size < resultsWanted) {
      let pageUrl: string;
      try {
        pageUrl = buildSfVanityListingUrl(
          context.url,
          input.searchTerm,
          startRow,
        );
      } catch (err: any) {
        this.logger.warn(
          `SuccessFactors invalid companyUrl=${context.url}: ${err.message}`,
        );
        break;
      }

      let html: string;
      try {
        this.logger.log(
          `SuccessFactors vanity listing: fetching ${pageUrl}`,
        );
        const response = await client.get<unknown>(pageUrl);
        html = this.responseHtml(response.data);
      } catch (err: any) {
        this.logger.warn(
          `SuccessFactors vanity listing failed (${pageUrl}): ${err.message}`,
        );
        break;
      }

      const page = this.parseVanityListingPage(html, pageUrl, context);
      if (page.advertisedResultCount !== null) {
        advertisedResultCount = Math.max(
          advertisedResultCount ?? 0,
          page.advertisedResultCount,
        );
      }

      for (const job of page.jobs) {
        if (collected.size >= resultsWanted) break;
        const key = job.id ?? job.jobUrl;
        if (!collected.has(key)) collected.set(key, job);
      }

      // A positive official count with no normalized row is parser drift. Do
      // not walk every subsequent page before surfacing the typed failure.
      if (
        (page.advertisedResultCount ?? 0) > 0 &&
        page.jobs.length === 0
      ) {
        break;
      }

      if (collected.size >= resultsWanted) break;

      const nextStartRow = this.resolveNextStartRow(page, startRow);
      if (nextStartRow === null) break;
      if (
        advertisedResultCount !== null &&
        nextStartRow >= advertisedResultCount
      ) {
        break;
      }

      startRow = nextStartRow;
      await randomSleep(SF_DELAY_MIN, SF_DELAY_MAX);
    }

    // Current RMK "unified" portals (including Deloitte Canada) render only
    // a client shell. When HTML establishes neither rows nor an official
    // count, use the same public JSON service as the browser widget.
    if (collected.size === 0 && advertisedResultCount === null) {
      const rmk = await this.scrapeRmkUnifiedSearch(
        client,
        input,
        context,
        resultsWanted,
      );
      if (
        rmk.jobs.length > 0 ||
        rmk.advertisedResultCount !== null ||
        rmk.positiveResultCount > 0
      ) {
        if (rmk.positiveResultCount > 0 && rmk.jobs.length === 0) {
          throw new SuccessFactorsExtractionError(
            context.identity,
            rmk.positiveResultCount,
          );
        }
        this.logger.log(
          `SuccessFactors RMK unified total: ${rmk.jobs.length} jobs for ${context.companyName}`,
        );
        return new JobResponseDto(rmk.jobs, {
          advertisedCount: rmk.advertisedResultCount ?? undefined,
        });
      }
    }

    const jobs = [...collected.values()];
    if ((advertisedResultCount ?? 0) > 0 && jobs.length === 0) {
      throw new SuccessFactorsExtractionError(
        context.identity,
        advertisedResultCount!,
      );
    }

    this.logger.log(
      `SuccessFactors vanity total: ${jobs.length} jobs for ${context.companyName}`,
    );
    return new JobResponseDto(jobs, {
      advertisedCount: advertisedResultCount ?? undefined,
    });
  }

  /**
   * Search the public SuccessFactors RMK unified endpoint used by Deloitte's
   * client-rendered job cards. Page numbers are zero-based and the service
   * returns at most 25 results per page.
   */
  private async scrapeRmkUnifiedSearch(
    client: ReturnType<typeof createHttpClient>,
    input: ScraperInputDto,
    context: SfVanityContext,
    resultsWanted: number,
  ): Promise<SfODataScrapeResult> {
    const jobs = new Map<string, JobPostDto>();
    let advertisedResultCount: number | null = null;
    let positiveResultCount = 0;
    let pageNumber = Math.floor(
      Math.max(0, input.offset ?? 0) / SF_RMK_PAGE_SIZE,
    );
    const apiUrl = buildSfRmkJobsUrl(context.url);

    for (
      let pagesFetched = 0;
      pagesFetched < SF_RMK_MAX_PAGES && jobs.size < resultsWanted;
      pagesFetched++, pageNumber++
    ) {
      const payload: SfRmkSearchRequest = {
        keywords: input.searchTerm?.trim() ?? '',
        locale: SF_RMK_DEFAULT_LOCALE,
        location: input.location?.trim() ?? '',
        pageNumber,
        sortBy: 'recent',
      };

      let data: SfRmkSearchResponse;
      try {
        const response = await client.post<SfRmkSearchResponse>(
          apiUrl,
          payload,
          {
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Origin: new URL(context.url).origin,
              Referer: context.url,
            },
          },
        );
        data = response.data ?? {};
      } catch (err: any) {
        this.logger.warn(
          `SuccessFactors RMK unified search failed (${apiUrl} page=${pageNumber}): ${err.message ?? String(err)}`,
        );
        break;
      }

      const totalJobs = this.parseInteger(
        data.totalJobs === null || data.totalJobs === undefined
          ? undefined
          : String(data.totalJobs),
      );
      if (totalJobs !== null) {
        advertisedResultCount = Math.max(
          advertisedResultCount ?? 0,
          totalJobs,
        );
        positiveResultCount = Math.max(positiveResultCount, totalJobs);
      }

      const rows = Array.isArray(data.jobSearchResult)
        ? data.jobSearchResult
        : [];
      positiveResultCount = Math.max(positiveResultCount, rows.length);
      const sizeBeforePage = jobs.size;
      for (const envelope of rows) {
        if (jobs.size >= resultsWanted) break;
        const mapped = this.mapRmkJob(
          envelope?.response,
          context,
          SF_RMK_DEFAULT_LOCALE,
        );
        if (!mapped) continue;
        const key = mapped.atsId ?? mapped.id ?? mapped.jobUrl;
        if (!jobs.has(key)) jobs.set(key, mapped);
      }

      // An advertised positive first page with no normalized row is a schema
      // break, not a reason to spend the full pagination budget.
      if (
        jobs.size === 0 &&
        ((totalJobs ?? 0) > 0 || rows.length > 0) &&
        jobs.size === sizeBeforePage
      ) {
        break;
      }
      if (jobs.size >= resultsWanted || rows.length === 0) break;
      if (
        totalJobs !== null &&
        (pageNumber + 1) * SF_RMK_PAGE_SIZE >= totalJobs
      ) {
        break;
      }
      if (totalJobs === null && rows.length < SF_RMK_PAGE_SIZE) break;

      await randomSleep(SF_DELAY_MIN, SF_DELAY_MAX);
    }

    return {
      jobs: [...jobs.values()].slice(0, resultsWanted),
      advertisedResultCount,
      positiveResultCount,
    };
  }

  private async scrapeOData(
    input: ScraperInputDto,
    instance: string,
    companyId: string,
    resultsWanted: number,
  ): Promise<SfODataScrapeResult> {
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });
    client.setHeaders(SF_HEADERS);

    const baseUrl = buildSfODataUrl(instance);
    const jobPosts: JobPostDto[] = [];
    let offset = 0;
    let advertisedResultCount: number | null = null;
    let positiveResultCount = 0;

    try {
      this.logger.log(
        `Fetching SuccessFactors OData jobs for ${instance} (company: ${companyId})`,
      );

      while (jobPosts.length < resultsWanted) {
        const params = new URLSearchParams({
          $select:
            'jobReqId,jobTitle,jobDescription,locationObj,department,postingStartDate,jobType,employmentType,companyName,externalJobUrl',
          $top: String(SF_PAGE_SIZE),
          $skip: String(offset),
          $orderby: 'postingStartDate desc',
          $inlinecount: 'allpages',
          $format: 'json',
        });

        const url = `${baseUrl}?${params.toString()}`;
        const response = await client.get<SfODataResponse>(url);
        const data = response.data ?? {};
        const listings = Array.isArray(data.d?.results)
          ? data.d!.results!
          : [];
        const inlineCount = this.parseInteger(data.d?.__count);

        if (inlineCount !== null) {
          advertisedResultCount = Math.max(
            advertisedResultCount ?? 0,
            inlineCount,
          );
        }
        if (listings.length > 0) {
          positiveResultCount = Math.max(
            positiveResultCount,
            offset + listings.length,
          );
        }

        if (listings.length === 0) break;

        for (const listing of listings) {
          if (jobPosts.length >= resultsWanted) break;
          try {
            const post = this.processODataListing(
              listing,
              instance,
              companyId,
            );
            if (post) jobPosts.push(post);
          } catch (err: any) {
            this.logger.warn(
              `Error processing SuccessFactors OData listing: ${err.message}`,
            );
          }
        }

        if (jobPosts.length >= resultsWanted) break;
        offset += listings.length;
        if (listings.length < SF_PAGE_SIZE) break;
        await randomSleep(SF_DELAY_MIN, SF_DELAY_MAX);
      }
    } catch (err: any) {
      this.logger.warn(
        `SuccessFactors OData request failed for ${instance}: ${err.message}`,
      );
    }

    return { jobs: jobPosts, advertisedResultCount, positiveResultCount };
  }

  private async scrapeLegacyHtml(
    input: ScraperInputDto,
    instance: string,
    companyId: string,
    resultsWanted: number,
  ): Promise<SfODataScrapeResult> {
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });
    client.setHeaders(SF_HEADERS);

    const careerUrl = buildSfCareerUrl(
      instance,
      companyId,
      input.searchTerm ?? undefined,
    );

    try {
      const response = await client.get<unknown>(careerUrl);
      const context: SfVanityContext = {
        companyName: companyId,
        identity: `${instance}:${companyId}`,
        sourceKey: this.slugify(instance),
        url: careerUrl,
      };
      const page = this.parseVanityListingPage(
        this.responseHtml(response.data),
        careerUrl,
        context,
      );
      return {
        jobs: page.jobs.slice(0, resultsWanted),
        advertisedResultCount: page.advertisedResultCount,
        positiveResultCount: Math.max(
          page.advertisedResultCount ?? 0,
          page.cardCount,
        ),
      };
    } catch (err: any) {
      this.logger.warn(
        `SuccessFactors legacy HTML scrape failed for ${instance}: ${err.message}`,
      );
      return {
        jobs: [],
        advertisedResultCount: null,
        positiveResultCount: 0,
      };
    }
  }

  private processODataListing(
    listing: SfJobPosting,
    instance: string,
    companyId: string,
  ): JobPostDto | null {
    const title = this.cleanText(
      listing.jobTitle ?? listing.formattedJobTitle ?? '',
    );
    if (!title) return null;

    const jobReqId = listing.jobReqId
      ? String(listing.jobReqId)
      : null;
    const fallbackUrl = `https://${instance}.successfactors.com/career?company=${encodeURIComponent(companyId)}&jobId=${encodeURIComponent(jobReqId ?? '')}`;
    let jobUrl = fallbackUrl;
    if (listing.externalJobUrl) {
      try {
        jobUrl = resolveSfUrl(listing.externalJobUrl, fallbackUrl);
      } catch {
        jobUrl = fallbackUrl;
      }
    }

    const locObj = listing.locationObj ?? listing.locationObjlist?.[0] ?? null;
    const location = locObj
      ? new LocationDto({
          city: locObj.city ?? null,
          state: locObj.state ?? null,
          country: locObj.country ?? null,
        })
      : null;
    const locationText = [locObj?.city, locObj?.state, locObj?.country]
      .filter(Boolean)
      .join(', ');

    const description = listing.jobDescription
      ? htmlToPlainText(listing.jobDescription)
      : null;

    return new JobPostDto({
      id: `sf-${this.slugify(instance)}-${jobReqId ?? Math.abs(this.hashCode(jobUrl || title))}`,
      title,
      companyName: listing.companyName ?? companyId,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location,
      description,
      emails: description ? extractEmails(description) : [],
      datePosted: this.normalizeDate(listing.postingStartDate),
      isRemote: /\bremote\b/i.test(locationText),
      site: Site.SUCCESSFACTORS,
      atsId: jobReqId,
      atsType: 'successfactors',
      department: listing.department ?? null,
      employmentType: listing.employmentType ?? listing.jobType ?? null,
    });
  }

  /** Normalize one RMK unified-search card into the canonical job DTO. */
  private mapRmkJob(
    raw: SfRmkJob | null | undefined,
    context: SfVanityContext,
    locale: string,
  ): JobPostDto | null {
    if (!raw) return null;
    const idValue = raw.id;
    const jobId =
      typeof idValue === 'number' || typeof idValue === 'string'
        ? String(idValue).trim()
        : '';
    const title = this.firstStringValue(
      raw.unifiedStandardTitle,
      raw.jobTitle,
    );
    if (!jobId || !title) return null;

    const urlTitle =
      this.firstStringValue(raw.urlTitle, raw.unifiedUrlTitle) ??
      title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    const canonicalUrl = new URL(
      `/job/${encodeURIComponent(urlTitle || 'untitled')}/${encodeURIComponent(`${jobId}-${locale}`)}/`,
      new URL(context.url).origin,
    ).toString();
    const upstreamUrl = this.firstStringValue(
      raw.externalJobUrl,
      raw.jobUrl,
      raw.url,
    );
    let jobUrl = canonicalUrl;
    if (upstreamUrl) {
      try {
        jobUrl = resolveSfUrl(upstreamUrl, context.url);
      } catch {
        jobUrl = canonicalUrl;
      }
    }

    const advertisedLocationNames = this.stringValues(raw.mfield1);
    if (advertisedLocationNames.length === 0) {
      advertisedLocationNames.push(...this.stringValues(raw.jobLocationShort));
    }
    const locations = advertisedLocationNames
      .map((value) => this.parseLocation(value))
      .filter((value): value is LocationDto => value !== null);
    const employmentType = this.firstStringValue(
      raw.employeeType,
      raw.filter6,
    );
    const descriptionHtml = this.firstStringValue(
      raw.description,
      raw.jobDescription,
    );
    const description = descriptionHtml
      ? htmlToPlainText(descriptionHtml)
      : null;
    const companyName =
      this.firstStringValue(raw.companyName, raw.company) ??
      context.companyName;

    return new JobPostDto({
      id: `sf-${context.sourceKey}-${jobId}`,
      title,
      companyName,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location: locations[0] ?? null,
      locations,
      description,
      emails: description ? extractEmails(description) : [],
      datePosted: this.normalizeDate(
        this.firstStringValue(
          raw.unifiedStandardStart,
          raw.referenceDate,
        ),
      ),
      isRemote:
        advertisedLocationNames.some((value) => /\bremote\b/i.test(value)) ||
        /\bremote\b/i.test(title),
      site: Site.SUCCESSFACTORS,
      atsId: jobId,
      atsType: 'successfactors',
      department: this.firstStringValue(raw.department, raw.jobFunction),
      employmentType,
    });
  }

  /** Parse a server-rendered `/go/` or `/search/` page. */
  private parseVanityListingPage(
    html: string,
    pageUrl: string,
    context: SfVanityContext,
  ): SfVanityPageResult {
    const $ = cheerio.load(html);
    const pagination = this.parsePagination($);

    const selectorCascade = [
      'tr.data-row',
      '.jobResultItem',
      '.job-result',
      '.jobResult',
      'li.job-listing',
      'tr.jobRow',
      '.job-list-item',
      'article.job',
      '[data-job-id]',
    ];

    let cards: cheerio.Cheerio<any> | null = null;
    for (const selector of selectorCascade) {
      const found = $(selector);
      if (found.length > 0) {
        cards = found;
        break;
      }
    }

    if (!cards || cards.length === 0) {
      cards = $('a').filter((_index, element) => {
        const href = $(element).attr('href') ?? '';
        return /\/job\//i.test(href) || /[?&]jobId=/i.test(href);
      });
    }

    const jobs: JobPostDto[] = [];
    const cardCount = cards?.length ?? 0;
    cards?.each((_index, element) => {
      try {
        const job = this.parseVanityListingCard(
          $,
          $(element),
          pageUrl,
          context,
        );
        if (job) jobs.push(job);
      } catch (err: any) {
        this.logger.warn(
          `SuccessFactors listing parse failed (${pageUrl}): ${err.message}`,
        );
      }
    });

    return {
      jobs,
      advertisedResultCount: pagination.advertisedResultCount,
      nextStartRow: pagination.nextStartRow,
      cardCount,
    };
  }

  private parseVanityListingCard(
    $: cheerio.CheerioAPI,
    card: cheerio.Cheerio<any>,
    pageUrl: string,
    context: SfVanityContext,
  ): JobPostDto | null {
    const node = card.get(0) as any;
    const isAnchor = node?.tagName?.toLowerCase() === 'a';
    const titleLink = isAnchor
      ? card
      : card
          .find(
            '.jobTitle a, a.jobTitle-link, a.jobTitle, h2 a, h3 a, a[href*="/job/"], a[href*="jobId="]',
          )
          .first();
    const href = titleLink.attr('href')?.trim() ?? '';
    const title = this.cleanText(
      titleLink.text() ||
        card.find('.jobTitle, .job-title, [data-careersite-propertyid="title"]').first().text(),
    );
    if (!href || !title) return null;

    let jobUrl: string;
    try {
      jobUrl = resolveSfUrl(href, pageUrl);
    } catch {
      return null;
    }

    const jobReqId =
      card.attr('data-job-id')?.trim() || this.extractJobId(jobUrl);
    const locationText = this.findFirstText(card, [
      '.jobLocation',
      '.job-location',
      '.location',
      '.colLocation',
      '[data-careersite-propertyid="location"]',
      '[class*="location" i]',
    ]);
    const dateText = this.findFirstText(card, [
      '.jobDate',
      '.job-date',
      '.date',
      '[data-careersite-propertyid="date"]',
      '[class*="date" i]',
    ]);
    const department = this.findFirstText(card, [
      '.jobCategory',
      '.job-category',
      '.department',
      '.category',
      '[data-careersite-propertyid="department"]',
    ]);
    const employmentType = this.findFirstText(card, [
      '.jobType',
      '.job-type',
      '.employmentType',
      '[data-careersite-propertyid="employmentType"]',
    ]);
    const cardCompanyName = this.findFirstText(card, [
      '.companyName',
      '.company-name',
      '[data-careersite-propertyid="company"]',
    ]);

    return new JobPostDto({
      id: `sf-${context.sourceKey}-${jobReqId ?? Math.abs(this.hashCode(jobUrl))}`,
      title,
      companyName: cardCompanyName ?? context.companyName,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location: this.parseLocation(locationText),
      datePosted: this.normalizeDate(dateText),
      isRemote: /\bremote\b/i.test(locationText ?? ''),
      site: Site.SUCCESSFACTORS,
      atsId: jobReqId,
      atsType: 'successfactors',
      department,
      employmentType,
    });
  }

  /** Parse a single branded `/job/` page, preferring schema.org JobPosting. */
  private parseVanityDetailPage(
    html: string,
    context: SfVanityContext,
  ): JobPostDto | null {
    const $ = cheerio.load(html);
    const jsonLd = this.findJsonLdJobPosting($);
    const title = this.cleanText(
      jsonLd?.title ??
        $('h1.jobTitle, h1[data-careersite-propertyid="title"], h1')
          .first()
          .text() ??
        $('meta[property="og:title"]').attr('content') ??
        '',
    );
    if (!title) return null;

    let jobUrl = context.url;
    if (jsonLd?.url) {
      try {
        jobUrl = resolveSfUrl(jsonLd.url, context.url);
      } catch {
        jobUrl = context.url;
      }
    }

    const location = this.locationFromJsonLd(jsonLd?.jobLocation) ??
      this.parseLocation(
        this.findFirstText($.root(), [
          '.jobGeoLocation',
          '.jobLocation',
          '[data-careersite-propertyid="location"]',
        ]),
      );
    const locationText = location?.displayLocation() ?? '';
    const descriptionHtml =
      jsonLd?.description ??
      $('.jobdescription, .job-description, [data-careersite-propertyid="description"]')
        .first()
        .html() ??
      '';
    const description = descriptionHtml
      ? htmlToPlainText(descriptionHtml)
      : null;
    const identifier = this.jsonLdIdentifier(jsonLd?.identifier);
    const jobReqId = identifier ?? this.extractJobId(jobUrl);
    const employmentType = Array.isArray(jsonLd?.employmentType)
      ? jsonLd!.employmentType!.join(', ')
      : jsonLd?.employmentType ??
        this.findFirstText($.root(), [
          '.jobType',
          '[data-careersite-propertyid="employmentType"]',
        ]);
    const department = this.findFirstText($.root(), [
      '.jobCategory',
      '.department',
      '[data-careersite-propertyid="department"]',
    ]);
    const companyName =
      jsonLd?.hiringOrganization?.name ??
      $('meta[property="og:site_name"]').attr('content')?.trim() ??
      context.companyName;

    return new JobPostDto({
      id: `sf-${context.sourceKey}-${jobReqId ?? Math.abs(this.hashCode(jobUrl))}`,
      title,
      companyName,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location,
      description,
      emails: description ? extractEmails(description) : [],
      datePosted: this.normalizeDate(
        jsonLd?.datePosted ??
          this.findFirstText($.root(), [
            '.jobDate',
            '[data-careersite-propertyid="date"]',
          ]),
      ),
      isRemote: /\bremote\b/i.test(`${locationText} ${description ?? ''}`),
      site: Site.SUCCESSFACTORS,
      atsId: jobReqId,
      atsType: 'successfactors',
      department,
      employmentType,
    });
  }

  private resolveVanityContext(
    input: ScraperInputDto,
    companyUrl: string,
  ): SfVanityContext | null {
    try {
      const parsed = new URL(companyUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('companyUrl must use http or https');
      }
      parsed.hash = '';

      const slug = input.companySlug?.trim();
      const hostParts = parsed.hostname.split('.');
      let hostCompany = hostParts[0] ?? parsed.hostname;
      if (
        /^(?:www|jobs?|careers?|career)$/i.test(hostCompany) &&
        hostParts.length > 2
      ) {
        hostCompany = hostParts[1];
      }

      return {
        companyName: this.humanize(slug || hostCompany),
        identity: slug || parsed.hostname,
        sourceKey: this.slugify(parsed.hostname),
        url: parsed.toString(),
      };
    } catch (err: any) {
      this.logger.warn(
        `SuccessFactors invalid companyUrl=${companyUrl}: ${err.message}`,
      );
      return null;
    }
  }

  private parsePagination($: cheerio.CheerioAPI): SfPaginationMetadata {
    const totalAttributeSelectors = [
      '[data-total-results]',
      '[data-total-jobs]',
    ];
    for (const selector of totalAttributeSelectors) {
      const element = $(selector).first();
      if (!element.length) continue;
      const value =
        element.attr('data-total-results') ?? element.attr('data-total-jobs');
      const parsed = this.parseInteger(value);
      if (parsed !== null) {
        return {
          advertisedResultCount: parsed,
          nextStartRow: this.nextRowFromLink($),
        };
      }
    }

    const hiddenTotal = this.parseInteger(
      $('input[name="totalResults"], input#totalResults').first().attr('value'),
    );
    if (hiddenTotal !== null) {
      return {
        advertisedResultCount: hiddenTotal,
        nextStartRow: this.nextRowFromLink($),
      };
    }

    const paginationText = this.cleanText(
      $('.paginationLabel, .pagination-label, .results-count, .searchResultsCount, [class*="result-count" i], [data-careersite-propertyid="searchResultsCount"]')
        .map((_index, element) => $(element).text())
        .get()
        .join(' '),
    );
    const range = paginationText.match(
      /(?:results?\s*)?([\d,]+)\s*[-\u2013\u2014]\s*([\d,]+)\s+of\s+([\d,]+)/i,
    );
    if (range) {
      const end = this.parseInteger(range[2]) ?? 0;
      const total = this.parseInteger(range[3]) ?? 0;
      return {
        advertisedResultCount: total,
        nextStartRow: end < total ? end : null,
      };
    }

    const labelledCount = paginationText.match(
      /(?:results?|jobs?)(?:\s+(?:found|available))?\s*:?\s*([\d,]+)/i,
    );
    if (labelledCount) {
      return {
        advertisedResultCount: this.parseInteger(labelledCount[1]),
        nextStartRow: this.nextRowFromLink($),
      };
    }

    if (/\bno\s+(?:jobs?|results?)\s+(?:found|available)\b/i.test($.text())) {
      return { advertisedResultCount: 0, nextStartRow: null };
    }

    const scriptMatch = $.html().match(
      /["'](?:totalResults|totalJobs|resultCount)["']\s*:\s*["']?([\d,]+)/i,
    );
    return {
      advertisedResultCount: this.parseInteger(scriptMatch?.[1]),
      nextStartRow: this.nextRowFromLink($),
    };
  }

  private nextRowFromLink($: cheerio.CheerioAPI): number | null {
    const href = $(
      'a[rel="next"], a.next, .pagination a[title*="next" i], .pagination a[aria-label*="next" i]',
    )
      .first()
      .attr('href');
    if (!href) return null;
    try {
      return this.parseInteger(new URL(href, 'https://example.invalid').searchParams.get('startrow'));
    } catch {
      return null;
    }
  }

  private resolveNextStartRow(
    page: SfVanityPageResult,
    currentStartRow: number,
  ): number | null {
    if (
      page.nextStartRow !== null &&
      page.nextStartRow > currentStartRow
    ) {
      return page.nextStartRow;
    }
    if (page.cardCount >= SF_VANITY_PAGE_SIZE) {
      return currentStartRow + SF_VANITY_PAGE_SIZE;
    }
    return null;
  }

  private findJsonLdJobPosting(
    $: cheerio.CheerioAPI,
  ): SfJsonLdJobPosting | null {
    let match: SfJsonLdJobPosting | null = null;
    $('script[type="application/ld+json"]').each((_index, element) => {
      if (match) return;
      const raw = $(element).text().trim();
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        match = this.findJobPostingNode(parsed);
      } catch {
        // Invalid optional metadata must not hide valid visible detail fields.
      }
    });
    return match;
  }

  private findJobPostingNode(value: unknown): SfJsonLdJobPosting | null {
    if (Array.isArray(value)) {
      for (const child of value) {
        const match = this.findJobPostingNode(child);
        if (match) return match;
      }
      return null;
    }
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const types = Array.isArray(record['@type'])
      ? record['@type']
      : [record['@type']];
    if (types.some((type) => String(type).toLowerCase() === 'jobposting')) {
      return record as unknown as SfJsonLdJobPosting;
    }
    return this.findJobPostingNode(record['@graph']);
  }

  private locationFromJsonLd(
    value: SfJsonLdJobLocation | SfJsonLdJobLocation[] | undefined,
  ): LocationDto | null {
    const first = Array.isArray(value) ? value[0] : value;
    const address = first?.address;
    if (!address) return null;
    const country =
      typeof address.addressCountry === 'string'
        ? address.addressCountry
        : address.addressCountry?.name;
    if (!address.addressLocality && !address.addressRegion && !country) {
      return null;
    }
    return new LocationDto({
      city: address.addressLocality ?? null,
      state: address.addressRegion ?? null,
      country: country ?? null,
    });
  }

  private jsonLdIdentifier(
    identifier: SfJsonLdJobPosting['identifier'],
  ): string | null {
    if (typeof identifier === 'string') return identifier.trim() || null;
    return identifier?.value?.trim() || null;
  }

  private extractJobId(jobUrl: string): string | null {
    try {
      const url = new URL(jobUrl);
      for (const key of ['jobId', 'jobID', 'jobReqId', 'job']) {
        const value = url.searchParams.get(key)?.trim();
        if (value) return value;
      }

      const pathMatch = url.pathname.match(
        /\/(?:job|jobdetail)\/(?:.*\/)?([^/]+)\/?$/i,
      );
      return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]) : null;
    } catch {
      return null;
    }
  }

  private parseLocation(value: string | null): LocationDto | null {
    if (!value) return null;
    const cleaned = value
      .replace(/^(?:location|primary location)\s*:\s*/i, '')
      .trim();
    if (!cleaned) return null;
    const parts = cleaned
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    return new LocationDto({
      city: parts[0] ?? cleaned,
      state: parts[1] ?? null,
      country: parts.length > 2 ? parts.slice(2).join(', ') : null,
    });
  }

  private findFirstText(
    root: cheerio.Cheerio<any>,
    selectors: string[],
  ): string | null {
    for (const selector of selectors) {
      const text = this.cleanText(root.find(selector).first().text());
      if (text) return text;
    }
    return null;
  }

  private firstStringValue(...values: unknown[]): string | null {
    for (const value of values) {
      const first = this.stringValues(value)[0];
      if (first) return first;
    }
    return null;
  }

  private stringValues(value: unknown): string[] {
    const candidates = Array.isArray(value) ? value : [value];
    const seen = new Set<string>();
    const values: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const cleaned = this.cleanText(candidate);
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      values.push(cleaned);
    }
    return values;
  }

  private normalizeDate(value: string | null | undefined): string | null {
    if (!value) return null;
    const clean = this.cleanText(value).replace(
      /^(?:posted|posting|publication)?\s*date\s*:\s*/i,
      '',
    );
    const sapDate = clean.match(/\/Date\((\d+)/);
    const timestamp = sapDate ? Number(sapDate[1]) : Date.parse(clean);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().split('T')[0];
  }

  private normalizeResultsWanted(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return 100;
    return Math.max(0, Math.floor(value));
  }

  private parseInteger(value: string | null | undefined): number | null {
    if (value === undefined || value === null) return null;
    const parsed = Number.parseInt(String(value).replace(/,/g, ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  private responseHtml(value: unknown): string {
    return typeof value === 'string' ? value : String(value ?? '');
  }

  private cleanText(value: string): string {
    return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private humanize(value: string): string {
    const humanized = value
      .replace(/[:_-]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase())
      .trim();
    return humanized.replace(/\bCa$/, 'Canada');
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private hashCode(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = (hash << 5) - hash + value.charCodeAt(index);
      hash |= 0;
    }
    return hash;
  }
}
