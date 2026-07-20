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
import { Country, DescriptionFormat, ScraperInputDto, Site } from '@ever-jobs/models';
import { GoogleService } from '../src/google.service';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('GoogleService', () => {
  const get = jest.fn();
  const setHeaders = jest.fn();
  let service: GoogleService;

  beforeEach(() => {
    jest.clearAllMocks();
    (createHttpClient as jest.Mock).mockReturnValue({ get, setHeaders });
    service = new GoogleService();
  });

  it('maps stable IDs, publication dates, all locations, employer URLs, and pagination', async () => {
    get
      .mockResolvedValueOnce({ data: fixture('google-jobs-page-1.html') })
      .mockResolvedValueOnce({ data: fixture('google-jobs-page-2.html') });

    const response = await service.scrape(
      new ScraperInputDto({
        siteType: [Site.GOOGLE],
        searchTerm: 'software engineering intern',
        location: 'Canada',
        country: Country.CANADA,
        resultsWanted: 3,
        descriptionFormat: DescriptionFormat.PLAIN,
      }),
    );

    expect(response.jobs).toHaveLength(3);
    expect(response.jobs[0]).toMatchObject({
      id: 'go-google-result-1001',
      title: 'Software Engineering Intern',
      companyName: 'Example Labs',
      applyUrl: 'https://careers.example.test/jobs/1001?utm_source=google',
      jobUrlDirect: 'https://careers.example.test/jobs/1001?utm_source=google',
      site: Site.GOOGLE,
      isRemote: true,
    });
    expect(response.jobs[0].datePosted).toBe('2026-07-18T00:00:00.000Z');
    expect(response.jobs[0].locations).toEqual([
      expect.objectContaining({ city: 'Vancouver', state: 'BC', country: 'Canada' }),
      expect.objectContaining({ city: 'Remote', country: 'Canada' }),
    ]);
    expect(response.jobs[0].location).toMatchObject({
      city: 'Vancouver',
      state: 'BC',
      country: 'Canada',
    });
    expect(response.jobs[0].description).toContain('Build reliable software.');
    expect(response.jobs[2].location?.country).toBe('United States');
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1].params).toMatchObject({ gl: 'ca', start: 0 });
    expect(get.mock.calls[1][1].params).toMatchObject({ gl: 'ca', start: 10 });
  });

  it('derives the Google market from a Canadian location when country is omitted or defaulted', async () => {
    get.mockResolvedValue({ data: fixture('google-jobs-empty.html') });

    await service.scrape(
      new ScraperInputDto({ location: 'Toronto, Ontario', resultsWanted: 5 }),
    );
    await service.scrape(
      new ScraperInputDto({ location: 'United States', resultsWanted: 5 }),
    );

    expect(get.mock.calls[0][1].params.gl).toBe('ca');
    expect(get.mock.calls[1][1].params.gl).toBe('us');
  });

  it('accepts a validated empty response', async () => {
    get.mockResolvedValue({ data: fixture('google-jobs-empty.html') });
    await expect(service.scrape(new ScraperInputDto({ resultsWanted: 5 }))).resolves.toMatchObject({
      jobs: [],
    });
  });

  it('propagates HTTP failures as source failures', async () => {
    get.mockRejectedValue(new Error('upstream unavailable'));
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_HTTP_FAILURE');
  });

  it('rejects blocked or JS-only responses', async () => {
    get.mockResolvedValue({ data: fixture('google-jobs-blocked.html') });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_BLOCKED');
  });

  it('rejects malformed embedded payloads', async () => {
    get.mockResolvedValue({ data: fixture('google-jobs-malformed.html') });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_SCHEMA_INVALID');
  });

  it('rejects unexpected non-job markup instead of reporting an empty success', async () => {
    get.mockResolvedValue({ data: '<html><body><p>ordinary search page</p></body></html>' });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow('SOURCE_MARKUP_CHANGED');
  });

  it('rejects an empty response body instead of reporting an empty success', async () => {
    get.mockResolvedValue({ data: '   ' });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      'SOURCE_MARKUP_CHANGED',
    );
  });
});
