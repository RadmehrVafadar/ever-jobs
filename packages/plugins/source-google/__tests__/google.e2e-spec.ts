/**
 * E2E test for the Google scraper.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { GoogleModule, GoogleService } from '@ever-jobs/source-google';
import { ScraperInputDto, Site, Country, DescriptionFormat } from '@ever-jobs/models';

const describeNetwork = process.env.RUN_NETWORK_E2E === 'true' ? describe : describe.skip;

describeNetwork('GoogleService (network E2E)', () => {
  let service: GoogleService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GoogleModule],
    }).compile();

    service = module.get<GoogleService>(GoogleService);
  });

  it('should return job results for a basic search', async () => {
    const input = new ScraperInputDto({
      siteType: [Site.GOOGLE],
      searchTerm: 'devops engineer',
      location: 'Chicago',
      resultsWanted: 5,
      country: Country.USA,
      descriptionFormat: DescriptionFormat.MARKDOWN,
    });

    const response = await service.scrape(input);

    expect(response).toBeDefined();
    expect(response.jobs).toBeDefined();
    expect(Array.isArray(response.jobs)).toBe(true);
    expect(response.jobs.length).toBeGreaterThan(0);
    expect(typeof response.jobs[0].title).toBe('string');
  });
});
