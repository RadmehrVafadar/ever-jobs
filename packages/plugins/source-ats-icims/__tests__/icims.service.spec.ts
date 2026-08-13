import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {
  DescriptionFormat,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';

const mockGet = jest.fn();
const mockSetHeaders = jest.fn();
const mockGetPage = jest.fn();
const mockBrowserClose = jest.fn();
const mockGoto = jest.fn();
const mockWaitForTimeout = jest.fn();
const mockContent = jest.fn();
const mockPageClose = jest.fn();
const mockContextClose = jest.fn();

jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({
      get: mockGet,
      setHeaders: mockSetHeaders,
    })),
    randomSleep: jest.fn(() => Promise.resolve()),
    BrowserPool: {
      getPage: mockGetPage,
      close: mockBrowserClose,
    },
  };
});

import {
  IcimsModule,
  IcimsService,
  IcimsSourceError,
} from '../src';

const FIXTURES = join(__dirname, 'fixtures');
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), 'utf8');
const fixtureJson = <T = any>(name: string): T =>
  JSON.parse(fixture(name)) as T;

function input(overrides: Partial<ScraperInputDto> = {}): ScraperInputDto {
  return {
    siteType: [Site.ICIMS],
    companySlug: 'students-kpmgca',
    resultsWanted: 25,
    ...overrides,
  } as ScraperInputDto;
}

