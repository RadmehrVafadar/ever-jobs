import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  Site,
} from '@ever-jobs/models';
import {
  type IPluginMetadata,
  PluginRegistry,
  SOURCE_PLUGIN_METADATA,
} from '@ever-jobs/plugin';

import { NotionModule, NotionService } from '../src';

const COMPANY_NAME_EXPECT = 'Notion';
const ASHBY_JOBS: Array<Partial<JobPostDto>> = [
  {
    id: 'ashby-notion-job-1',
    title: 'Software Engineering Intern',
    jobUrl: 'https://jobs.ashbyhq.com/notion/notion-job-1',
    applyUrl: 'https://jobs.ashbyhq.com/notion/notion-job-1/application',
    companyName: 'notion',
    department: 'Engineering',
    employmentType: 'Intern',
    datePosted: '2026-07-01',
    site: Site.ASHBY,
  },
  {
    id: 'ashby-notion-job-2',
    title: 'Machine Learning Co-op',
    jobUrl: 'https://jobs.ashbyhq.com/notion/notion-job-2',
    applyUrl: 'https://jobs.ashbyhq.com/notion/notion-job-2/application',
    companyName: 'notion',
    department: 'Machine Learning',
    employmentType: 'Co-op',
    datePosted: '2026-07-02',
    site: Site.ASHBY,
  },
];

/** Registry wired with an Ashby contract fake, never a peer-plugin import. */
function registryWithAshby(captured: ScraperInputDto[] = []): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(
    { site: Site.ASHBY, name: 'Ashby', category: 'ats', isAts: true },
    {
      scrape: async (input: ScraperInputDto) => {
        captured.push(input);
        const limit = Math.max(0, input.resultsWanted ?? ASHBY_JOBS.length);
        return new JobResponseDto(
          ASHBY_JOBS.slice(0, limit).map((job) => new JobPostDto({ ...job })),
        );
      },
    },
  );
  return registry;
}

