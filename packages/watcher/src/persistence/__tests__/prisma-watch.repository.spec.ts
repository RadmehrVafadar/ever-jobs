import { PrismaWatchRepository } from "../prisma-watch.repository";
import { WatcherPrismaService } from "../watcher-prisma.service";

describe("PrismaWatchRepository", () => {
  it("requires the role-family migration in the repository health check", async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const repository = makeRepository({ $queryRaw: queryRaw });

    await expect(repository.healthCheck()).resolves.toBe(true);
    expect(JSON.stringify(queryRaw.mock.calls[0][0])).toContain("roleFamilies");
  });

  it("serializes role families and per-target URL/mode settings into watch JSON", async () => {
    const create = jest.fn().mockRejectedValue(new Error("stop after capture"));
    const repository = makeRepository({ jobWatch: { create } });

    await expect(
      repository.createWatch({
        name: "Coverage",
        roleFamilies: ["technical-product", "technology-risk-it-audit"],
        notificationRoutes: [
          {
            id: "tier-one",
            name: "Tier one",
            enabled: true,
            provider: "discord",
            destinationRef: "tier-one",
            conditions: { sourceTiers: [1] },
          },
        ],
        sourceTargets: [
          {
            site: "workday",
            tier: 1,
            intervalMinutes: 10,
            resultsWanted: 500,
            companySlug: "rbc:3:RBCEARLYTALENT1",
            companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
            mode: "board-search",
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Toronto, Ontario"],
              strictLocations: true,
            },
            enabled: true,
          },
        ],
      }),
    ).rejects.toThrow("stop after capture");

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceTargets: [
          expect.objectContaining({
            site: "workday",
            resultsWanted: 500,
            companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
            mode: "board-search",
            searchScope: expect.objectContaining({
              strictLocations: true,
            }),
          }),
        ],
        roleFamilies: ["technical-product", "technology-risk-it-audit"],
        notificationRoutes: [
          expect.objectContaining({
            id: "tier-one",
            destinationRef: "tier-one",
          }),
        ],
      }),
    });
  });

  it("round-trips sparse target cadence and geography without expanding defaults", async () => {
    const updatedAt = new Date("2026-08-13T12:00:00.000Z");
    const row = {
      ...watchRow("Sparse defaults", updatedAt),
      intervalMinutes: 20,
      locations: ["Toronto", "Remote"],
      countryCodes: ["CA", "US"],
      sourceTargets: [
        {
          site: "google",
          tier: 2,
          enabled: true,
          searchScope: {
            searchTerms: ["software intern"],
            maxRequestsPerRun: 2,
          },
        },
      ],
    };
    const repository = makeRepository({
      jobWatch: { findUnique: jest.fn().mockResolvedValue(row) },
    });

    await expect(repository.getWatch("watch-1")).resolves.toEqual(
      expect.objectContaining({
        intervalMinutes: 20,
        sourceTargets: [
          {
            site: "google",
            tier: 2,
            enabled: true,
            searchScope: {
              searchTerms: ["software intern"],
              maxRequestsPerRun: 2,
            },
          },
        ],
      }),
    );
  });

  it("claims a due watch with one conditional update", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = makeRepository({
      jobWatch: { updateMany },
    });
    const now = new Date("2026-07-14T12:00:00.000Z");
    const expiresAt = new Date("2026-07-14T12:02:00.000Z");
    const nextRunAt = new Date("2026-07-14T12:03:00.000Z");

    await expect(
      repository.tryAcquireWatchLease({
        watchId: "watch-1",
        ownerId: "worker-a",
        token: "lease-a",
        now,
        expiresAt,
        nextRunAt,
      }),
    ).resolves.toEqual({
      watchId: "watch-1",
      ownerId: "worker-a",
      token: "lease-a",
      expiresAt,
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "watch-1",
          enabled: true,
        }),
        data: expect.objectContaining({
          leaseOwnerId: "worker-a",
          leaseToken: "lease-a",
          leaseExpiresAt: expiresAt,
          nextRunAt,
        }),
      }),
    );
  });

  it("returns no lease when another replica wins the conditional update", async () => {
    const repository = makeRepository({
      jobWatch: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    const now = new Date("2026-07-14T12:00:00.000Z");

    await expect(
      repository.tryAcquireWatchLease({
        watchId: "watch-1",
        ownerId: "worker-b",
        token: "lease-b",
        now,
        expiresAt: new Date(now.getTime() + 120_000),
        nextRunAt: new Date(now.getTime() + 180_000),
      }),
    ).resolves.toBeNull();
  });

  it("atomically applies a watch patch only at the expected revision", async () => {
    const expectedUpdatedAt = new Date("2026-08-04T12:00:00.000Z");
    const appliedUpdatedAt = new Date("2026-08-04T12:00:01.000Z");
    const notificationRoutes = [
      {
        id: "tier-one",
        name: "Tier one",
        enabled: true,
        provider: "discord" as const,
        destinationRef: "tier-one",
        conditions: { sourceTiers: [1 as const] },
      },
    ];
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValue(
        watchRow("Applied", appliedUpdatedAt, notificationRoutes),
      );
    const transaction = { jobWatch: { updateMany, findUnique } };
    const repository = makeRepository({
      $transaction: jest
        .fn()
        .mockImplementation(
          async (work: (client: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
    });

    await expect(
      repository.updateWatchIfCurrent("watch-1", expectedUpdatedAt, {
        name: "Applied",
        notificationRoutes,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "watch-1",
        name: "Applied",
        notificationRoutes,
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "watch-1", updatedAt: expectedUpdatedAt },
      data: expect.objectContaining({
        name: "Applied",
        notificationRoutes,
      }),
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "watch-1" } });
  });

  it("returns null from a stale atomic watch patch without reading a row", async () => {
    const findUnique = jest.fn();
    const transaction = {
      jobWatch: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique,
      },
    };
    const repository = makeRepository({
      $transaction: jest
        .fn()
        .mockImplementation(
          async (work: (client: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
    });

    await expect(
      repository.updateWatchIfCurrent(
        "watch-1",
        new Date("2026-08-04T11:59:59.000Z"),
        { name: "Stale" },
      ),
    ).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("persists an observation and its watch match in one serializable transaction", async () => {
    const createdAt = new Date("2026-07-14T12:00:00.000Z");
    const observedJob = {
      id: "job-1",
      fingerprint: "fingerprint-1",
      source: "greenhouse",
      sourceType: "ats",
      externalJobId: "external-1",
      company: "Example",
      normalizedCompany: "example",
      title: "Software Engineer Intern",
      normalizedTitle: "software engineer intern",
      location: "Toronto, Ontario, Canada",
      normalizedLocation: "toronto ontario canada",
      workplaceType: "hybrid",
      employmentType: "internship",
      description: "Build useful things",
      descriptionHash: "description-1",
      jobUrl: "https://example.com/jobs/1",
      applicationUrl: "https://example.com/jobs/1/apply",
      sourcePublishedAt: createdAt,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      closedAt: null,
      rawPayload: null,
      createdAt,
      updatedAt: createdAt,
    };
    const watchMatch = {
      id: "match-1",
      watchId: "watch-1",
      observedJobId: "job-1",
      score: 90,
      scoreBreakdown: scoreBreakdown(90),
      matchedTerms: ["software internship"],
      excludedReason: null,
      status: "new",
      firstMatchedAt: createdAt,
      lastMatchedAt: createdAt,
      notificationState: "pending",
      createdAt,
      updatedAt: createdAt,
    };
    const transaction = {
      observedJob: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(observedJob),
      },
      watchMatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(watchMatch),
      },
    };
    const $transaction = jest
      .fn()
      .mockImplementation(async (work: (client: unknown) => Promise<unknown>) =>
        work(transaction),
      );
    const repository = makeRepository({ $transaction });

    const result = await repository.persistObservationAndMatch({
      observedJob: {
        fingerprint: observedJob.fingerprint,
        source: observedJob.source,
        sourceType: observedJob.sourceType,
        externalJobId: observedJob.externalJobId,
        company: observedJob.company,
        normalizedCompany: observedJob.normalizedCompany,
        title: observedJob.title,
        normalizedTitle: observedJob.normalizedTitle,
        location: observedJob.location,
        normalizedLocation: observedJob.normalizedLocation,
        workplaceType: observedJob.workplaceType,
        employmentType: observedJob.employmentType,
        description: observedJob.description,
        descriptionHash: observedJob.descriptionHash,
        jobUrl: observedJob.jobUrl,
        applicationUrl: observedJob.applicationUrl,
        sourcePublishedAt: observedJob.sourcePublishedAt,
        firstSeenAt: observedJob.firstSeenAt,
        lastSeenAt: observedJob.lastSeenAt,
        closedAt: observedJob.closedAt,
      },
      match: {
        watchId: watchMatch.watchId,
        score: watchMatch.score,
        scoreBreakdown: scoreBreakdown(90),
        matchedTerms: watchMatch.matchedTerms,
        excludedReason: null,
        status: "new",
        firstMatchedAt: createdAt,
        lastMatchedAt: createdAt,
        notificationState: "pending",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        isNewJob: true,
        isNewMatch: true,
        descriptionChanged: false,
      }),
    );
    expect(
      transaction.observedJob.create.mock.invocationCallOrder[0],
    ).toBeLessThan(transaction.watchMatch.create.mock.invocationCallOrder[0]);
    expect(transaction.watchMatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ observedJobId: "job-1" }),
      }),
    );
    expect($transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" }),
    );
  });

  it("upgrades a legacy observed-job match when canonical lookup is empty", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const observedJob = {
      id: "legacy-job",
      fingerprint: "legacy-fingerprint",
      source: "google",
      sourceTargetKey: null,
      sourceType: null,
      externalJobId: "legacy-external",
      company: "Example",
      normalizedCompany: "example",
      title: "Software Engineer Intern",
      normalizedTitle: "software engineer intern",
      location: "Toronto, Ontario, Canada",
      normalizedLocation: "ca|on|toronto",
      locations: [],
      canonicalKey: null,
      canonicalEpisodeKey: null,
      canonicalEpisodeStartedAt: null,
      workplaceType: "hybrid",
      employmentType: "internship",
      description: null,
      descriptionHash: null,
      jobUrl: "https://aggregator.example/jobs/1",
      applicationUrl: null,
      sourcePublishedAt: null,
      firstSeenAt: now,
      lastSeenAt: now,
      closedAt: null,
      rawPayload: null,
      createdAt: now,
      updatedAt: now,
    };
    const legacyMatch = {
      id: "legacy-match",
      watchId: "watch-1",
      observedJobId: observedJob.id,
      canonicalEpisodeKey: null,
      sourceTargetKey: null,
      score: 70,
      scoreBreakdown: scoreBreakdown(70),
      matchedTerms: [],
      excludedReason: null,
      status: "new",
      firstMatchedAt: now,
      lastMatchedAt: now,
      notificationState: "sent",
      createdAt: now,
      updatedAt: now,
    };
    const upgradedObservedJob = {
      ...observedJob,
      canonicalKey: "canonical-job",
      canonicalEpisodeKey: "canonical-episode",
    };
    const upgradedMatch = {
      ...legacyMatch,
      canonicalEpisodeKey: "canonical-episode",
      sourceTargetKey: "google",
      score: 90,
      scoreBreakdown: scoreBreakdown(90),
      matchedTerms: ["software internship"],
    };
    const transaction = {
      observedJob: {
        findUnique: jest.fn().mockResolvedValue(observedJob),
        update: jest.fn().mockResolvedValue(upgradedObservedJob),
      },
      watchMatch: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(legacyMatch),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(upgradedMatch),
      },
    };
    const repository = makeRepository({
      $transaction: jest
        .fn()
        .mockImplementation(
          async (work: (client: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
    });

    const result = await repository.persistObservationAndMatch({
      observedJob: {
        fingerprint: observedJob.fingerprint,
        source: observedJob.source,
        sourceTargetKey: "google",
        externalJobId: observedJob.externalJobId,
        company: observedJob.company,
        normalizedCompany: observedJob.normalizedCompany,
        title: observedJob.title,
        normalizedTitle: observedJob.normalizedTitle,
        location: observedJob.location,
        normalizedLocation: observedJob.normalizedLocation,
        locations: [],
        canonicalKey: "canonical-job",
        canonicalEpisodeKey: "canonical-episode",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      match: {
        watchId: "watch-1",
        canonicalEpisodeKey: "canonical-episode",
        sourceTargetKey: "google",
        score: 90,
        scoreBreakdown: scoreBreakdown(90),
        matchedTerms: ["software internship"],
        status: "new",
        firstMatchedAt: now,
        lastMatchedAt: now,
        notificationState: "pending",
      },
    });

    expect(result.isNewMatch).toBe(false);
    expect(result.match.id).toBe(legacyMatch.id);
    expect(result.match.notificationState).toBe("sent");
    expect(transaction.watchMatch.findUnique).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          watchId_canonicalEpisodeKey: {
            watchId: "watch-1",
            canonicalEpisodeKey: "canonical-episode",
          },
        },
      }),
    );
    expect(transaction.watchMatch.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          watchId_observedJobId: {
            watchId: "watch-1",
            observedJobId: observedJob.id,
          },
        },
      }),
    );
    expect(transaction.watchMatch.create).not.toHaveBeenCalled();
    expect(transaction.watchMatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: legacyMatch.id },
        data: expect.objectContaining({
          canonicalEpisodeKey: "canonical-episode",
          sourceTargetKey: "google",
        }),
      }),
    );
    expect(
      transaction.watchMatch.update.mock.calls[0][0].data,
    ).not.toHaveProperty("notificationState");
  });

  it("creates a fresh episode match when a stable source fingerprint rolls over", async () => {
    const firstSeenAt = new Date("2026-07-01T12:00:00.000Z");
    const repostSeenAt = new Date("2026-07-16T12:00:00.000Z");
    const stableObservation = {
      id: "observation-episode-a",
      fingerprint: "stable-source-fingerprint",
      source: "google",
      sourceTargetKey: "google",
      sourceType: null,
      externalJobId: "stable-external-id",
      company: "Example",
      normalizedCompany: "example",
      title: "Software Engineer Intern",
      normalizedTitle: "software engineer intern",
      location: "Toronto, Ontario, Canada",
      normalizedLocation: "ca|on|toronto",
      locations: [],
      canonicalKey: "canonical-core",
      canonicalEpisodeKey: "episode-a",
      canonicalEpisodeStartedAt: firstSeenAt,
      workplaceType: "hybrid",
      employmentType: "internship",
      description: "First posting episode",
      descriptionHash: "description-a",
      jobUrl: null,
      applicationUrl: null,
      sourcePublishedAt: null,
      firstSeenAt,
      lastSeenAt: firstSeenAt,
      closedAt: null,
      rawPayload: null,
      createdAt: firstSeenAt,
      updatedAt: firstSeenAt,
    };
    const createdObservation = {
      ...stableObservation,
      id: "observation-episode-b",
      canonicalEpisodeKey: "episode-b",
      canonicalEpisodeStartedAt: repostSeenAt,
      description: "Reposted after the fallback window",
      descriptionHash: "description-b",
      firstSeenAt: repostSeenAt,
      lastSeenAt: repostSeenAt,
      createdAt: repostSeenAt,
      updatedAt: repostSeenAt,
    };
    const createdMatch = {
      id: "match-episode-b",
      watchId: "watch-1",
      observedJobId: createdObservation.id,
      canonicalEpisodeKey: "episode-b",
      sourceTargetKey: "google",
      score: 90,
      scoreBreakdown: scoreBreakdown(90),
      matchedTerms: ["software internship"],
      excludedReason: null,
      status: "new",
      firstMatchedAt: repostSeenAt,
      lastMatchedAt: repostSeenAt,
      notificationState: "pending",
      notificationSuppressionReason: null,
      createdAt: repostSeenAt,
      updatedAt: repostSeenAt,
    };
    const transaction = {
      observedJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(stableObservation)
          .mockResolvedValueOnce(null),
        create: jest
          .fn()
          .mockImplementation(
            async (input: { data: { fingerprint: string } }) => ({
              ...createdObservation,
              fingerprint: input.data.fingerprint,
            }),
          ),
      },
      watchMatch: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(createdMatch),
      },
    };
    const repository = makeRepository({
      $transaction: jest
        .fn()
        .mockImplementation(
          async (work: (client: unknown) => Promise<unknown>) =>
            work(transaction),
        ),
    });

    const result = await repository.persistObservationAndMatch({
      observedJob: {
        fingerprint: stableObservation.fingerprint,
        source: stableObservation.source,
        sourceTargetKey: stableObservation.sourceTargetKey,
        externalJobId: stableObservation.externalJobId,
        company: stableObservation.company,
        normalizedCompany: stableObservation.normalizedCompany,
        title: stableObservation.title,
        normalizedTitle: stableObservation.normalizedTitle,
        location: stableObservation.location,
        normalizedLocation: stableObservation.normalizedLocation,
        locations: [],
        canonicalKey: stableObservation.canonicalKey,
        canonicalEpisodeKey: "episode-b",
        canonicalEpisodeStartedAt: repostSeenAt,
        employmentType: stableObservation.employmentType,
        description: createdObservation.description,
        descriptionHash: createdObservation.descriptionHash,
        firstSeenAt: repostSeenAt,
        lastSeenAt: repostSeenAt,
      },
      canonicalEpisodeAnchorWindowMs: 14 * 24 * 60 * 60 * 1_000,
      match: {
        watchId: "watch-1",
        canonicalEpisodeKey: "episode-b",
        sourceTargetKey: "google",
        score: 90,
        scoreBreakdown: scoreBreakdown(90),
        matchedTerms: ["software internship"],
        status: "new",
        firstMatchedAt: repostSeenAt,
        lastMatchedAt: repostSeenAt,
        notificationState: "pending",
        notificationSuppressionReason: null,
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        isNewJob: true,
        isNewMatch: true,
      }),
    );
    expect(result.job.id).toBe("observation-episode-b");
    expect(result.job.fingerprint).not.toBe(stableObservation.fingerprint);
    expect(result.match.id).toBe("match-episode-b");
    expect(transaction.observedJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fingerprint: expect.not.stringMatching(/^stable-source-fingerprint$/),
          canonicalEpisodeKey: "episode-b",
        }),
      }),
    );
    expect(transaction.watchMatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          observedJobId: "observation-episode-b",
          canonicalEpisodeKey: "episode-b",
        }),
      }),
    );
  });
});