describe('IcimsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPage.mockResolvedValue({
      goto: mockGoto,
      waitForTimeout: mockWaitForTimeout,
      content: mockContent,
      close: mockPageClose,
      context: () => ({ close: mockContextClose }),
    });
    mockGoto.mockResolvedValue(undefined);
    mockWaitForTimeout.mockResolvedValue(undefined);
    mockPageClose.mockResolvedValue(undefined);
    mockContextClose.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
  });

  it('resolves through its Nest module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IcimsModule],
    }).compile();
    expect(moduleRef.get(IcimsService)).toBeInstanceOf(IcimsService);
    await moduleRef.close();
  });

  it('uses an explicit Career Sites URL and maps KPMG fields/direct links', async () => {
    mockGet.mockResolvedValueOnce({
      data: fixtureJson('kpmg-career-sites-page.json'),
    });

    const result = await new IcimsService().scrape(
      input({
        companyUrl: 'https://careers.kpmg.ca/students/jobs',
        searchTerm: 'Summer 2027',
        location: 'Toronto',
        descriptionFormat: DescriptionFormat.PLAIN,
      }),
    );

    expect(result).toBeInstanceOf(JobResponseDto);
    expect(result.jobs).toHaveLength(2);
    expect(result.advertisedCount).toBe(2);
    expect(mockGetPage).not.toHaveBeenCalled();

    const first = result.jobs[0];
    expect(first.id).toBe('icims-students-kpmgca-33352');
    expect(first.companyName).toBe('KPMG Canada');
    expect(first.location?.city).toBe('Toronto');
    expect(first.location?.state).toBe('Ontario');
    expect(first.location?.country).toBe('Canada');
    expect(first.department).toBe('Advisory');
    expect(first.employmentType).toBe('Intern/Co-op');
    expect(first.listingType).toBe(
      'Application deadline: September 13, 2026',
    );
    expect(first.description).toBe('Build digital infrastructure models.');
    expect(first.jobUrl).toBe(
      'https://students-kpmgca.icims.com/jobs/33352/login',
    );
    expect(first.applyUrl).toBe(first.jobUrl);
    expect(first.jobUrlDirect).toBe(first.jobUrl);

    const calledUrl = new URL(mockGet.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe('/api/jobs');
    expect(calledUrl.searchParams.get('keywords')).toBe('Summer 2027');
    expect(calledUrl.searchParams.get('location')).toBe('Toronto');
    expect(calledUrl.searchParams.get('page')).toBe('1');
  });

  it('discovers an iCIMS iframe and Career Sites redirect from a slug', async () => {
    mockGet
      .mockResolvedValueOnce({ data: fixture('kpmg-wrapper.html') })
      .mockResolvedValueOnce({ data: fixture('kpmg-redirect.html') })
      .mockResolvedValueOnce({
        data: '<html data-jibe-search-version="4.11"><script>window._jibe = {};</script></html>',
      })
      .mockResolvedValueOnce({
        data: fixtureJson('kpmg-career-sites-page.json'),
      });

    const result = await new IcimsService().scrape(
      input({ searchTerm: 'Summer 2027' }),
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.advertisedCount).toBe(2);
    expect(mockGet).toHaveBeenCalledTimes(4);
    expect(mockGet.mock.calls[1][0]).toContain('in_iframe=1');
    expect(mockGet.mock.calls[2][0]).toContain('careers.kpmg.ca/students/jobs');
    expect(mockGet.mock.calls[3][0]).toContain('careers.kpmg.ca/api/jobs');
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('parses deterministic legacy server-rendered cards and advertised count', async () => {
    mockGet.mockResolvedValueOnce({ data: fixture('legacy-board.html') });

    const result = await new IcimsService().scrape(
      input({ companySlug: 'example', resultsWanted: 10 }),
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.advertisedCount).toBe(2);
    expect(result.jobs[0]).toMatchObject({
      id: 'icims-example-7001',
      title: 'QA Automation Intern - Summer 2027',
      companyName: 'Example',
      department: 'Technology',
      employmentType: 'Intern/Co-op',
      listingType: 'September 13, 2026',
      jobUrl: 'https://example.icims.com/jobs/7001/job',
    });
    expect(result.jobs[1].jobUrl).toBe(
      'https://example.icims.com/jobs/7002/login',
    );
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('paginates the Career Sites API with a stable page size and result cap', async () => {
    const template = fixtureJson<any>('kpmg-career-sites-page.json');
    const makeJob = (index: number) => {
      const cloned = JSON.parse(JSON.stringify(template.jobs[0]));
      cloned.data.req_id = String(40000 + index);
      cloned.data.slug = cloned.data.req_id;
      cloned.data.title = `Summer 2027 Technology Intern ${index}`;
      cloned.data.apply_url = `https://students-kpmgca.icims.com/jobs/${cloned.data.req_id}/login`;
      return cloned;
    };
    mockGet
      .mockResolvedValueOnce({
        data: {
          jobs: Array.from({ length: 25 }, (_value, index) => makeJob(index)),
          totalCount: 26,
          count: 26,
        },
      })
      .mockResolvedValueOnce({
        data: { jobs: [makeJob(25)], totalCount: 26, count: 26 },
      });

    const result = await new IcimsService().scrape(
      input({
        companyUrl: 'https://careers.kpmg.ca/students/jobs',
        resultsWanted: 26,
      }),
    );

    expect(result.jobs).toHaveLength(26);
    expect(result.advertisedCount).toBe(26);
    expect(mockGet).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(mockGet.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get('page')).toBe('2');
    expect(secondUrl.searchParams.get('limit')).toBe('25');
  });

  it('retains 20-row pagination for the legacy iCIMS gateway', async () => {
    const makeJob = (index: number) => ({
      id: String(50000 + index),
      title: `Legacy Technology Intern ${index}`,
      url: `/jobs/${50000 + index}/job`,
      location: 'Toronto, Ontario',
      category: 'Technology',
    });
    mockGet
      .mockResolvedValueOnce({
        data: {
          jobs: Array.from({ length: 20 }, (_value, index) => makeJob(index)),
          totalCount: 21,
        },
      })
      .mockResolvedValueOnce({
        data: { jobs: [makeJob(20)], totalCount: 21 },
      });

    const result = await new IcimsService().scrape(
      input({ companySlug: 'legacy', resultsWanted: 21 }),
    );

    expect(result.jobs).toHaveLength(21);
    expect(result.advertisedCount).toBe(21);
    expect(mockGet).toHaveBeenCalledTimes(2);
    const secondUrl = new URL(mockGet.mock.calls[1][0] as string);
    expect(secondUrl.searchParams.get('pr')).toBe('20');
    expect(secondUrl.searchParams.get('o')).toBe('20');
  });

  it('returns an explicit zero-result board without invoking Playwright', async () => {
    mockGet.mockResolvedValueOnce({
      data: { jobs: [], totalCount: 0, count: 0 },
    });

    const result = await new IcimsService().scrape(
      input({ companyUrl: 'https://careers.kpmg.ca/students/jobs' }),
    );
    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBe(0);
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('throws a typed extraction failure when JSON advertises jobs but maps none', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        jobs: [{ data: { req_id: '99999', title: '' } }],
        totalCount: 106,
        count: 106,
      },
    });

    const rejection = new IcimsService().scrape(
      input({ companyUrl: 'https://careers.kpmg.ca/students/jobs' }),
    );
    await expect(rejection).rejects.toMatchObject({
      name: 'IcimsSourceError',
      code: 'EXTRACTION_EMPTY',
    });
    await expect(rejection).rejects.toBeInstanceOf(IcimsSourceError);
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it('throws a typed extraction failure for an unsupported positive-count HTML layout', async () => {
    mockGet.mockResolvedValueOnce({
      data: fixture('advertised-but-unparseable.html'),
    });

    await expect(
      new IcimsService().scrape(input({ companySlug: 'changed-layout' })),
    ).rejects.toMatchObject({ code: 'EXTRACTION_EMPTY' });
  });

  it('uses the bounded Playwright fallback only for an inconclusive HTTP page', async () => {
    mockGet.mockResolvedValueOnce({ data: '<html><body>Loading</body></html>' });
    mockContent.mockResolvedValueOnce(fixture('legacy-board.html'));

    const result = await new IcimsService().scrape(
      input({ companySlug: 'example', resultsWanted: 10 }),
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.advertisedCount).toBe(2);
    expect(mockGetPage).toHaveBeenCalledTimes(1);
    expect(mockGoto).toHaveBeenCalledTimes(1);
    expect(mockWaitForTimeout).toHaveBeenCalledWith(2500);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(mockContextClose).toHaveBeenCalledTimes(1);
  });

  it('returns empty without making requests when no tenant identifier is provided', async () => {
    const result = await new IcimsService().scrape({} as ScraperInputDto);
    expect(result.jobs).toEqual([]);
    expect(result.advertisedCount).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockGetPage).not.toHaveBeenCalled();
  });
});
