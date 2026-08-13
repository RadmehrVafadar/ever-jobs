import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { Country, DescriptionFormat, ScraperInputDto, Site } from '@ever-jobs/models';

const mockGet = jest.fn();
const mockSetHeaders = jest.fn();
jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({ get: mockGet, setHeaders: mockSetHeaders })),
  };
});

import { YelloModule, YelloService, YelloSourceError } from '../src';

const fixture = (name: string): string =>
  fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const search = JSON.parse(fixture('search.json')) as Record<string, unknown>;

describe('YelloService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSetHeaders.mockReset();
  });

  it('registers through NestJS and pins the source enum', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [YelloModule] }).compile();
    expect(moduleRef.get(YelloService)).toBeInstanceOf(YelloService);
    expect(Site.YELLO).toBe('yello');
    await moduleRef.close();
  });

  it('uses public search, maps opaque ids/details/direct URLs, and filters by country', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.endsWith('/search')) return { data: search };
      if (url.includes('/job_boards/')) return { data: fixture('board.html') };
      if (url.includes('opaque-ca')) return { data: fixture('detail-canada.html') };
      if (url.includes('opaque-us')) return { data: fixture('detail-us.html') };
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await new YelloService().scrape({
      companySlug: 'board-token',
      companyUrl: 'https://eyglobal.yello.co/jobs',
      searchTerm: 'Summer 2027',
      country: Country.CANADA,
      resultsWanted: 10,
      descriptionFormat: DescriptionFormat.HTML,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(1);
    expect(result.advertisedCount).toBe(2);
    expect(result.jobs[0]).toMatchObject({
      id: 'yello-opaque-ca',
      atsId: 'CAN-1001',
      atsType: 'yello',
      site: Site.YELLO,
      title: 'Summer 2027 Technology Risk Intern',
      companyName: 'Eyglobal',
      jobUrl: 'https://eyglobal.yello.co/jobs/opaque-ca?job_board_id=board-token',
      applyUrl: 'https://eyglobal.yello.co/external/requisitions/opaque-ca/apply?locale=en',
      department: 'Consulting',
    });
    expect(result.jobs[0].locations?.map((location) => location.city)).toEqual(['Toronto', 'Markham']);
    expect(result.jobs[0].emails).toEqual(['campus@example.test']);

    const searchCall = mockGet.mock.calls.find(([url]) => String(url).endsWith('/search'));
    expect(searchCall?.[1].params).toEqual({
      query: 'Summer 2027',
      filters: '29971',
      page_number: 1,
    });
  });

  it('bounds pagination and passes deterministic page numbers', async () => {
    const first = { ...search, html: String(search.html).split('</li>')[0] + '</li>', count_on_page: 1, more_requisitions: true };
    const second = { ...search, html: String(search.html).split('</li>')[1] + '</li>', count_on_page: 1, more_requisitions: false };
    mockGet.mockImplementation(async (url: string, config?: { params?: { page_number?: number } }) => {
      if (url.endsWith('/search')) return { data: config?.params?.page_number === 1 ? first : second };
      return { data: url.includes('opaque-ca') ? fixture('detail-canada.html') : fixture('detail-us.html') };
    });
    const result = await new YelloService().scrape({
      companySlug: 'board-token',
      companyUrl: 'https://eyglobal.yello.co',
      resultsWanted: 2,
    } as ScraperInputDto);
    expect(result.jobs).toHaveLength(2);
    const pages = mockGet.mock.calls.filter(([url]) => String(url).endsWith('/search')).map(([, config]) => config.params.page_number);
    expect(pages).toEqual([1, 2]);
  });

  it('throws a typed extraction failure for advertised positive results with zero cards', async () => {
    mockGet.mockResolvedValue({ data: { html: '<div>new layout</div>', count_on_page: 3, display_count_text: '3 Results', more_requisitions: false } });
    await expect(new YelloService().scrape({
      companySlug: 'board-token', companyUrl: 'https://eyglobal.yello.co',
    } as ScraperInputDto)).rejects.toMatchObject<Partial<YelloSourceError>>({ code: 'MARKUP_CHANGED' });
  });

  it('distinguishes a legitimate empty board and validates input', async () => {
    mockGet.mockResolvedValue({ data: { html: '', count_on_page: 0, display_count_text: '0 Results', more_requisitions: false } });
    await expect(new YelloService().scrape({
      companySlug: 'board-token', companyUrl: 'https://eyglobal.yello.co',
    } as ScraperInputDto)).resolves.toMatchObject({ jobs: [], advertisedCount: 0 });
    await expect(new YelloService().scrape({} as ScraperInputDto)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
