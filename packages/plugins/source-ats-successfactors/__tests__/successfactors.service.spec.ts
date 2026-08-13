import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { ScraperInputDto, Site } from '@ever-jobs/models';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockRandomSleep = jest.fn();
const mockCreateHttpClient = jest.fn(() => ({
  get: mockGet,
  post: mockPost,
  setHeaders: jest.fn(),
}));

jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: mockCreateHttpClient,
    randomSleep: mockRandomSleep,
  };
});

import { SuccessFactorsModule } from '../src/successfactors.module';
import { SuccessFactorsService } from '../src/successfactors.service';
import {
  SUCCESSFACTORS_EXTRACTION_ERROR_CODE,
  SuccessFactorsExtractionError,
} from '../src/successfactors.error';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

describe('SuccessFactorsService - Spec 6004', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockRandomSleep.mockReset();
    mockCreateHttpClient.mockClear();
    mockRandomSleep.mockResolvedValue(undefined);
  });

  it('resolves through its NestJS module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SuccessFactorsModule],
    }).compile();

    expect(moduleRef.get(SuccessFactorsService)).toBeInstanceOf(
      SuccessFactorsService,
    );
    await moduleRef.close();
  });

  it('returns empty without a companyUrl or companySlug', async () => {
    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('treats a /go/ companyUrl as authoritative and paginates with q/startrow', async () => {
    mockGet.mockImplementation(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.searchParams.get('startrow') === '0') {
        return { data: fixture('vanity-search-page-1.html') };
      }
      if (url.searchParams.get('startrow') === '2') {
        return { data: fixture('vanity-search-page-2.html') };
      }
      throw new Error(`unexpected URL: ${rawUrl}`);
    });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'scotiabank-canada',
      companyUrl:
        'https://jobs.scotiabank.com/go/Student-%26-New-Grad-Jobs/2298417/',
      searchTerm: 'Summer 2027',
      resultsWanted: 10,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(3);
    expect(result.advertisedCount).toBe(3);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockRandomSleep).toHaveBeenCalledTimes(1);

    const firstUrl = new URL(mockGet.mock.calls[0][0]);
    expect(firstUrl.hostname).toBe('jobs.scotiabank.com');
    expect(firstUrl.pathname).toBe(
      '/go/Student-%26-New-Grad-Jobs/2298417/',
    );
    expect(firstUrl.searchParams.get('q')).toBe('Summer 2027');
    expect(firstUrl.searchParams.get('startrow')).toBe('0');

    const secondUrl = new URL(mockGet.mock.calls[1][0]);
    expect(secondUrl.searchParams.get('startrow')).toBe('2');
    expect(mockGet.mock.calls.every(([url]) => !String(url).includes('.successfactors.com'))).toBe(
      true,
    );

    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        id: 'sf-jobs-scotiabank-com-SCO-101',
        title: 'Technology Risk Summer Intern 2027',
        companyName: 'Scotiabank Canada',
        jobUrl:
          'https://jobs.scotiabank.com/job/Toronto-Technology-Risk-Summer-Intern/SCO-101/',
        jobUrlDirect:
          'https://jobs.scotiabank.com/job/Toronto-Technology-Risk-Summer-Intern/SCO-101/',
        applyUrl:
          'https://jobs.scotiabank.com/job/Toronto-Technology-Risk-Summer-Intern/SCO-101/',
        datePosted: '2026-08-12',
        department: 'Technology Risk',
        employmentType: 'Internship',
        site: Site.SUCCESSFACTORS,
      }),
    );
    expect(result.jobs[0].location).toEqual(
      expect.objectContaining({ city: 'Toronto', state: 'ON', country: 'CA' }),
    );
    expect(result.jobs[2].jobUrl).toBe(
      'https://jobs.scotiabank.com/go/Student-%26-New-Grad-Jobs/job/Mississauga-Data-Engineering-Co-op/SCO-103/',
    );
  });

  it('preserves existing /search/ query parameters and supports an explicit zero result', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('vanity-empty.html') });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'deloitte-canada',
      companyUrl:
        'https://careers.deloitte.ca/search/?createNewAlert=false&locationsearch=Toronto',
      searchTerm: 'co-op',
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBe(0);
    const url = new URL(mockGet.mock.calls[0][0]);
    expect(url.pathname).toBe('/search/');
    expect(url.searchParams.get('createNewAlert')).toBe('false');
    expect(url.searchParams.get('locationsearch')).toBe('Toronto');
    expect(url.searchParams.get('q')).toBe('co-op');
    expect(url.searchParams.get('startrow')).toBe('0');
  });

  it('falls back to Deloitte RMK unified search and paginates zero-based pages', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('deloitte-client-shell.html') });
    mockPost.mockImplementation(async (_url: string, body: { pageNumber: number }) => {
      if (body.pageNumber === 0) {
        return { data: JSON.parse(fixture('deloitte-rmk-page-0.json')) };
      }
      if (body.pageNumber === 1) {
        return { data: JSON.parse(fixture('deloitte-rmk-page-1.json')) };
      }
      throw new Error(`unexpected RMK page ${body.pageNumber}`);
    });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'deloitte-ca',
      companyUrl: 'https://careers.deloitte.ca/search/',
      searchTerm: 'Summer 2027',
      location: 'Toronto',
      resultsWanted: 3,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(3);
    expect(result.advertisedCount).toBe(26);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockRandomSleep).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe(
      'https://careers.deloitte.ca/services/recruiting/v1/jobs',
    );
    expect(mockPost.mock.calls[0][1]).toEqual({
      keywords: 'Summer 2027',
      locale: 'en_US',
      location: 'Toronto',
      pageNumber: 0,
      sortBy: 'recent',
    });
    expect(mockPost.mock.calls[1][1]).toEqual(
      expect.objectContaining({ pageNumber: 1 }),
    );

    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        id: 'sf-careers-deloitte-ca-DEL-1001',
        title: 'Technology Risk Analyst Intern - Summer 2027',
        companyName: 'Deloitte Canada',
        jobUrl:
          'https://careers.deloitte.ca/job/Technology-Risk-Analyst-Intern-Summer-2027/DEL-1001-en_US/',
        jobUrlDirect:
          'https://careers.deloitte.ca/job/Technology-Risk-Analyst-Intern-Summer-2027/DEL-1001-en_US/',
        applyUrl:
          'https://careers.deloitte.ca/job/Technology-Risk-Analyst-Intern-Summer-2027/DEL-1001-en_US/',
        datePosted: '2026-08-12',
        department: 'Technology & Transformation',
        employmentType: 'Internship',
        description: 'Assess technology controls with the digital risk team.',
      }),
    );
    expect(result.jobs[0].location).toEqual(
      expect.objectContaining({ city: 'Toronto', state: 'ON' }),
    );
    expect(result.jobs[0].locations).toHaveLength(2);
    expect(result.jobs[2]).toEqual(
      expect.objectContaining({
        id: 'sf-careers-deloitte-ca-DEL-1026',
        title: 'Cybersecurity Co-op - Summer 2027',
        employmentType: 'Co-op',
      }),
    );
  });

  it('preserves an explicit zero from Deloitte RMK unified search', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('deloitte-client-shell.html') });
    mockPost.mockResolvedValueOnce({
      data: JSON.parse(fixture('deloitte-rmk-zero.json')),
    });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'deloitte-ca',
      companyUrl: 'https://careers.deloitte.ca/search/',
      searchTerm: 'no-such-role',
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBe(0);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('throws the typed drift error for malformed positive Deloitte RMK results', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('deloitte-client-shell.html') });
    mockPost.mockResolvedValueOnce({
      data: JSON.parse(fixture('deloitte-rmk-malformed-positive.json')),
    });

    await expect(
      new SuccessFactorsService().scrape({
        siteType: [Site.SUCCESSFACTORS],
        companySlug: 'deloitte-ca',
        companyUrl: 'https://careers.deloitte.ca/search/',
      } as ScraperInputDto),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'SuccessFactorsExtractionError',
        code: SUCCESSFACTORS_EXTRACTION_ERROR_CODE,
        companySlug: 'deloitte-ca',
        advertisedResultCount: 1,
      }),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('parses a direct /job/ companyUrl without rewriting or adding search parameters', async () => {
    const companyUrl =
      'https://jobs.bell.ca/job/Toronto-Cybersecurity-Intern/BELL-9001/';
    mockGet.mockResolvedValueOnce({ data: fixture('vanity-job-detail.html') });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'bell-canada',
      companyUrl,
      searchTerm: 'ignored on a direct detail URL',
    } as ScraperInputDto);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(companyUrl);
    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBeUndefined();
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        id: 'sf-jobs-bell-ca-BELL-9001',
        title: 'Cybersecurity Intern - Summer 2027',
        companyName: 'Bell Canada',
        jobUrl:
          'https://jobs.bell.ca/job/Toronto-Cybersecurity-Intern/BELL-9001/',
        jobUrlDirect:
          'https://jobs.bell.ca/job/Toronto-Cybersecurity-Intern/BELL-9001/',
        datePosted: '2026-08-12',
        description:
          'Build secure platforms with the technology team.\nQuestions: campus@example.ca',
        employmentType: 'INTERN, COOP',
        department: 'Security',
      }),
    );
    expect(result.jobs[0].emails).toContain('campus@example.ca');
    expect(result.jobs[0].location).toEqual(
      expect.objectContaining({ city: 'Toronto', state: 'ON', country: 'CA' }),
    );
  });

  it('honours resultsWanted mid-page and avoids an unnecessary pagination call', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('vanity-search-page-1.html') });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'rogers',
      companyUrl: 'https://jobs.rogers.com/search/',
      resultsWanted: 1,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBe(3);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockRandomSleep).not.toHaveBeenCalled();
  });

  it('keeps the legacy instance:companyId OData path', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        d: {
          __count: '1',
          results: [
            {
              jobReqId: 'LEG-42',
              jobTitle: 'Cloud Engineering Intern - Summer 2027',
              jobDescription: '<p>Build cloud services.</p>',
              locationObj: {
                city: 'Toronto',
                state: 'ON',
                country: 'CA',
              },
              department: 'Technology',
              postingStartDate: '/Date(1786492800000)/',
              employmentType: 'Intern',
              companyName: 'Legacy Company',
              externalJobUrl: '/career?company=LegacyCo&jobId=LEG-42',
            },
          ],
        },
      },
    });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'legacy:LegacyCo',
      resultsWanted: 10,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBe(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(String(mockGet.mock.calls[0][0])).toMatch(
      /^https:\/\/legacy\.successfactors\.com\/odata\/v2\/JobRequisitionPosting\?/,
    );
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        id: 'sf-legacy-LEG-42',
        title: 'Cloud Engineering Intern - Summer 2027',
        companyName: 'Legacy Company',
        jobUrl:
          'https://legacy.successfactors.com/career?company=LegacyCo&jobId=LEG-42',
        jobUrlDirect:
          'https://legacy.successfactors.com/career?company=LegacyCo&jobId=LEG-42',
        department: 'Technology',
        employmentType: 'Intern',
      }),
    );
  });

  it('retains the legacy HTML fallback when OData has a real zero result', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { d: { __count: '0', results: [] } } })
      .mockResolvedValueOnce({ data: fixture('legacy-career.html') });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'legacy:LegacyCo',
      searchTerm: 'co-op',
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBe(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls[1][0]).toBe(
      'https://legacy.successfactors.com/career?company=LegacyCo&keyword=co-op',
    );
    expect(result.jobs[0].jobUrl).toBe(
      'https://legacy.successfactors.com/career?company=LegacyCo&jobId=LEG-7',
    );
  });

  it('preserves an explicit legacy zero count after both official surfaces are empty', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { d: { __count: '0', results: [] } } })
      .mockResolvedValueOnce({ data: fixture('vanity-empty.html') });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'legacy:LegacyCo',
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBe(0);
  });

  it('does not present a capped OData page length as an official total', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        d: {
          results: [
            {
              jobReqId: 'NO-COUNT-1',
              jobTitle: 'Systems Analyst Co-op - Summer 2027',
              locationObj: { city: 'Toronto', state: 'ON', country: 'CA' },
            },
          ],
        },
      },
    });

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'legacy:LegacyCo',
      resultsWanted: 1,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBeUndefined();
  });

  it('throws a typed extraction error when a vanity board advertises jobs but parses none', async () => {
    mockGet.mockResolvedValueOnce({
      data: fixture('vanity-advertised-unparsed.html'),
    });

    let thrown: unknown;
    try {
      await new SuccessFactorsService().scrape({
        siteType: [Site.SUCCESSFACTORS],
        companySlug: 'kpmg-canada',
        companyUrl: 'https://careers.example.ca/go/Students/1234/',
      } as ScraperInputDto);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SuccessFactorsExtractionError);
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(thrown).toEqual(
      expect.objectContaining({
        name: 'SuccessFactorsExtractionError',
        code: SUCCESSFACTORS_EXTRACTION_ERROR_CODE,
        companySlug: 'kpmg-canada',
        advertisedResultCount: 106,
      }),
    );
  });

  it('throws the same typed error after legacy fallbacks parse zero advertised jobs', async () => {
    mockGet
      .mockResolvedValueOnce({ data: { d: { __count: '7', results: [] } } })
      .mockResolvedValueOnce({ data: fixture('vanity-empty.html') });

    await expect(
      new SuccessFactorsService().scrape({
        siteType: [Site.SUCCESSFACTORS],
        companySlug: 'legacy:LegacyCo',
      } as ScraperInputDto),
    ).rejects.toEqual(
      expect.objectContaining({
        code: SUCCESSFACTORS_EXTRACTION_ERROR_CODE,
        companySlug: 'legacy:LegacyCo',
        advertisedResultCount: 7,
      }),
    );
  });

  it('does not fall back to a slug-derived host when authoritative companyUrl is invalid', async () => {
    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'legacy:LegacyCo',
      companyUrl: 'mailto:careers@example.ca',
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns a normal empty response after an HTTP failure with no advertised count', async () => {
    mockGet.mockRejectedValueOnce(new Error('request failed'));
    mockPost.mockRejectedValueOnce(new Error('RMK request failed'));

    const result = await new SuccessFactorsService().scrape({
      siteType: [Site.SUCCESSFACTORS],
      companySlug: 'telus',
      companyUrl: 'https://careers.telus.com/search/',
    } as ScraperInputDto);

    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBeUndefined();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
