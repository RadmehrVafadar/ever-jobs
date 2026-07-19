import { Test } from "@nestjs/testing";
import { JobPostDto, ScraperInputDto, Site } from "@ever-jobs/models";
import { JobWatch } from "../interfaces/watch.types";
import {
  JobsServiceWatchExecutor,
  WATCH_JOBS_SERVICE,
  WatchJobsSearchDetailedResult,
  WatchJobsService,
} from "../services/jobs-service-watch.executor";
import { WatchSourcePlanner } from "../services/watch-source-planner.service";

describe("WatchSourcePlanner", () => {
  const planner = new WatchSourcePlanner();

  it("uses UTC tier buckets so 3, 15, and 60 minute tiers become due", () => {
    const watch = createWatch({
      sources: [Site.GOOGLE_CAREERS, Site.GOOGLE, Site.LINKEDIN],
      lastRunAt: new Date("2026-07-14T12:59:00.000Z"),
    });

    const plan = planner.plan(watch, {
      now: new Date("2026-07-14T13:00:00.000Z"),
    });

    expect(plan.dueTiers).toEqual([1, 2, 3]);
    expect(plan.targets.map((target) => target.site)).toEqual([
      Site.GOOGLE_CAREERS,
      Site.GOOGLE,
      Site.LINKEDIN,
    ]);
  });

  it("does not starve tier 2 when a watch ran inside the current 15 minute bucket", () => {
    const watch = createWatch({
      sources: [Site.GOOGLE_CAREERS, Site.GOOGLE, Site.LINKEDIN],
      lastRunAt: new Date("2026-07-14T12:13:00.000Z"),
    });

    const plan = planner.plan(watch, {
      now: new Date("2026-07-14T12:15:00.000Z"),
    });

    expect(plan.dueTiers).toEqual([1, 2]);
    expect(plan.targets.map((target) => target.site)).toEqual([
      Site.GOOGLE_CAREERS,
      Site.GOOGLE,
    ]);
    expect(plan.skippedTargets.map((target) => target.site)).toEqual([
      Site.LINKEDIN,
    ]);
  });

  it("prefers explicit source targets and honors per-target next-run state", () => {
    const watch = createWatch({
      sources: ["not-used-when-source-targets-exist"],
      sourceTargets: [
        {
          site: Site.GOOGLE_CAREERS,
          tier: 1,
          intervalMinutes: 3,
          enabled: true,
          nextRunAt: new Date("2026-07-14T12:03:00.000Z"),
        },
        {
          site: Site.GREENHOUSE,
          tier: 1,
          intervalMinutes: 3,
          companySlug: "shopify",
          enabled: true,
          nextRunAt: new Date("2026-07-14T12:06:00.000Z"),
        },
      ],
    });

    const plan = planner.plan(watch, {
      now: new Date("2026-07-14T12:04:00.000Z"),
    });

    expect(plan.targets.map((target) => target.key)).toEqual([
      Site.GOOGLE_CAREERS,
    ]);
    expect(plan.skippedTargets.map((target) => target.key)).toEqual([
      `${Site.GREENHOUSE}:shopify`,
    ]);
  });

  it("fetches each direct or ATS board once instead of once per search term", () => {
    const terms = Array.from(
      { length: 16 },
      (_value, index) => `term ${index}`,
    );
    const plan = planner.plan(
      createWatch({
        sources: [
          "source-company-google",
          "source-ats-greenhouse",
          "source-google",
        ],
        companySlugs: ["greenhouse:shopify"],
        searchTerms: terms,
      }),
      { force: true, maxQueryTermsPerSource: 4 },
    );

    const directRequests = plan.requests.filter(
      (request) => request.target.site === Site.GOOGLE_CAREERS,
    );
    const atsRequests = plan.requests.filter(
      (request) => request.target.site === Site.GREENHOUSE,
    );
    const queryRequests = plan.requests.filter(
      (request) => request.target.site === Site.GOOGLE,
    );
    expect(directRequests).toHaveLength(1);
    expect(atsRequests).toHaveLength(1);
    expect(atsRequests[0].target.companySlug).toBe("shopify");
    expect(directRequests[0].searchTerm).toBeUndefined();
    expect(atsRequests[0].searchTerm).toBeUndefined();
    expect(queryRequests).toHaveLength(4);
  });

  it("rejects unknown sources and ambiguous ATS slugs without fanning them out", () => {
    const plan = planner.plan(
      createWatch({
        sources: [
          "source-company-shopify",
          "source-ats-greenhouse",
          "source-ats-lever",
        ],
        companySlugs: ["shopify"],
      }),
      { force: true },
    );

    expect(plan.targets).toHaveLength(0);
    expect(plan.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unknown-source",
        "missing-company-slug",
        "ambiguous-company-slug",
      ]),
    );
  });
});

