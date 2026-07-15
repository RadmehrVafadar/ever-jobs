import { PrismaWatchRepository } from "../prisma-watch.repository";
import { WatcherPrismaService } from "../watcher-prisma.service";

describe("PrismaWatchRepository", () => {
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
});

function makeRepository(client: object): PrismaWatchRepository {
  return new PrismaWatchRepository(client as WatcherPrismaService);
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
