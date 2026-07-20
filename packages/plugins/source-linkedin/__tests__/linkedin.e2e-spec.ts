/**
 * E2E test for the LinkedIn scraper.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { LinkedInModule, LinkedInService } from '@ever-jobs/source-linkedin';
import { ScraperInputDto, Site, Country, DescriptionFormat } from '@ever-jobs/models';

const describeNetwork = process.env.RUN_NETWORK_E2E === 'true' ? describe : describe.skip;

describeNetwork('LinkedInService (network E2E)', () => {
  let service: LinkedInService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [LinkedInModule],
    }).compile();

    service = module.get<LinkedInService>(LinkedInService);
  });

  it('should return job results for a basic search', async () => {
    const input = new ScraperInputDto({
      siteType: [Site.LINKEDIN],
      searchTerm: 'data scientist',
      location: 'Remote',
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
