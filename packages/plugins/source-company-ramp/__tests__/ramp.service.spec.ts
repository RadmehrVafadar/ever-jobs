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

import { RampModule, RampService } from '../src';

const COMPANY_NAME_EXPECT = 'Ramp';
const ASHBY_JOBS: Array<Partial<JobPostDto>> = [
  {
    id: 'ashby-ramp-job-1',
    title: 'Software Engineering Intern',
    jobUrl: 'https://jobs.ashbyhq.com/ramp/ramp-job-1',
    applyUrl: 'https://jobs.ashbyhq.com/ramp/ramp-job-1/application',
    companyName: 'ramp',
    department: 'Engineering',
    employmentType: 'Intern',
    datePosted: '2026-07-01',
    site: Site.ASHBY,
  },
  {
    id: 'ashby-ramp-job-2',
    title: 'Data Engineering Co-op',
    jobUrl: 'https://jobs.ashbyhq.com/ramp/ramp-job-2',
    applyUrl: 'https://jobs.ashbyhq.com/ramp/ramp-job-2/application',
    companyName: 'ramp',
    department: 'Data',
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

describe('RampService — Ashby delegation', () => {
  describe('registration scaffolding', () => {
    it('resolves through RampModule via NestJS DI', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [RampModule],
      }).compile();
      const service = moduleRef.get(RampService);
      expect(service).toBeInstanceOf(RampService);
      await moduleRef.close();
    });

    it('exports the Site.RAMP = "ramp" enum value', () => {
      expect(Site.RAMP).toBe('ramp');

      const metadata = Reflect.getMetadata(
        SOURCE_PLUGIN_METADATA,
        RampService,
      ) as IPluginMetadata;
      expect(metadata).toMatchObject({
        site: Site.RAMP,
        name: COMPANY_NAME_EXPECT,
        category: 'company',
        watchMode: 'board',
      });
    });
  });

  describe('happy path (delegates to the registered Ashby plugin)', () => {
    it('re-stamps delegated listings while preserving Ashby-mapped fields', async () => {
      const captured: ScraperInputDto[] = [];
      const service = new RampService(registryWithAshby(captured));
      const result = (await service.scrape({
        siteType: [Site.RAMP],
        resultsWanted: 100,
      } as ScraperInputDto)) as JobResponseDto;

      expect(result.jobs).toHaveLength(ASHBY_JOBS.length);

      const first = ASHBY_JOBS[0];
      const job0 = result.jobs.find(
        (j) => j.id === 'ramp-ramp-job-1',
      );
      expect(job0).toBeDefined();
      // company identity is re-stamped over Ashby's defaults
      expect(job0?.site).toBe(Site.RAMP);
      expect(job0?.companyName).toBe(COMPANY_NAME_EXPECT);
      expect(job0?.id).toBe('ramp-ramp-job-1');
      expect(job0?.id?.startsWith('ashby-')).toBe(false);
      // Ashby-mapped fields flow through untouched
      expect(job0?.title).toBe(first.title);
      expect(job0?.jobUrl).toBe(first.jobUrl);
      expect(job0?.applyUrl).toBe(first.applyUrl);
      expect(job0?.department).toBe(first.department);
      expect(job0?.employmentType).toBe(first.employmentType);
      expect(job0?.datePosted).toBe(first.datePosted);
      expect(captured[0]).toMatchObject({
        companySlug: 'ramp',
        resultsWanted: 100,
      });
    });

    it('every job carries the company site, companyName, and id prefix', async () => {
      const service = new RampService(registryWithAshby());
      const result = await service.scrape({
        siteType: [Site.RAMP],
      } as ScraperInputDto);
      for (const job of result.jobs) {
        expect(job.site).toBe(Site.RAMP);
        expect(job.companyName).toBe(COMPANY_NAME_EXPECT);
        expect(job.id?.startsWith('ramp-')).toBe(true);
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

      const service = new RampService(registry);
      const result = await service.scrape({
        siteType: [Site.RAMP],
        companySlug: 'caller-cannot-override-ramp',
        resultsWanted: 500,
      } as ScraperInputDto);

      expect(captured).toHaveLength(1);
      expect(captured[0].companySlug).toBe('ramp');
      expect(captured[0].resultsWanted).toBe(500);
      expect(captured[0].siteType).toEqual([Site.RAMP]);
      expect(result.jobs[0].id).toBe('ramp-x1');
      expect(result.jobs[0].site).toBe(Site.RAMP);
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
      const service = new RampService(registry);
      const result = await service.scrape({
        siteType: [Site.RAMP],
      } as ScraperInputDto);
      expect(result.jobs[0].id).toBe('ramp-ashby-7');
    });
  });

  describe('resilience', () => {
    it('rejects when no Ashby plugin is registered', async () => {
      const service = new RampService(new PluginRegistry());
      await expect(
        service.scrape({ siteType: [Site.RAMP] } as ScraperInputDto),
      ).rejects.toThrow(
        'Ramp source requires the Ashby source plugin to be registered',
      );
    });

    it('rejects when no registry is injected', async () => {
      const service = new RampService();
      await expect(
        service.scrape({ siteType: [Site.RAMP] } as ScraperInputDto),
      ).rejects.toThrow(
        'Ramp source requires PluginRegistry injection to resolve Ashby',
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
        new RampService(registry).scrape({
          siteType: [Site.RAMP],
        } as ScraperInputDto),
      ).rejects.toThrow('Ramp received an Ashby job without a stable ID');
    });
  });

  describe('resultsWanted cap', () => {
    it('forwards resultsWanted=1 to bound the delegated board result', async () => {
      const service = new RampService(registryWithAshby());
      const result = await service.scrape({
        siteType: [Site.RAMP],
        resultsWanted: 1,
      } as ScraperInputDto);
      expect(result.jobs).toHaveLength(1);
    });
  });
});