describe('NotionService — Ashby delegation', () => {
  describe('registration scaffolding', () => {
    it('resolves through NotionModule via NestJS DI', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [NotionModule],
      }).compile();
      const service = moduleRef.get(NotionService);
      expect(service).toBeInstanceOf(NotionService);
      await moduleRef.close();
    });

    it('exports the Site.NOTION = "notion" enum value', () => {
      expect(Site.NOTION).toBe('notion');

      const metadata = Reflect.getMetadata(
        SOURCE_PLUGIN_METADATA,
        NotionService,
      ) as IPluginMetadata;
      expect(metadata).toMatchObject({
        site: Site.NOTION,
        name: COMPANY_NAME_EXPECT,
        category: 'company',
        watchMode: 'board',
      });
    });
  });

  describe('happy path (delegates to the registered Ashby plugin)', () => {
    it('re-stamps delegated listings while preserving Ashby-mapped fields', async () => {
      const captured: ScraperInputDto[] = [];
      const service = new NotionService(registryWithAshby(captured));
      const result = (await service.scrape({
        siteType: [Site.NOTION],
        resultsWanted: 100,
      } as ScraperInputDto)) as JobResponseDto;

      expect(result.jobs).toHaveLength(ASHBY_JOBS.length);

      const first = ASHBY_JOBS[0];
      const job0 = result.jobs.find(
        (j) => j.id === 'notion-notion-job-1',
      );
      expect(job0).toBeDefined();
      // company identity is re-stamped over Ashby's defaults
      expect(job0?.site).toBe(Site.NOTION);
      expect(job0?.companyName).toBe(COMPANY_NAME_EXPECT);
      expect(job0?.id).toBe('notion-notion-job-1');
      expect(job0?.id?.startsWith('ashby-')).toBe(false);
      // Ashby-mapped fields flow through untouched
      expect(job0?.title).toBe(first.title);
      expect(job0?.jobUrl).toBe(first.jobUrl);
      expect(job0?.applyUrl).toBe(first.applyUrl);
      expect(job0?.department).toBe(first.department);
      expect(job0?.employmentType).toBe(first.employmentType);
      expect(job0?.datePosted).toBe(first.datePosted);
      expect(captured[0]).toMatchObject({
        companySlug: 'notion',
        resultsWanted: 100,
      });
    });

    it('every job carries the company site, companyName, and id prefix', async () => {
      const service = new NotionService(registryWithAshby());
      const result = await service.scrape({
        siteType: [Site.NOTION],
      } as ScraperInputDto);
      for (const job of result.jobs) {
        expect(job.site).toBe(Site.NOTION);
        expect(job.companyName).toBe(COMPANY_NAME_EXPECT);
        expect(job.id?.startsWith('notion-')).toBe(true);
      }
    });
  });

  describe('input pass-through', () => {
    it('forwards the fixed company slug and result bound to the Ashby scraper', async () => {
      const captured: ScraperInputDto[] = [];
      const fakeAshby: IScraper = {
        scrape: async (input) => {
          captured.push(input);
          return new JobResponseDto([
            new JobPostDto({ id: 'x1', title: 'Role', jobUrl: 'u' }),
          ]);
        },
      };
      const registry = new PluginRegistry();
      registry.register(
        { site: Site.ASHBY, name: 'Ashby', category: 'ats', isAts: true },
        fakeAshby,
      );

      const service = new NotionService(registry);
      const result = await service.scrape({
        siteType: [Site.NOTION],
        companySlug: 'caller-cannot-override-notion',
        resultsWanted: 500,
      } as ScraperInputDto);

      expect(captured).toHaveLength(1);
      expect(captured[0].companySlug).toBe('notion');
      expect(captured[0].resultsWanted).toBe(500);
      expect(captured[0].siteType).toEqual([Site.NOTION]);
      expect(result.jobs[0].id).toBe('notion-x1');
      expect(result.jobs[0].site).toBe(Site.NOTION);
    });

    it('only rewrites a leading ashby- id prefix', async () => {
      const fakeAshby: IScraper = {
        scrape: async () =>
          new JobResponseDto([
            new JobPostDto({ id: 'ashby-ashby-7', title: 'T', jobUrl: 'u' }),
          ]),
      };
      const registry = new PluginRegistry();
      registry.register(
        { site: Site.ASHBY, name: 'Ashby', category: 'ats', isAts: true },
        fakeAshby,
      );
      const service = new NotionService(registry);
      const result = await service.scrape({
        siteType: [Site.NOTION],
      } as ScraperInputDto);
      expect(result.jobs[0].id).toBe('notion-ashby-7');
    });
  });

  describe('resilience', () => {
    it('rejects when no Ashby plugin is registered', async () => {
      const service = new NotionService(new PluginRegistry());
      await expect(
        service.scrape({ siteType: [Site.NOTION] } as ScraperInputDto),
      ).rejects.toThrow(
        'Notion source requires the Ashby source plugin to be registered',
      );
    });

    it('rejects when no registry is injected', async () => {
      const service = new NotionService();
      await expect(
        service.scrape({ siteType: [Site.NOTION] } as ScraperInputDto),
      ).rejects.toThrow(
        'Notion source requires PluginRegistry injection to resolve Ashby',
      );
    });

    it('rejects a malformed delegated job without a stable ID', async () => {
      const registry = new PluginRegistry();
      registry.register(
        { site: Site.ASHBY, name: 'Ashby', category: 'ats', isAts: true },
        {
          scrape: async () =>
            new JobResponseDto([
              new JobPostDto({ title: 'Role', jobUrl: 'u' }),
            ]),
        },
      );

      await expect(
        new NotionService(registry).scrape({
          siteType: [Site.NOTION],
        } as ScraperInputDto),
      ).rejects.toThrow('Notion received an Ashby job without a stable ID');
    });
  });

  describe('resultsWanted cap', () => {
    it('forwards resultsWanted=1 to bound the delegated board result', async () => {
      const service = new NotionService(registryWithAshby());
      const result = await service.scrape({
        siteType: [Site.NOTION],
        resultsWanted: 1,
      } as ScraperInputDto);
      expect(result.jobs).toHaveLength(1);
    });
  });
});
