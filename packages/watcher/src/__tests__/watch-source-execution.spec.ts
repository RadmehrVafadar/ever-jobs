import { Test } from "@nestjs/testing";
import { Country, JobPostDto, ScraperInputDto, Site } from "@ever-jobs/models";
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

  it("uses explicit plugin mode and carries effective target context", () => {
    const watchInitializedAt = new Date("2026-07-14T11:00:00.000Z");
    const plan = planner.plan(
      createWatch({
        initializedAt: watchInitializedAt,
        searchTerms: ["legacy term"],
        locations: ["legacy location"],
        countryCodes: ["CA"],
        sourceTargets: [
          {
            site: Site.GOOGLE_CAREERS,
            tier: 1,
            intervalMinutes: 3,
            resultsWanted: 500,
            companyName: "Google",
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Canada", "Waterloo, Ontario"],
              searchTerms: ["software intern"],
              maxRequestsPerRun: 2,
            },
          },
        ],
      }),
      {
        force: true,
        rotationSeed: 0,
        sourceMetadata: [
          {
            site: Site.GOOGLE_CAREERS,
            category: "company",
            watchMode: "query",
          },
        ],
      },
    );

    expect(plan.targets[0]).toEqual(
      expect.objectContaining({
        key: Site.GOOGLE_CAREERS,
        companyName: "Google",
        intervalMinutes: 3,
        resultsWanted: 500,
        mode: "query",
        initializedAt: watchInitializedAt,
        searchScope: {
          countryCodes: ["CA"],
          locations: ["Canada", "Waterloo, Ontario"],
          searchTerms: ["software intern"],
          maxRequestsPerRun: 2,
        },
      }),
    );
    expect(plan.requests).toEqual([
      expect.objectContaining({
        searchTerm: "software intern",
        location: "Canada",
        countryCodes: ["CA"],
        matrixIndex: 0,
      }),
      expect.objectContaining({
        searchTerm: "software intern",
        location: "Waterloo, Ontario",
        countryCodes: ["CA"],
        matrixIndex: 1,
      }),
    ]);
  });

  it("inherits cadence and each missing scope field from the watch defaults", () => {
    const plan = planner.plan(
      createWatch({
        intervalMinutes: 20,
        countryCodes: ["CA", "US"],
        locations: ["Toronto", "Remote"],
        searchTerms: ["watch term"],
        sourceTargets: [
          {
            site: Site.GOOGLE,
            tier: 2,
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              searchTerms: ["target term"],
              maxRequestsPerRun: 1,
            },
          },
        ],
      }),
      { force: true, rotationSeed: 0 },
    );

    expect(plan.targets[0]).toEqual(
      expect.objectContaining({
        intervalMinutes: 20,
        searchScope: {
          countryCodes: ["CA"],
          locations: ["Toronto", "Remote"],
          searchTerms: ["target term"],
          maxRequestsPerRun: 1,
        },
      }),
    );
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0]).toEqual(
      expect.objectContaining({
        searchTerm: "target term",
        location: expect.stringMatching(/^(Toronto|Remote)$/),
        countryCodes: ["CA"],
      }),
    );
  });

  it("builds the complete unique term by location matrix", () => {
    const plan = planner.plan(
      createWatch({
        sourceTargets: [
          {
            site: Site.GOOGLE,
            tier: 2,
            intervalMinutes: 15,
            enabled: true,
            searchScope: {
              countryCodes: ["CA", "US"],
              locations: ["Canada", "United States", "Canada"],
              searchTerms: ["software intern", "ml intern", "software intern"],
              maxRequestsPerRun: 10,
            },
          },
        ],
      }),
      { force: true, rotationSeed: 0 },
    );

    expect(
      plan.requests.map(({ searchTerm, location }) => [searchTerm, location]),
    ).toEqual([
      ["software intern", "Canada"],
      ["software intern", "United States"],
      ["ml intern", "Canada"],
      ["ml intern", "United States"],
    ]);
    expect(plan.requests.map((request) => request.matrixIndex)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      plan.requests.every(
        (request) => request.countryCodes.join(",") === "CA,US",
      ),
    ).toBe(true);
  });

  it("rotates a bounded matrix deterministically until every query is covered", () => {
    const watch = createWatch({
      sourceTargets: [
        {
          site: Site.GOOGLE,
          tier: 2,
          intervalMinutes: 15,
          enabled: true,
          searchScope: {
            countryCodes: ["CA", "US"],
            locations: ["Canada", "United States", "Toronto, Ontario"],
            searchTerms: ["software intern", "ml intern"],
            maxRequestsPerRun: 2,
          },
        },
      ],
    });
    const plans = [0, 1, 2].map((rotationSeed) =>
      planner.plan(watch, { force: true, rotationSeed }),
    );
    const repeated = planner.plan(watch, { force: true, rotationSeed: 1 });

    expect(plans.every((plan) => plan.requests.length === 2)).toBe(true);
    expect(repeated.requests.map((request) => request.id)).toEqual(
      plans[1].requests.map((request) => request.id),
    );
    expect(
      new Set(
        plans.flatMap((plan) =>
          plan.requests.map((request) => request.matrixIndex),
        ),
      ).size,
    ).toBe(6);
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

  it("builds bounded term-only requests for explicit board-search targets", () => {
    const plan = planner.plan(
      createWatch({
        sourceTargets: [
          {
            site: Site.WORKDAY,
            tier: 1,
            intervalMinutes: 10,
            companySlug: "rbc:3:RBCEARLYTALENT1",
            companyName: "RBC",
            companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
            mode: "board-search",
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Toronto", "Mississauga"],
              searchTerms: ["Summer 2027", "May 2027", "intern", "co-op"],
              maxRequestsPerRun: 2,
            },
          },
        ],
      }),
      { force: true, rotationSeed: 0 },
    );

    expect(plan.issues).toEqual([]);
    expect(plan.requests).toHaveLength(2);
    expect(
      plan.requests.every((request) => request.location === undefined),
    ).toBe(true);
    expect(plan.requests.map((request) => request.searchTerm)).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(plan.requests[0].target).toEqual(
      expect.objectContaining({
        mode: "board-search",
        companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
      }),
    );
  });

  it.each([Site.NOTION, Site.RAMP])(
    "classifies %s as a single board request with or without runtime metadata",
    (site) => {
      const watch = createWatch({
        searchTerms: ["software intern", "backend intern"],
        locations: ["Canada", "Toronto, Ontario"],
        sourceTargets: [
          {
            site,
            companyName: site === Site.NOTION ? "Notion" : "Ramp",
            tier: 1,
            intervalMinutes: 10,
            enabled: true,
          },
        ],
      });

      const compatibilityPlan = planner.plan(watch, { force: true });
      const metadataPlan = planner.plan(watch, {
        force: true,
        sourceMetadata: [{ site, category: "company", watchMode: "board" }],
      });

      for (const plan of [compatibilityPlan, metadataPlan]) {
        expect(plan.targets).toHaveLength(1);
        expect(plan.targets[0].mode).toBe("board");
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0].searchTerm).toBeUndefined();
        expect(plan.requests[0].location).toBeUndefined();
      }
    },
  );

  it("rejects unknown sources and ambiguous ATS slugs without fanning them out", () => {
    const plan = planner.plan(
      createWatch({
        sources: [
          "source-company-not-real",
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

  it("keeps healthy jobs and reports a partial run when the new Uber source fails", async () => {
    let active = 0;
    let maximumActive = 0;
    const capturedInputs: ScraperInputDto[] = [];
    const service: WatchJobsService = {
      listRegisteredSources: () => [
        Site.GOOGLE_CAREERS,
        Site.AMAZON,
        Site.UBER,
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
        if (site === Site.UBER) {
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
          sourceTarget(Site.UBER, 1),
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
    expect(result.sourcesFailed).toEqual([Site.UBER]);
    expect(result.failures[0]).toMatchObject({
      source: Site.UBER,
      category: "source",
      retryable: true,
    });
  });

  it("forwards a per-target resultsWanted ceiling to the scraper input", async () => {
    const capturedInputs: ScraperInputDto[] = [];
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [Site.UBER],
        listSourceMetadata: () => [
          { site: Site.UBER, category: "company", watchMode: "board" },
        ],
        searchJobs: async (input) => {
          capturedInputs.push(input);
          return [];
        },
      },
      new WatchSourcePlanner(),
      { maxJitterMs: 0, resultsWanted: 100 },
    );

    await executor.execute({
      watch: createWatch({
        sourceTargets: [
          {
            site: Site.UBER,
            tier: 1,
            intervalMinutes: 10,
            resultsWanted: 500,
            companyName: "Uber",
            enabled: true,
          },
        ],
      }),
      force: true,
    });

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0].resultsWanted).toBe(500);
  });

  it("propagates companyUrl and board-search terms to scraper input", async () => {
    const capturedInputs: ScraperInputDto[] = [];
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [Site.WORKDAY],
        searchJobs: async (input) => {
          capturedInputs.push(input);
          return [];
        },
      },
      new WatchSourcePlanner(),
      { maxJitterMs: 0 },
    );

    await executor.execute({
      watch: createWatch({
        sourceTargets: [
          {
            site: Site.WORKDAY,
            tier: 1,
            intervalMinutes: 10,
            companySlug: "rbc:3:RBCEARLYTALENT1",
            companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
            mode: "board-search",
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Toronto"],
              searchTerms: ["intern", "co-op"],
              maxRequestsPerRun: 2,
            },
          },
        ],
      }),
      force: true,
    });

    expect(capturedInputs).toHaveLength(2);
    expect(capturedInputs.map((input) => input.searchTerm).sort()).toEqual([
      "co-op",
      "intern",
    ]);
    expect(capturedInputs.every((input) => input.location === undefined)).toBe(
      true,
    );
    expect(
      capturedInputs.every(
        (input) =>
          input.companyUrl ===
          "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
      ),
    ).toBe(true);
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
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        job: expect.any(JobPostDto),
        target: expect.objectContaining({ key: Site.GOOGLE, tier: 2 }),
        requestId: expect.stringContaining(`${Site.GOOGLE}:matrix-`),
        location: "Toronto",
        countryCodes: ["CA"],
        matrixIndex: expect.any(Number),
      }),
    );
  });

  it("shares the global concurrency limit across concurrent watch executions", async () => {
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const release = deferredValue<void>();
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [
          Site.GOOGLE_CAREERS,
          Site.AMAZON,
          Site.UBER,
        ],
        searchJobs: async () => {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await release.promise;
          active -= 1;
          return [];
        },
      },
      new WatchSourcePlanner(),
      {
        maxConcurrency: 2,
        maxConcurrencyPerSource: 2,
        maxJitterMs: 0,
        timeoutMs: 1_000,
      },
    );

    const executions = [
      executor.execute({
        watch: createWatch({
          id: "global-limit-watch-1",
          sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1)],
        }),
        force: true,
      }),
      executor.execute({
        watch: createWatch({
          id: "global-limit-watch-2",
          sourceTargets: [sourceTarget(Site.AMAZON, 1)],
        }),
        force: true,
      }),
      executor.execute({
        watch: createWatch({
          id: "global-limit-watch-3",
          sourceTargets: [sourceTarget(Site.UBER, 1)],
        }),
        force: true,
      }),
    ];

    await waitFor(() => calls >= 2);
    const activeBeforeRelease = active;
    release.resolve(undefined);
    const results = await Promise.all(executions);

    expect(activeBeforeRelease).toBe(2);
    expect(maximumActive).toBe(2);
    expect(calls).toBe(3);
    expect(results.every((result) => result.status === "completed")).toBe(true);
  });

  it("shares the per-source concurrency limit across concurrent watch executions", async () => {
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const release = deferredValue<void>();
    const executor = new JobsServiceWatchExecutor(
      {
        listRegisteredSources: () => [Site.GOOGLE_CAREERS],
        searchJobs: async () => {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await release.promise;
          active -= 1;
          return [];
        },
      },
      new WatchSourcePlanner(),
      {
        maxConcurrency: 4,
        maxConcurrencyPerSource: 1,
        maxJitterMs: 0,
        timeoutMs: 1_000,
      },
    );

    const executions = [
      executor.execute({
        watch: createWatch({
          id: "source-limit-watch-1",
          sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1)],
        }),
        force: true,
      }),
      executor.execute({
        watch: createWatch({
          id: "source-limit-watch-2",
          sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1)],
        }),
        force: true,
      }),
    ];

    await waitFor(() => calls >= 1);
    const activeBeforeRelease = active;
    release.resolve(undefined);
    const results = await Promise.all(executions);

    expect(activeBeforeRelease).toBe(1);
    expect(maximumActive).toBe(1);
    expect(calls).toBe(2);
    expect(results.every((result) => result.status === "completed")).toBe(true);
  });

  it("forwards scoped locations and effective countries and attributes each job", async () => {
    const capturedInputs: ScraperInputDto[] = [];
    const service: WatchJobsService = {
      listRegisteredSources: () => [Site.GOOGLE],
      listSourceMetadata: () => [
        {
          site: Site.GOOGLE,
          category: "job-board",
          watchMode: "query",
        },
      ],
      searchJobs: async (input) => {
        capturedInputs.push(input);
        return [
          new JobPostDto({
            id: `job-${capturedInputs.length}`,
            site: Site.GOOGLE,
            title: "Software Intern",
            jobUrl: "https://example.com/job",
          }),
        ];
      },
    };
    const executor = new JobsServiceWatchExecutor(
      service,
      new WatchSourcePlanner(),
      { maxConcurrency: 2, maxConcurrencyPerSource: 1, maxJitterMs: 0 },
    );

    const result = await executor.execute({
      watch: createWatch({
        sourceTargets: [
          {
            site: Site.GOOGLE,
            tier: 2,
            intervalMinutes: 15,
            companyName: "Aggregator",
            enabled: true,
            searchScope: {
              countryCodes: ["CA", "US"],
              locations: ["Canada", "Seattle, Washington"],
              searchTerms: ["software intern"],
              maxRequestsPerRun: 2,
            },
          },
        ],
      }),
      force: true,
    });

    expect(capturedInputs.map((input) => input.location)).toEqual([
      "Canada",
      "Seattle, Washington",
    ]);
    expect(capturedInputs.map((input) => input.country)).toEqual([
      Country.CANADA,
      Country.USA,
    ]);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((resultJob) => resultJob.location)).toEqual([
      "Canada",
      "Seattle, Washington",
    ]);
    expect(
      result.jobs.every(
        (resultJob) =>
          resultJob.target.companyName === "Aggregator" &&
          resultJob.countryCodes.join(",") === "CA,US",
      ),
    ).toBe(true);
    expect(result.requestResults[1]).toEqual(
      expect.objectContaining({
        source: Site.GOOGLE,
        location: "Seattle, Washington",
        countryCodes: ["CA", "US"],
        matrixIndex: 1,
        target: expect.objectContaining({ key: Site.GOOGLE, tier: 2 }),
        status: "succeeded",
      }),
    );
  });

  it("applies the branded company name carried by a generic ATS target", async () => {
    const service: WatchJobsService = {
      listRegisteredSources: () => [Site.ASHBY],
      listSourceMetadata: () => [
        {
          site: Site.ASHBY,
          category: "ats",
          isAts: true,
          watchMode: "board",
        },
      ],
      searchJobs: async (input) => {
        expect(input.companySlug).toBe("wealthsimple");
        return [
          new JobPostDto({
            id: "ashby-1",
            site: Site.ASHBY,
            title: "Software Engineering Intern",
            companyName: "wealthsimple",
            jobUrl: "https://jobs.ashbyhq.com/wealthsimple/1",
          }),
        ];
      },
    };
    const executor = new JobsServiceWatchExecutor(
      service,
      new WatchSourcePlanner(),
      { maxJitterMs: 0 },
    );

    const result = await executor.execute({
      watch: createWatch({
        sourceTargets: [
          {
            site: Site.ASHBY,
            tier: 1,
            intervalMinutes: 3,
            companySlug: "wealthsimple",
            companyName: "Wealthsimple",
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Canada"],
            },
          },
        ],
      }),
      force: true,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].job.companyName).toBe("Wealthsimple");
    expect(result.jobs[0].target.key).toBe("ashby:wealthsimple");
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
    roleFamilies: [
      "software-engineering",
      "data-ai",
      "cybersecurity",
      "cloud-platform-infrastructure",
    ],
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

function deferredValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(
    "Condition was not met before the deterministic test deadline",
  );
}