describe("JobsServiceWatchExecutor", () => {
  it("requires the explicit JobsService token in Nest DI", async () => {
    await expect(
      Test.createTestingModule({
        providers: [JobsServiceWatchExecutor, WatchSourcePlanner],
      }).compile(),
    ).rejects.toThrow(/WATCH_JOBS_SERVICE/);

    const module = await Test.createTestingModule({
      providers: [
        JobsServiceWatchExecutor,
        WatchSourcePlanner,
        {
          provide: WATCH_JOBS_SERVICE,
          useValue: { searchJobs: async () => [] },
        },
      ],
    }).compile();
    expect(module.get(JobsServiceWatchExecutor)).toBeInstanceOf(
      JobsServiceWatchExecutor,
    );
    await module.close();
  });

  it("bounds concurrency and preserves jobs when one detailed source fails", async () => {
    let active = 0;
    let maximumActive = 0;
    const capturedInputs: ScraperInputDto[] = [];
    const service: WatchJobsService = {
      listRegisteredSources: () => [
        Site.GOOGLE_CAREERS,
        Site.AMAZON,
        Site.META,
      ],
      searchJobs: async () => [],
      searchJobsDetailed: async (
        input: ScraperInputDto,
      ): Promise<WatchJobsSearchDetailedResult> => {
        capturedInputs.push(input);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await delay(10);
        active -= 1;
        const site = input.siteType?.[0] as Site;
        if (site === Site.META) {
          return {
            jobs: [],
            sourcesRequested: [site],
            sourcesSucceeded: [],
            sourcesFailed: [{ source: site, error: "source unavailable" }],
            durationsMs: { [site]: 10 },
          };
        }
        return {
          jobs: [new JobPostDto({ id: `${site}-1`, site, title: "Intern" })],
          sourcesRequested: [site],
          sourcesSucceeded: [site],
          sourcesFailed: [],
          durationsMs: { [site]: 10 },
        };
      },
    };
    const executor = new JobsServiceWatchExecutor(
      service,
      new WatchSourcePlanner(),
      {
        maxConcurrency: 2,
        maxJitterMs: 0,
        timeoutMs: 1_000,
      },
    );

    const result = await executor.execute({
      watch: createWatch({
        sourceTargets: [
          sourceTarget(Site.GOOGLE_CAREERS, 1),
          sourceTarget(Site.AMAZON, 1),
          sourceTarget(Site.META, 1),
        ],
      }),
      force: true,
    });

    expect(maximumActive).toBe(2);
    expect(capturedInputs).toHaveLength(3);
    expect(capturedInputs.every((input) => input.siteType?.length === 1)).toBe(
      true,
    );
    expect(
      capturedInputs.every((input) => input.searchTerm === undefined),
    ).toBe(true);
    expect(result.status).toBe("partial");
    expect(result.jobs).toHaveLength(2);
    expect(result.sourcesSucceeded).toEqual(
      expect.arrayContaining([Site.GOOGLE_CAREERS, Site.AMAZON]),
    );
    expect(result.sourcesFailed).toEqual([Site.META]);
    expect(result.failures[0]).toMatchObject({
      source: Site.META,
      category: "source",
      retryable: true,
    });
  });

  it("serializes multiple query requests to the same source", async () => {
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [Site.GOOGLE],
        searchJobs: async (input) => {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await delay(5);
          active -= 1;
          return [
            new JobPostDto({
              id: `google-${calls}`,
              site: Site.GOOGLE,
              title: input.searchTerm ?? "Intern",
            }),
          ];
        },
      },
      new WatchSourcePlanner(),
      {
        maxConcurrency: 4,
        maxConcurrencyPerSource: 1,
        maxJitterMs: 0,
      },
    );

    const result = await executor.execute({
      watch: createWatch({
        searchTerms: Array.from(
          { length: 8 },
          (_value, index) => `intern query ${index}`,
        ),
        sourceTargets: [sourceTarget(Site.GOOGLE, 2)],
      }),
      force: true,
    });

    expect(calls).toBe(4);
    expect(maximumActive).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.jobs).toHaveLength(4);
  });

  it("reports hard timeouts without blocking the whole source batch", async () => {
    const service: WatchJobsService = {
      listRegisteredSources: () => [Site.GOOGLE_CAREERS],
      searchJobs: () => new Promise<JobPostDto[]>(() => undefined),
    };
    const executor = new JobsServiceWatchExecutor(
      service,
      new WatchSourcePlanner(),
      { maxJitterMs: 0, timeoutMs: 10 },
    );

    const result = await executor.execute({
      watch: createWatch({
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1)],
      }),
      force: true,
    });

    expect(result.status).toBe("failed");
    expect(result.jobs).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      source: Site.GOOGLE_CAREERS,
      category: "timeout",
      retryable: true,
    });
  });

  it("reports an unregistered configured source without invoking JobsService", async () => {
    const searchJobs = jest.fn(async () => []);
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [Site.AMAZON],
        searchJobs,
      },
      new WatchSourcePlanner(),
      { maxJitterMs: 0 },
    );

    const result = await executor.execute({
      watch: createWatch({
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1)],
      }),
      force: true,
    });

    expect(searchJobs).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toMatchObject({
      source: Site.GOOGLE_CAREERS,
      category: "unregistered",
      retryable: false,
    });
  });
});

function createWatch(overrides: Partial<JobWatch> = {}): JobWatch {
  const now = new Date("2026-07-14T12:00:00.000Z");
  return {
    id: "watch-1",
    name: "Internships",
    enabled: true,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [],
    sourceTiers: { direct: 1, ats: 1, structured: 2, aggregator: 3 },
    sourceTargets: [],
    companySlugs: [],
    companies: [],
    searchTerms: ["software engineer intern"],
    requiredTerms: ["intern"],
    preferredTerms: [],
    excludedTerms: [],
    locations: ["Toronto"],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship", "co-op"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [],
    initializationMode: "baseline",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sourceTarget(site: Site, tier: 1 | 2 | 3) {
  return {
    site,
    tier,
    intervalMinutes: tier === 1 ? 3 : tier === 2 ? 15 : 60,
    enabled: true,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
