import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { DescriptionFormat, JobType, ScraperInputDto, Site } from '@ever-jobs/models';

const mockPost = jest.fn();
const mockGet = jest.fn();
const mockSetHeaders = jest.fn();
jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({ post: mockPost, get: mockGet, setHeaders: mockSetHeaders })),
  };
});

import { AccentureModule, AccentureService, AccentureSourceError } from '../src';

const search = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'search.json'), 'utf8')) as Record<string, unknown>;
const detail = fs.readFileSync(path.join(__dirname, 'fixtures', 'detail.html'), 'utf8');

describe('AccentureService', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    mockSetHeaders.mockReset();
    mockGet.mockRejectedValue(new Error('detail unavailable'));
  });

  it('registers through NestJS and pins the source enum', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AccentureModule] }).compile();
    expect(moduleRef.get(AccentureService)).toBeInstanceOf(AccentureService);
    expect(Site.ACCENTURE).toBe('accenture');
    await moduleRef.close();
  });

  it('queries only the official Canadian feed and maps detail/direct application fields', async () => {
    mockPost.mockResolvedValue({ data: search });
    mockGet.mockImplementation(async (url: string) => {
      if (url.includes('R100_en')) return { data: detail };
      throw new Error('detail unavailable');
    });
    const result = await new AccentureService().scrape({
      searchTerm: 'Summer 2027',
      resultsWanted: 10,
      descriptionFormat: DescriptionFormat.HTML,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(2);
    expect(result.advertisedCount).toBe(2);
    expect(result.jobs[0]).toMatchObject({
      id: 'accenture-R100',
      atsId: 'R100',
      atsType: 'accenture',
      site: Site.ACCENTURE,
      companyName: 'Accenture Canada',
      jobUrl: 'https://www.accenture.com/ca-en/careers/jobdetails?id=R100_en&title=Software+Intern',
      title: 'Summer 2027 Software Engineering Intern - Enriched',
      applyUrl: 'https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/Toronto/Enriched_R100/apply',
      datePosted: '2026-08-11',
      department: 'Software Engineering',
      jobType: [JobType.INTERNSHIP],
    });
    expect(result.jobs[0].locations?.map((location) => location.city)).toEqual(['Toronto', 'Markham']);
    expect(result.jobs[0].skills).toEqual(['Software Engineering', 'Cloud', 'TypeScript']);
    expect(result.jobs[0].emails).toEqual(['internships@example.test']);
    expect(mockGet).toHaveBeenCalledTimes(2);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('https://www.accenture.com/api/accenture/elastic/findjobs');
    const form = new URLSearchParams(body);
    expect(form.get('jobCountry')).toBe('Canada');
    expect(form.get('countrySite')).toBe('ca-en');
    expect(form.get('jobKeyword')).toBe('Summer 2027');
    expect(form.get('maxResultSize')).toBe('25');
    expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('uses bounded offset pagination and de-duplicates requisitions', async () => {
    const template = (search.data as Record<string, unknown>[])[0];
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...template,
      requisitionId: `R${index}`,
      guid: `R${index}_en`,
      jobDetailUrl: `https://www.accenture.com/{0}/careers/jobdetails?id=R${index}_en`,
    }));
    mockPost
      .mockResolvedValueOnce({ data: { data: firstPage, totalHits: { total: 26 } } })
      .mockResolvedValueOnce({ data: { data: [{ ...template, requisitionId: 'R25', guid: 'R25_en' }], totalHits: { total: 26 } } });

    let activeDetails = 0;
    let maxActiveDetails = 0;
    mockGet.mockImplementation(async (url: string) => {
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      activeDetails -= 1;
      const id = /[?&]id=(R\d+)_en/.exec(url)?.[1] ?? 'R0';
      return { data: detail.replace('"value": "R100"', `"value": "${id}"`) };
    });

    const result = await new AccentureService().scrape({ resultsWanted: 30 } as ScraperInputDto);
    expect(result.jobs).toHaveLength(26);
    const offsets = mockPost.mock.calls.map(([, body]) => new URLSearchParams(body).get('startIndex'));
    expect(offsets).toEqual(['0', '25']);
    expect(mockGet).toHaveBeenCalledTimes(25);
    expect(maxActiveDetails).toBe(4);
  });

  it('continues pagination when the feed underfills a page but total hits indicate more results', async () => {
    const template = (search.data as Record<string, unknown>[])[0];
    const firstPage = Array.from({ length: 10 }, (_, index) => ({
      ...template,
      requisitionId: `U${index}`,
      guid: `U${index}_en`,
      jobDetailUrl: `https://www.accenture.com/{0}/careers/jobdetails?id=U${index}_en`,
    }));
    const secondPage = Array.from({ length: 5 }, (_, index) => ({
      ...template,
      requisitionId: `U${index + 10}`,
      guid: `U${index + 10}_en`,
      jobDetailUrl: `https://www.accenture.com/{0}/careers/jobdetails?id=U${index + 10}_en`,
    }));
    mockPost
      .mockResolvedValueOnce({ data: { data: firstPage, totalHits: { total: 15 } } })
      .mockResolvedValueOnce({ data: { data: secondPage, totalHits: { total: 15 } } });

    const result = await new AccentureService().scrape({ resultsWanted: 20 } as ScraperInputDto);
    expect(result.jobs).toHaveLength(15);
    const offsets = mockPost.mock.calls.map(([, body]) => new URLSearchParams(body).get('startIndex'));
    expect(offsets).toEqual(['0', '10']);
  });

  it('throws a typed extraction failure instead of silently returning zero', async () => {
    mockPost.mockResolvedValue({ data: { data: [{ unexpected: true }], totalHits: { total: 12 } } });
    await expect(new AccentureService().scrape({} as ScraperInputDto))
      .rejects.toMatchObject<Partial<AccentureSourceError>>({ code: 'MARKUP_CHANGED' });
  });

  it('accepts an explicit legitimate empty response and types HTTP failures', async () => {
    mockPost.mockResolvedValueOnce({ data: { data: [], totalHits: { total: 0 } } });
    await expect(new AccentureService().scrape({} as ScraperInputDto)).resolves.toMatchObject({
      jobs: [],
      advertisedCount: 0,
    });
    mockPost.mockRejectedValueOnce(new Error('timeout'));
    await expect(new AccentureService().scrape({} as ScraperInputDto)).rejects.toMatchObject({ code: 'HTTP' });
  });
});
