import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: jest.fn(),
    randomSleep: jest.fn().mockResolvedValue(undefined),
  };
});

import { createHttpClient } from '@ever-jobs/common';
import { DescriptionFormat, ScraperInputDto, Site } from '@ever-jobs/models';
import { LinkedInService } from '../src/linkedin.service';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('LinkedInService public guest coverage', () => {
  const get = jest.fn();
  const setHeaders = jest.fn();
  let service: LinkedInService;

  beforeEach(() => {
    jest.clearAllMocks();
    (createHttpClient as jest.Mock).mockReturnValue({ get, setHeaders });
    service = new LinkedInService();
  });

  it('searches newest-first in a bounded window and details only coarse internship candidates', async () => {
    get
      .mockResolvedValueOnce({ data: fixture('linkedin-list.html') })
      .mockResolvedValueOnce({ data: fixture('linkedin-detail.html') });

    const response = await service.scrape(
      new ScraperInputDto({
        searchTerm: 'software engineering intern',
        location: 'Canada',
        resultsWanted: 2,
        descriptionFormat: DescriptionFormat.PLAIN,
      }),
    );

    expect(response.jobs).toHaveLength(2);
    expect(response.jobs[0]).toMatchObject({
      id: 'li-4441398123',
      title: 'Software Engineering Intern/Co-op',
      companyName: 'Example Labs',
      datePosted: '2026-07-18',
      applyUrl: 'https://careers.example.test/jobs/4441398123?utm_source=linkedin',
      jobUrlDirect: 'https://careers.example.test/jobs/4441398123?utm_source=linkedin',
      isRemote: false,
      site: Site.LINKEDIN,
    });
    expect(response.jobs[0].locations).toEqual([
      expect.objectContaining({ city: 'Toronto', state: 'ON', country: 'Canada' }),
    ]);
    expect(response.jobs[0].description).toContain('Build software with TypeScript.');
    expect(response.jobs[1].description).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1].params).toMatchObject({
      location: 'Canada',
      sortBy: 'DD',
      f_TPR: 'r259200',
    });
    expect(get.mock.calls[1][0]).toContain('/jobs/view/');
  });

  it('uses a caller-supplied recent window within the bounded maximum', async () => {
    get.mockResolvedValue({ data: fixture('linkedin-empty.html') });
    await service.scrape(new ScraperInputDto({ hoursOld: 24 }));
    expect(get.mock.calls[0][1].params.f_TPR).toBe('r86400');
  });

  it('accepts a recognized empty result', async () => {
    get.mockResolvedValue({ data: fixture('linkedin-empty.html') });
    await expect(service.scrape(new ScraperInputDto())).resolves.toMatchObject({ jobs: [] });
  });

  it('propagates listing HTTP failures', async () => {
    get.mockRejectedValue(new Error('guest endpoint unavailable'));
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_HTTP_FAILURE');
  });

  it('rejects blocked and unexpected listing responses', async () => {
    get.mockResolvedValueOnce({ data: fixture('linkedin-blocked.html') });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_BLOCKED');

    get.mockResolvedValueOnce({ data: fixture('linkedin-malformed.html') });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      'SOURCE_MARKUP_CHANGED',
    );
  });

  it('propagates blocked detail responses for coarse candidates', async () => {
    get
      .mockResolvedValueOnce({ data: fixture('linkedin-list.html') })
      .mockResolvedValueOnce({ data: fixture('linkedin-blocked.html') });
    await expect(
      service.scrape(new ScraperInputDto({ resultsWanted: 1 })),
    ).rejects.toThrow('SOURCE_BLOCKED');
  });

  it('rejects an empty response body instead of reporting an empty success', async () => {
    get.mockResolvedValue({ data: '   ' });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      'SOURCE_MARKUP_CHANGED',
    );
  });
});