function makeRepository(client: object): PrismaWatchRepository {
  return new PrismaWatchRepository(client as WatcherPrismaService);
}

function watchRow(
  name: string,
  updatedAt: Date,
  notificationRoutes: unknown[] = [],
) {
  const createdAt = new Date("2026-08-04T11:00:00.000Z");
  return {
    id: "watch-1",
    name,
    enabled: true,
    description: null,
    schedule: null,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [],
    sourceTiers: {},
    sourceTargets: [],
    targetHealth: {},
    companySlugs: [],
    companies: [],
    searchTerms: [],
    roleFamilies: [
      "software-engineering",
      "data-ai",
      "cybersecurity",
      "cloud-platform-infrastructure",
    ],
    requiredTerms: [],
    preferredTerms: [],
    excludedTerms: [],
    locations: [],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship", "co-op"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [],
    notificationRoutes,
    initializationMode: "baseline",
    recentWindowMinutes: 180,
    weights: null,
    initializedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    leaseOwnerId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    createdAt,
    updatedAt,
  };
}

function scoreBreakdown(total: number) {
  return {
    total,
    role: 30,
    internship: 25,
    location: 25,
    company: 0,
    source: 10,
    skills: 0,
    matchedKeywords: ["software internship"],
    missingRequired: [],
    reasons: ["Exact internship title match"],
  };
}
