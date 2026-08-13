import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { SourcePlugin } from '@ever-jobs/plugin';
import {
  DescriptionFormat,
  IScraper,
  JobPostDto,
  JobResponseDto,
  LocationDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import {
  BrowserPool,
  createHttpClient,
  htmlToPlainText,
  randomSleep,
} from '@ever-jobs/common';
import {
  ICIMS_DELAY_MAX,
  ICIMS_DELAY_MIN,
  ICIMS_CAREER_SITES_PAGE_SIZE,
  ICIMS_HEADERS,
  ICIMS_MAX_DISCOVERY_HOPS,
  ICIMS_MAX_PLAYWRIGHT_PAGES,
  ICIMS_PAGE_SIZE,
  ICIMS_PLAYWRIGHT_HYDRATION_MS,
  buildIcimsCareerSitesApiUrl,
  buildIcimsGatewayUrl,
  buildIcimsSearchUrl,
} from './icims.constants';
import { IcimsSourceError } from './icims-source.error';
import {
  IcimsGatewayResponse,
  IcimsHtmlParseResult,
  IcimsJibeJobData,
  IcimsJibeJobEnvelope,
  IcimsJobListItem,
  IcimsTenantContext,
} from './icims.types';

interface IcimsHttpResult {
  jobs: JobPostDto[];
  /** True for a successfully parsed board, including an explicit zero count. */
  definitive: boolean;
  /** Exact total advertised by the upstream board, when it exposed one. */
  advertisedCount?: number;
}

/**
 * iCIMS adapter supporting both legacy `*.icims.com` portals and the current
 * iCIMS Career Sites (Jibe) `/api/jobs` surface. HTTP parsing is primary;
 * Playwright is a small, bounded compatibility fallback for tenant skins that
 * expose neither public shape.
 */
@SourcePlugin({
  site: Site.ICIMS,
  name: 'iCIMS',
  category: 'ats',
  isAts: true,
})
@Injectable()
export class IcimsService implements IScraper, OnModuleDestroy {
  private readonly logger = new Logger(IcimsService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const tenant = this.resolveTenant(input);
    if (!tenant) {
      this.logger.warn('iCIMS scrape requires `companySlug` or `companyUrl`');
      return new JobResponseDto([]);
    }

    const resultsWanted = Math.max(0, input.resultsWanted ?? 100);
    if (resultsWanted === 0) return new JobResponseDto([]);

    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });
    client.setHeaders(ICIMS_HEADERS);

    const httpResult = await this.scrapeHttp(
      client,
      input,
      tenant,
      resultsWanted,
    );
    if (httpResult.definitive) {
      return new JobResponseDto(httpResult.jobs.slice(0, resultsWanted), {
        advertisedCount: httpResult.advertisedCount,
      });
    }

    this.logger.log(
      `iCIMS: public HTTP shapes were inconclusive for ${tenant.companySlug}; using bounded Playwright fallback`,
    );
    const browserResult = await this.scrapeWithPlaywright(
      input,
      tenant,
      resultsWanted,
    );
    return new JobResponseDto(browserResult.jobs.slice(0, resultsWanted), {
      advertisedCount: browserResult.advertisedCount,
    });
  }

  private resolveTenant(input: ScraperInputDto): IcimsTenantContext | null {
    const slug = input.companySlug?.trim();
    const explicitUrl = input.companyUrl?.trim();
    if (!slug && !explicitUrl) return null;

    let boardUrl: string;
    try {
      boardUrl = explicitUrl
        ? new URL(explicitUrl).toString()
        : buildIcimsSearchUrl(slug!);
    } catch (error) {
      throw new IcimsSourceError(
        'INVALID_TENANT',
        `Invalid iCIMS companyUrl: ${explicitUrl}`,
        error,
      );
    }

    const companySlug = slug ?? new URL(boardUrl).hostname.split('.')[0];
    return {
      companySlug,
      companyName: this.deriveCompanyName(companySlug),
      boardUrl,
      explicitCompanyUrl: Boolean(explicitUrl),
    };
  }

  private async scrapeHttp(
    client: ReturnType<typeof createHttpClient>,
    input: ScraperInputDto,
    tenant: IcimsTenantContext,
    resultsWanted: number,
  ): Promise<IcimsHttpResult> {
    // An explicit non-iCIMS careers URL is normally a current Career Sites
    // tenant (for example careers.kpmg.ca). Try its public JSON API first.
    if (
      tenant.explicitCompanyUrl &&
      !new URL(tenant.boardUrl).hostname.endsWith('.icims.com')
    ) {
      const careerSites = await this.collectCareerSitesJobs(
        client,
        input,
        tenant,
        tenant.boardUrl,
        resultsWanted,
      );
      if (careerSites.definitive) return careerSites;
    }

    let currentUrl = tenant.explicitCompanyUrl
      ? this.withLegacySearchParams(tenant.boardUrl, input)
      : this.buildGatewayPageUrl(tenant.companySlug, 0, input);

    const seen = new Set<string>();
    for (let hop = 0; hop <= ICIMS_MAX_DISCOVERY_HOPS; hop++) {
      if (seen.has(currentUrl)) break;
      seen.add(currentUrl);

      let payload: unknown;
      try {
        const response = await client.get<unknown>(currentUrl);
        payload = response.data;
      } catch (error: any) {
        this.logger.warn(
          `iCIMS HTTP request failed for ${tenant.companySlug}: ${error.message ?? String(error)}`,
        );
        return { jobs: [], definitive: false };
      }

      if (payload && typeof payload === 'object') {
        const data = payload as IcimsGatewayResponse;
        if (this.isCareerSitesResponse(data)) {
          return this.collectCareerSitesJobs(
            client,
            input,
            tenant,
            currentUrl,
            resultsWanted,
            data,
          );
        }
        return this.collectLegacyGatewayJobs(
          client,
          input,
          tenant,
          resultsWanted,
          data,
        );
      }

      const html = typeof payload === 'string' ? payload : '';
      const parsed = this.parseHtmlDocument(html, currentUrl);
      if (parsed.jobs.length > 0) {
        const jobs = parsed.jobs
          .map((job) => this.mapLegacyJob(job, tenant, input))
          .filter((job): job is JobPostDto => job !== null);
        this.assertExtraction(
          parsed.advertisedCount ?? parsed.jobs.length,
          jobs.length,
          tenant,
          currentUrl,
        );
        return {
          jobs: this.dedupe(jobs),
          definitive: true,
          advertisedCount: parsed.advertisedCount,
        };
      }

      if (parsed.advertisedCount === 0) {
        return { jobs: [], definitive: true, advertisedCount: 0 };
      }
      if ((parsed.advertisedCount ?? 0) > 0) {
        this.assertExtraction(
          parsed.advertisedCount!,
          0,
          tenant,
          currentUrl,
        );
      }

      if (parsed.discoveryUrl) {
        currentUrl = this.absoluteUrl(parsed.discoveryUrl, currentUrl);
        continue;
      }
      if (parsed.isJibePortal) {
        return this.collectCareerSitesJobs(
          client,
          input,
          tenant,
          currentUrl,
          resultsWanted,
        );
      }
      break;
    }

    return { jobs: [], definitive: false };
  }

  private async collectCareerSitesJobs(
    client: ReturnType<typeof createHttpClient>,
    input: ScraperInputDto,
    tenant: IcimsTenantContext,
    portalUrl: string,
    resultsWanted: number,
    firstPage?: IcimsGatewayResponse,
  ): Promise<IcimsHttpResult> {
    const jobs: JobPostDto[] = [];
    let totalCount: number | undefined;
    const pageLimit = Math.min(ICIMS_CAREER_SITES_PAGE_SIZE, resultsWanted);

    for (let page = 1; jobs.length < resultsWanted; page++) {
      let data: IcimsGatewayResponse;
      if (page === 1 && firstPage) {
        data = firstPage;
      } else {
        const url = buildIcimsCareerSitesApiUrl(
          portalUrl,
          page,
          pageLimit,
          input.searchTerm,
          input.location,
        );
        try {
          const response = await client.get<IcimsGatewayResponse>(url);
          if (!response.data || typeof response.data !== 'object') {
            return { jobs: [], definitive: false };
          }
          data = response.data;
        } catch (error: any) {
          this.logger.warn(
            `iCIMS Career Sites page ${page} failed for ${tenant.companySlug}: ${error.message ?? String(error)}`,
          );
          return jobs.length > 0
            ? {
                jobs: this.dedupe(jobs),
                definitive: true,
                advertisedCount: totalCount,
              }
            : {
                jobs: [],
                definitive: false,
                advertisedCount: totalCount,
              };
        }
      }

      const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
      totalCount = this.numericCount(data.totalCount ?? data.count) ?? totalCount;
      const parsed = rawJobs
        .map((raw) =>
          this.isJibeEnvelope(raw)
            ? this.mapJibeJob(raw.data!, tenant, input)
            : this.mapLegacyJob(raw as IcimsJobListItem, tenant, input),
        )
        .filter((job): job is JobPostDto => job !== null);

      if (rawJobs.length > 0 && parsed.length === 0) {
        this.assertExtraction(rawJobs.length, 0, tenant, portalUrl);
      }
      jobs.push(...parsed);

      if (page === 1 && (totalCount ?? 0) > 0 && jobs.length === 0) {
        this.assertExtraction(totalCount!, 0, tenant, portalUrl);
      }
      if (rawJobs.length === 0) break;
      if (totalCount !== undefined && page * pageLimit >= totalCount) break;
      if (rawJobs.length < pageLimit) break;

      await randomSleep(ICIMS_DELAY_MIN, ICIMS_DELAY_MAX);
    }

    if (totalCount === 0) {
      return { jobs: [], definitive: true, advertisedCount: 0 };
    }
    if (jobs.length > 0) {
      this.logger.log(
        `iCIMS Career Sites returned ${jobs.length} jobs for ${tenant.companySlug}`,
      );
      return {
        jobs: this.dedupe(jobs).slice(0, resultsWanted),
        definitive: true,
        advertisedCount: totalCount,
      };
    }
    return {
      jobs: [],
      definitive: totalCount !== undefined,
      advertisedCount: totalCount,
    };
  }

  private async collectLegacyGatewayJobs(
    client: ReturnType<typeof createHttpClient>,
    input: ScraperInputDto,
    tenant: IcimsTenantContext,
    resultsWanted: number,
    firstPage: IcimsGatewayResponse,
  ): Promise<IcimsHttpResult> {
    const jobs: JobPostDto[] = [];
    let offset = 0;
    let pageData: IcimsGatewayResponse | undefined = firstPage;
    let advertisedCount = this.numericCount(
      firstPage.totalCount ?? firstPage.count,
    );

    while (pageData && jobs.length < resultsWanted) {
      const rawJobs = Array.isArray(pageData.jobs) ? pageData.jobs : [];
      const parsed = rawJobs
        .map((raw) =>
          this.isJibeEnvelope(raw)
            ? this.mapJibeJob(raw.data!, tenant, input)
            : this.mapLegacyJob(raw as IcimsJobListItem, tenant, input),
        )
        .filter((job): job is JobPostDto => job !== null);
      if (rawJobs.length > 0 && parsed.length === 0) {
        this.assertExtraction(rawJobs.length, 0, tenant, tenant.boardUrl);
      }
      jobs.push(...parsed);

      if (rawJobs.length === 0 || rawJobs.length < ICIMS_PAGE_SIZE) break;
      offset += rawJobs.length;
      if (advertisedCount !== undefined && offset >= advertisedCount) break;
      if (jobs.length >= resultsWanted) break;

      await randomSleep(ICIMS_DELAY_MIN, ICIMS_DELAY_MAX);
      const url = this.buildGatewayPageUrl(tenant.companySlug, offset, input);
      try {
        const response = await client.get<IcimsGatewayResponse>(url);
        pageData = response.data;
        advertisedCount =
          this.numericCount(pageData?.totalCount ?? pageData?.count) ??
          advertisedCount;
      } catch (error: any) {
        this.logger.warn(
          `iCIMS gateway offset ${offset} failed for ${tenant.companySlug}: ${error.message ?? String(error)}`,
        );
        break;
      }
    }

    if ((advertisedCount ?? 0) > 0 && jobs.length === 0) {
      this.assertExtraction(
        advertisedCount!,
        0,
        tenant,
        tenant.boardUrl,
      );
    }
    return {
      jobs: this.dedupe(jobs).slice(0, resultsWanted),
      definitive: jobs.length > 0 || advertisedCount !== undefined,
      advertisedCount,
    };
  }

  private async scrapeWithPlaywright(
    input: ScraperInputDto,
    tenant: IcimsTenantContext,
    resultsWanted: number,
  ): Promise<IcimsHttpResult> {
    const proxy = input.proxies?.[0];
    let page: Awaited<ReturnType<typeof BrowserPool.getPage>> | undefined;
    const jobs: JobPostDto[] = [];
    let advertisedCount: number | undefined;

    try {
      page = await BrowserPool.getPage({ proxy, stealth: true });
      const timeoutMs = (input.requestTimeout ?? 30) * 1000;

      for (
        let pageNumber = 1;
        pageNumber <= ICIMS_MAX_PLAYWRIGHT_PAGES && jobs.length < resultsWanted;
        pageNumber++
      ) {
        const url = this.buildBrowserPageUrl(tenant, input, pageNumber);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(ICIMS_PLAYWRIGHT_HYDRATION_MS);

        const parsed = this.parseHtmlDocument(await page.content(), url);
        if (parsed.advertisedCount !== undefined) {
          advertisedCount = Math.max(
            advertisedCount ?? 0,
            parsed.advertisedCount,
          );
        }
        const mapped = parsed.jobs
          .map((job) => this.mapLegacyJob(job, tenant, input))
          .filter((job): job is JobPostDto => job !== null);
        if ((parsed.advertisedCount ?? 0) > 0 && mapped.length === 0) {
          this.assertExtraction(
            parsed.advertisedCount!,
            0,
            tenant,
            url,
          );
        }
        jobs.push(...mapped);
        const expectedPageSize =
          tenant.explicitCompanyUrl &&
          !new URL(tenant.boardUrl).hostname.endsWith('.icims.com')
            ? ICIMS_CAREER_SITES_PAGE_SIZE
            : ICIMS_PAGE_SIZE;
        if (parsed.advertisedCount === 0 || mapped.length < expectedPageSize) break;
      }

      this.logger.log(
        `iCIMS Playwright extracted ${jobs.length} jobs for ${tenant.companySlug}`,
      );
      return {
        jobs: this.dedupe(jobs).slice(0, resultsWanted),
        definitive: jobs.length > 0 || advertisedCount !== undefined,
        advertisedCount,
      };
    } catch (error: any) {
      if (error instanceof IcimsSourceError) throw error;
      this.logger.error(
        `iCIMS Playwright failed for ${tenant.companySlug}: ${error.message ?? String(error)}`,
      );
      return { jobs: [], definitive: false };
    } finally {
      if (page) {
        const context = page.context();
        await page.close().catch(() => undefined);
        await context.close().catch(() => undefined);
      }
    }
  }

  private parseHtmlDocument(html: string, baseUrl: string): IcimsHtmlParseResult {
    const $ = cheerio.load(html);
    const jobs: IcimsJobListItem[] = [];
    const seen = new Set<string>();
    const selectors = [
      '#searchresults tbody tr.data-row',
      '.iCIMS_JobsTable .row',
      '.listingTable tr',
      '[data-job-id]',
      '.iCIMS_MainContainer .listItem',
      'article.job',
      'li.job-listing',
    ];

    let cards: cheerio.Cheerio<any> | null = null;
    for (const selector of selectors) {
      const found = $(selector);
      if (found.length > 0) {
        cards = found;
        break;
      }
    }

    if (!cards || cards.length === 0) {
      cards = $('a[href*="/jobs/"]').filter((_index, element) =>
        /\/jobs\/[^/?#]+\/(?:job|login)?/i.test($(element).attr('href') ?? ''),
      );
    }

    cards.each((_index, element) => {
      const card = $(element);
      const isAnchor = element.tagName?.toLowerCase() === 'a';
      const link = isAnchor
        ? card
        : card
            .find(
              'a.jobTitle-link, a.iCIMS_Anchor, .iCIMS_JobTitle a, h2 a, h3 a, a[href*="/jobs/"]',
            )
            .first();
      const href = link.attr('href')?.trim() ?? '';
      const title = this.cleanText(link.text()) ?? '';
      const id =
        card.attr('data-job-id') ??
        href.match(/\/jobs\/([^/?#]+)/i)?.[1] ??
        null;
      if (!title || !href || seen.has(id ?? href)) return;
      seen.add(id ?? href);

      const container = isAnchor
        ? card.closest(
            'tr, article, li, .row, .listItem, [data-job-id], .job-result, .job',
          )
        : card;
      const location = this.firstText(container, [
        '.iCIMS_JobLocation',
        '.jobLocation:not(.visible-phone)',
        '.job-location',
        '.location',
        '[class*="location" i]',
      ]);
      const category = this.firstText(container, [
        '.iCIMS_JobCategory',
        '.jobCategory',
        '.category',
        '[class*="category" i]',
      ]);
      const datePosted = this.firstText(container, [
        '.iCIMS_JobDate',
        '.jobDate:not(.visible-phone)',
        '.posted-date',
        'time',
      ]);
      const employmentType = this.firstText(container, [
        '.position-type',
        '.employment-type',
        '[class*="positionType" i]',
      ]);
      const applicationDeadline = this.firstText(container, [
        '.application-deadline',
        '[class*="deadline" i]',
      ]);

      jobs.push({
        id,
        title,
        url: this.absoluteUrl(href, baseUrl),
        location,
        category,
        datePosted,
        employmentType,
        applicationDeadline,
      });
    });

    return {
      jobs,
      advertisedCount: this.extractAdvertisedCount($, html),
      discoveryUrl: this.extractDiscoveryUrl($, html),
      isJibePortal:
        /data-jibe-search-version|window\._jibe|app\.jibecdn\.com/i.test(html),
    };
  }

  private mapJibeJob(
    raw: IcimsJibeJobData,
    tenant: IcimsTenantContext,
    input: ScraperInputDto,
  ): JobPostDto | null {
    const title = raw.title?.trim();
    const jobId = String(raw.req_id ?? raw.slug ?? '').trim();
    if (!title || !jobId) return null;

    const locationText = raw.location_name ?? raw.full_location ?? null;
    const location =
      raw.city || raw.state || raw.country || locationText
        ? new LocationDto({
            city: raw.city ?? locationText ?? undefined,
            state: raw.state ?? undefined,
            country: raw.country ?? raw.country_code ?? undefined,
          })
        : null;
    const companyName =
      typeof raw.hiring_organization === 'string'
        ? raw.hiring_organization
        : raw.hiring_organization?.name ?? tenant.companyName;
    const jobUrl =
      raw.apply_url?.trim() ||
      `https://${tenant.companySlug}.icims.com/jobs/${encodeURIComponent(jobId)}/job`;
    const category =
      raw.department?.trim() ||
      raw.categories?.find((value) => value.name?.trim())?.name?.trim() ||
      raw.category?.trim() ||
      null;
    const employmentType =
      raw.tags1?.find((value) => value.trim()) ?? raw.employment_type ?? null;
    const description = this.formatDescription(raw.description, input);

    return new JobPostDto({
      id: `icims-${tenant.companySlug}-${jobId}`,
      title,
      companyName,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location,
      locations: location ? [location] : [],
      description,
      datePosted: raw.posted_date ?? raw.create_date ?? null,
      isRemote: /\bremote\b/i.test(locationText ?? ''),
      site: Site.ICIMS,
      atsId: jobId,
      atsType: 'icims',
      department: category,
      employmentType,
      // iCIMS exposes application deadlines through tenant-defined tags2.
      // JobPostDto has no deadline field, so retain the value as listing
      // metadata rather than incorrectly treating it as datePosted.
      listingType: raw.tags2?.find((value) => value.trim()) ?? null,
    });
  }

  private mapLegacyJob(
    raw: IcimsJobListItem,
    tenant: IcimsTenantContext,
    input: ScraperInputDto,
  ): JobPostDto | null {
    const title = raw.title?.trim();
    if (!title) return null;
    const jobId = raw.id?.trim() || this.hashId(raw.url || title);
    const jobUrl = raw.url
      ? this.absoluteUrl(raw.url, tenant.boardUrl)
      : `https://${tenant.companySlug}.icims.com/jobs/${encodeURIComponent(jobId)}/job`;
    const location = raw.location
      ? new LocationDto({ city: raw.location })
      : null;

    return new JobPostDto({
      id: `icims-${tenant.companySlug}-${jobId}`,
      title,
      companyName: raw.companyName ?? tenant.companyName,
      jobUrl,
      jobUrlDirect: jobUrl,
      applyUrl: jobUrl,
      location,
      locations: location ? [location] : [],
      description: this.formatDescription(raw.description, input),
      datePosted: raw.datePosted ?? null,
      isRemote: /\bremote\b/i.test(raw.location ?? ''),
      site: Site.ICIMS,
      atsId: raw.id ?? jobId,
      atsType: 'icims',
      department: raw.category ?? null,
      employmentType: raw.employmentType ?? null,
      listingType: raw.applicationDeadline ?? null,
    });
  }

  private formatDescription(
    raw: string | null | undefined,
    input: ScraperInputDto,
  ): string | null {
    if (!raw) return null;
    return input.descriptionFormat === DescriptionFormat.PLAIN
      ? htmlToPlainText(raw)
      : raw;
  }

  private isCareerSitesResponse(data: IcimsGatewayResponse): boolean {
    return (
      Array.isArray(data.jobs) &&
      data.jobs.some((job) => this.isJibeEnvelope(job))
    );
  }

  private isJibeEnvelope(
    raw: IcimsJobListItem | IcimsJibeJobEnvelope,
  ): raw is IcimsJibeJobEnvelope {
    return Boolean(
      raw &&
        typeof raw === 'object' &&
        'data' in raw &&
        (raw as IcimsJibeJobEnvelope).data,
    );
  }

  private assertExtraction(
    advertisedCount: number,
    parsedCount: number,
    tenant: IcimsTenantContext,
    url: string,
  ): void {
    if (advertisedCount > 0 && parsedCount === 0) {
      throw new IcimsSourceError(
        'EXTRACTION_EMPTY',
        `iCIMS advertised ${advertisedCount} jobs but parsed none for ${tenant.companySlug} (${url})`,
      );
    }
  }

  private extractAdvertisedCount(
    $: cheerio.CheerioAPI,
    html: string,
  ): number | undefined {
    const dataCount = $('[data-total-count], [data-job-count]')
      .first()
      .attr('data-total-count') ??
      $('[data-job-count]').first().attr('data-job-count');
    const candidates = [
      dataCount,
      $('.paginationLabel').first().text(),
      $('#searchresults').attr('aria-label'),
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const match = candidate.match(/\bof\s+([\d,]+)\b/i) ?? candidate.match(/^([\d,]+)$/);
      const value = this.numericCount(match?.[1]);
      if (value !== undefined) return value;
    }

    // `count` is far too generic for a large career-site shell (analytics,
    // facets and translations use it heavily). Only an explicit totalCount is
    // authoritative outside the structured JSON API response.
    const jsonCount = html.match(/["']totalCount["']\s*:\s*([\d,]+)/i);
    return this.numericCount(jsonCount?.[1]);
  }

  private extractDiscoveryUrl(
    $: cheerio.CheerioAPI,
    html: string,
  ): string | undefined {
    const iframe = $('iframe[src*="icims.com"], iframe[src*="/jobs"]')
      .first()
      .attr('src');
    if (iframe) return iframe.replace(/&amp;/g, '&');

    const scriptRedirect = html.match(
      /(?:window\.(?:top\.)?location(?:\.href)?|location\.href)\s*=\s*['"]([^'"]+)['"]/i,
    )?.[1];
    if (scriptRedirect) return scriptRedirect.replace(/\\\//g, '/');

    const refresh = $('meta[http-equiv="refresh" i]').attr('content');
    return refresh?.match(/url\s*=\s*['"]?([^'";]+)/i)?.[1];
  }

  private withLegacySearchParams(
    rawUrl: string,
    input: ScraperInputDto,
  ): string {
    const url = new URL(rawUrl);
    if (input.searchTerm) url.searchParams.set('searchKeyword', input.searchTerm);
    if (input.location) url.searchParams.set('searchLocation', input.location);
    if (!url.searchParams.has('ss')) url.searchParams.set('ss', '1');
    return url.toString();
  }

  private buildGatewayPageUrl(
    company: string,
    offset: number,
    input: ScraperInputDto,
  ): string {
    const url = new URL(buildIcimsGatewayUrl(company, offset));
    if (input.searchTerm) url.searchParams.set('searchKeyword', input.searchTerm);
    if (input.location) url.searchParams.set('searchLocation', input.location);
    return url.toString();
  }

  private buildBrowserPageUrl(
    tenant: IcimsTenantContext,
    input: ScraperInputDto,
    page: number,
  ): string {
    if (!tenant.explicitCompanyUrl) {
      return buildIcimsSearchUrl(
        tenant.companySlug,
        input.searchTerm,
        input.location,
        page,
      );
    }
    const url = new URL(tenant.boardUrl);
    if (input.searchTerm) {
      url.searchParams.set(
        url.hostname.endsWith('.icims.com') ? 'searchKeyword' : 'keywords',
        input.searchTerm,
      );
    }
    if (input.location) url.searchParams.set('location', input.location);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(ICIMS_CAREER_SITES_PAGE_SIZE));
    return url.toString();
  }

  private firstText(
    root: cheerio.Cheerio<any>,
    selectors: string[],
  ): string | null {
    for (const selector of selectors) {
      const value = this.cleanText(root.find(selector).first().text());
      if (value) return value;
    }
    return null;
  }

  private cleanText(value: string | null | undefined): string | null {
    const cleaned = value?.replace(/\s+/g, ' ').trim();
    return cleaned || null;
  }

  private numericCount(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    }
    if (typeof value !== 'string') return undefined;
    const parsed = Number.parseInt(value.replace(/,/g, ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private absoluteUrl(value: string, baseUrl: string): string {
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return value;
    }
  }

  private dedupe(jobs: JobPostDto[]): JobPostDto[] {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      const key = job.atsId ?? job.jobUrl ?? job.id ?? '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private deriveCompanyName(slug: string): string {
    const normalized = slug
      .replace(/^(?:students?|careers?|jobs?)-/i, '')
      .replace(/[-_]+/g, ' ');
    // KPMG Canada's public tenant is `students-kpmgca`; the API omits
    // hiring_organization on some campus requisitions.
    if (/^kpmgca$/i.test(normalized)) return 'KPMG Canada';
    return normalized
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  private hashId(value: string): string {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = (hash << 5) - hash + value.charCodeAt(index);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }

  async onModuleDestroy(): Promise<void> {
    await BrowserPool.close();
  }
}
