import { ConflictException } from "@nestjs/common";
import { JobPostDto, Site } from "@ever-jobs/models";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { JobFingerprintService } from "../services/job-fingerprint.service";
import { JobScoringService } from "../services/job-scoring.service";
import {
  JobsServiceWatchExecutor,
  WatchSourcesExecutionResult,
} from "../services/jobs-service-watch.executor";
import { NotificationDispatcher } from "../services/notification-dispatcher.service";
import {
  WatchExecutionOptions,
  WatchExecutionService,
} from "../services/watch-execution.service";
import { JobWatch, NotificationProvider } from "../interfaces/watch.types";

describe("WatchExecutionService durable pipeline", () => {
  it("baselines existing jobs, sends one new-job notification, and ignores an edit", async () => {
    let now = new Date("2026-07-14T12:00:00.000Z");
    let jobs = [
      internship("existing-1", "Existing role one"),
      internship("existing-2", "Existing role two"),
      internship("existing-3", "Existing role three"),
    ];
    const executor = fakeExecutor(() => sourceResult(jobs));
    const provider = successfulProvider();
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      }),
    );
    const execution = executionService(
      repository,
      executor,
      provider,
      () => now,
      "pipeline-worker",
    );

    const baseline = await execution.runWatch(watch.id, "baseline", {
      trigger: "initialize",
      forceSources: true,
    });
    expect(baseline).toEqual(
      expect.objectContaining({
        status: "completed",
        newJobsDetected: 3,
        matchesCreated: 3,
        notificationsSent: 0,
      }),
    );
    expect(provider.send).not.toHaveBeenCalled();
    await expect(repository.listNotifications({})).resolves.toMatchObject({
      total: 0,
    });
    const baselineMatches = await repository.listMatches({ watchId: watch.id });
    expect(baselineMatches.items).toHaveLength(3);
    expect(baselineMatches.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          notificationState: "suppressed",
          notificationSuppressionReason: "baseline",
        }),
      ]),
    );

    now = new Date("2026-07-14T12:03:00.000Z");
    jobs = [...jobs, internship("new-1", "Original new-job description")];
    const discovery = await execution.runWatch(watch.id);
    expect(discovery).toEqual(
      expect.objectContaining({
        status: "completed",
        newJobsDetected: 1,
        matchesCreated: 1,
        notificationsSent: 1,
      }),
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    const afterDiscovery = await repository.listObservedJobs({});
    const newObservation = afterDiscovery.items.find(
      (job) => job.externalJobId === "new-1",
    );
    expect(newObservation).toBeDefined();
    const originalDescriptionHash = newObservation?.descriptionHash;

    now = new Date("2026-07-14T12:06:00.000Z");
    jobs = jobs.map((job) =>
      job.id === "new-1"
        ? internship("new-1", "Edited new-job description with Terraform")
        : job,
    );
    const editRun = await execution.runWatch(watch.id);
    expect(editRun).toEqual(
      expect.objectContaining({
        status: "completed",
        newJobsDetected: 0,
        matchesCreated: 0,
        notificationsSent: 0,
      }),
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    const deliveries = await repository.listNotifications({});
    expect(deliveries.total).toBe(1);
    expect(deliveries.items[0]).toEqual(
      expect.objectContaining({ status: "sent", attemptCount: 1 }),
    );
    const matchesAfterEdit = await repository.listMatches({
      watchId: watch.id,
    });
    expect(
      matchesAfterEdit.items.filter(
        (match) => match.notificationSuppressionReason === "baseline",
      ),
    ).toHaveLength(3);
    expect(
      matchesAfterEdit.items.filter(
        (match) => match.notificationState === "sent",
      ),
    ).toHaveLength(1);
    const editedObservation = (
      await repository.listObservedJobs({})
    ).items.find((job) => job.externalJobId === "new-1");
    expect(editedObservation?.description).toContain("Edited new-job");
    expect(editedObservation?.descriptionHash).not.toBe(
      originalDescriptionHash,
    );
  });

  it("records partial source failure while persisting successful-source jobs", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        sources: [Site.GOOGLE_CAREERS, Site.AMAZON],
        sourceTargets: [
          sourceTarget(Site.GOOGLE_CAREERS),
          sourceTarget(Site.AMAZON),
        ],
      }),
    );
    const result = sourceResult(
      [internship("successful-1", "Successful job")],
      {
        partialFailure: Site.AMAZON,
      },
    );
    const execution = executionService(
      repository,
      fakeExecutor(() => result),
      successfulProvider(),
      () => now,
      "partial-worker",
    );

    const run = await execution.runWatch(watch.id, "baseline");

    expect(run).toEqual(
      expect.objectContaining({
        status: "partial",
        jobsFetched: 1,
        jobsNormalized: 1,
        newJobsDetected: 1,
        sourcesSucceeded: [Site.GOOGLE_CAREERS],
        sourcesFailed: [Site.AMAZON],
      }),
    );
    expect(run.errorSummary).toContain("source unavailable");
    await expect(repository.listObservedJobs({})).resolves.toMatchObject({
      total: 1,
    });
    const persistedWatch = await repository.getWatch(watch.id);
    expect(
      persistedWatch?.sourceTargets.find(
        (target) => target.site === Site.GOOGLE_CAREERS,
      )?.initializedAt,
    ).toEqual(now);
    expect(
      persistedWatch?.sourceTargets.find(
        (target) => target.site === Site.AMAZON,
      )?.initializedAt,
    ).toBeUndefined();
  });

  it("skips a malformed job instead of failing the whole run", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(pipelineWatch());
    const malformed = {
      ...internship("bad-1", "Malformed source row"),
      title: { unexpected: true },
    } as unknown as JobPostDto;
    const execution = executionService(
      repository,
      fakeExecutor(() =>
        sourceResult([malformed, internship("good-1", "Valid source row")]),
      ),
      successfulProvider(),
      () => now,
      "schema-drift-worker",
    );

    const run = await execution.runWatch(watch.id, "baseline");

    expect(run).toEqual(
      expect.objectContaining({
        status: "partial",
        jobsFetched: 2,
        jobsNormalized: 1,
        newJobsDetected: 1,
      }),
    );
    expect(run.errorSummary).toContain("missing or non-string title");
    await expect(repository.listObservedJobs({})).resolves.toMatchObject({
      total: 1,
    });
  });

  it("coerces numeric upstream identifiers before PostgreSQL persistence", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(pipelineWatch());
    const numericId = internship("temporary", "Numeric id source row");
    numericId.id = 1970393556866710 as unknown as string;
    const execution = executionService(
      repository,
      fakeExecutor(() => sourceResult([numericId])),
      successfulProvider(),
      () => now,
      "numeric-id-worker",
    );

    const run = await execution.runWatch(watch.id, "baseline");

    expect(run.status).toBe("completed");
    const page = await repository.listObservedJobs({});
    expect(page.items[0].externalJobId).toBe("1970393556866710");
  });

  it("allows only one replica to hold the database lease for a watch", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(pipelineWatch());
    const deferred = deferredValue<WatchSourcesExecutionResult>();
    const executor = fakeExecutor(() => deferred.promise);
    const first = executionService(
      repository,
      executor,
      successfulProvider(),
      () => now,
      "replica-a",
    );
    const second = executionService(
      repository,
      executor,
      successfulProvider(),
      () => now,
      "replica-b",
    );

    const activeRun = first.runWatch(watch.id, "baseline");
    await waitFor(() => executor.execute.mock.calls.length === 1);

    await expect(second.runWatch(watch.id, "baseline")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(executor.execute).toHaveBeenCalledTimes(1);

    deferred.resolve(sourceResult([]));
    await expect(activeRun).resolves.toMatchObject({ status: "completed" });
  });

  it("keeps cross-source observations but sends one canonical notification", async () => {
    const initializedAt = new Date("2026-07-14T11:00:00.000Z");
    const now = new Date("2026-07-14T12:00:00.000Z");
    const direct = internship("direct-1", "Official employer detail");
    direct.applyUrl =
      "https://careers.google.com/jobs/results/1?utm_source=direct";
    direct.jobUrl = direct.applyUrl;
    const aggregate = internship("aggregate-1", "Aggregator detail");
    aggregate.site = Site.GOOGLE;
    aggregate.jobUrl = "https://www.google.com/search?q=google+intern";
    aggregate.applyUrl =
      "https://careers.google.com/jobs/results/1?utm_source=aggregate";
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sources: [Site.GOOGLE_CAREERS, Site.GOOGLE],
        sourceTargets: [
          sourceTarget(Site.GOOGLE_CAREERS, 1, initializedAt),
          sourceTarget(Site.GOOGLE, 2, initializedAt),
        ],
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      }),
    );
    const provider = successfulProvider();
    const execution = executionService(
      repository,
      fakeExecutor(() => multiSourceResult([direct, aggregate], initializedAt)),
      provider,
      () => now,
      "canonical-worker",
    );

    const run = await execution.runWatch(watch.id);

    expect(run).toEqual(
      expect.objectContaining({
        status: "completed",
        newJobsDetected: 2,
        matchesCreated: 1,
        notificationsSent: 1,
      }),
    );
    await expect(repository.listObservedJobs({})).resolves.toMatchObject({
      total: 2,
    });
    await expect(
      repository.listMatches({ watchId: watch.id }),
    ).resolves.toMatchObject({
      total: 1,
    });
    await expect(
      repository.listNotifications({ watchId: watch.id }),
    ).resolves.toMatchObject({
      total: 1,
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("sends one Google Careers notification across matrix-specific Apply URLs", async () => {
    let now = new Date("2026-07-20T16:00:00.000Z");
    const initializedAt = new Date("2026-07-20T15:00:00.000Z");
    const first = internship(
      "google-careers-76982475250639558",
      "First matrix observation",
    );
    first.jobUrl =
      "https://www.google.com/about/careers/applications/jobs/results/76982475250639558-software-developer-intern-bs-summer-2027";
    first.applyUrl =
      "https://www.google.com/about/careers/applications/jobs/results/apply?jobId=stable&q=AI+engineer+intern&location=Greater+Toronto+Area&page=1";
    const second = new JobPostDto({
      ...first,
      description:
        "Second matrix observation. Internship building Python distributed systems on Google Cloud with Docker and Kubernetes.",
      applyUrl:
        "https://www.google.com/about/careers/applications/jobs/results/apply?jobId=stable&q=devops+engineer+intern&location=Waterloo%2C+Ontario&page=2",
    });
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1, initializedAt)],
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      }),
    );
    let current = first;
    const provider = successfulProvider();
    const execution = executionService(
      repository,
      fakeExecutor(() => sourceResult([current])),
      provider,
      () => now,
      "google-matrix-worker",
    );

    const firstRun = await execution.runWatch(watch.id);
    current = second;
    now = new Date("2026-07-20T16:03:00.000Z");
    const secondRun = await execution.runWatch(watch.id);

    expect(firstRun).toEqual(
      expect.objectContaining({
        newJobsDetected: 1,
        matchesCreated: 1,
        notificationsSent: 1,
      }),
    );
    expect(secondRun).toEqual(
      expect.objectContaining({
        newJobsDetected: 0,
        matchesCreated: 0,
        notificationsSent: 0,
      }),
    );
    await expect(repository.listObservedJobs({})).resolves.toMatchObject({
      total: 1,
    });
    await expect(
      repository.listMatches({ watchId: watch.id }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      repository.listNotifications({ watchId: watch.id }),
    ).resolves.toMatchObject({ total: 1 });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("notifies when a richer direct observation makes a suppressed canonical episode eligible", async () => {
    let now = new Date("2026-07-14T12:00:00.000Z");
    const initializedAt = new Date("2026-07-14T11:00:00.000Z");
    const employerUrl = "https://careers.google.com/jobs/results/recovered-1";
    const seattle = {
      city: "Seattle",
      state: "Washington",
      country: "United States",
      displayLocation: () => "Seattle, Washington, United States",
    };
    const aggregate = internship(
      "aggregate-recovered-1",
      "Thin aggregate observation",
    );
    aggregate.site = Site.GOOGLE;
    aggregate.location = seattle;
    aggregate.applyUrl = employerUrl;
    aggregate.jobUrl = "https://www.google.com/search?q=recovered+intern";
    const direct = internship(
      "direct-recovered-1",
      "Richer official employer observation",
    );
    direct.location = seattle;
    direct.applyUrl = employerUrl;
    direct.jobUrl = employerUrl;

    const aggregateTarget = plannedTarget(Site.GOOGLE, 1, initializedAt);
    const directTarget = plannedTarget(Site.GOOGLE_CAREERS, 2, initializedAt);
    let result = oneTargetResult(aggregate, aggregateTarget);
    const executor = fakeExecutor(() => result);
    const provider = successfulProvider();
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sources: [Site.GOOGLE, Site.GOOGLE_CAREERS],
        sourceTargets: [
          sourceTarget(Site.GOOGLE, 1, initializedAt),
          sourceTarget(Site.GOOGLE_CAREERS, 2, initializedAt),
        ],
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      }),
    );
    const execution = executionService(
      repository,
      executor,
      provider,
      () => now,
      "eligibility-recovery-worker",
    );

    const suppressedRun = await execution.runWatch(watch.id);
    expect(suppressedRun).toEqual(
      expect.objectContaining({
        matchesCreated: 1,
        notificationsSent: 0,
      }),
    );
    const suppressedMatch = (
      await repository.listMatches({
        watchId: watch.id,
      })
    ).items[0];
    expect(suppressedMatch).toEqual(
      expect.objectContaining({
        notificationState: "suppressed",
        notificationSuppressionReason: "eligibility",
      }),
    );
    expect(provider.send).not.toHaveBeenCalled();

    now = new Date("2026-07-14T12:03:00.000Z");
    result = oneTargetResult(direct, directTarget);
    const recoveredRun = await execution.runWatch(watch.id);

    expect(recoveredRun).toEqual(
      expect.objectContaining({
        matchesCreated: 0,
        notificationsSent: 1,
      }),
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    const sentMessage = (provider.send as jest.Mock).mock.calls[0]?.[0];
    expect(sentMessage).toEqual(
      expect.objectContaining({
        job: expect.objectContaining({
          externalJobId: "direct-recovered-1",
          source: Site.GOOGLE_CAREERS,
        }),
        match: expect.objectContaining({
          id: suppressedMatch.id,
          notificationState: "pending",
          notificationSuppressionReason: null,
        }),
      }),
    );
    await expect(
      repository.listNotifications({ watchId: watch.id }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      repository.listMatches({ watchId: watch.id }),
    ).resolves.toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          notificationState: "sent",
          notificationSuppressionReason: null,
        }),
      ],
    });
  });

  it("does not resend a canonical episode when its notification band changes", async () => {
    const now = new Date("2026-07-14T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      }),
    );
    const observed = await repository.upsertObservedJob({
      fingerprint: "band-change-observation",
      source: Site.GOOGLE,
      title: "Software Developer Intern",
      normalizedTitle: "software developer intern",
      canonicalKey: "canonical-job",
      canonicalEpisodeKey: "canonical-episode",
      firstSeenAt: now,
      lastSeenAt: now,
    });
    const matched = await repository.upsertMatch({
      watchId: watch.id,
      observedJobId: observed.job.id,
      canonicalEpisodeKey: "canonical-episode",
      score: 85,
      scoreBreakdown: scoreBreakdown(85),
      matchedTerms: ["software internship"],
      status: "new",
      firstMatchedAt: now,
      lastMatchedAt: now,
      notificationState: "pending",
    });
    const provider = successfulProvider();
    const dispatcher = new NotificationDispatcher(repository, [provider], {
      ownerId: "band-change-worker",
      maxAttempts: 3,
      claimTtlMs: 30_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 10_000,
      now: () => now,
      random: () => 0,
    });
    const message = {
      idempotencyKey: "",
      watch,
      job: observed.job,
      match: matched.match,
      detectedAt: now,
    };

    await expect(
      dispatcher.dispatch({ ...message, type: "urgent" }),
    ).resolves.toBe(1);
    await expect(
      dispatcher.dispatch({ ...message, type: "standard" }),
    ).resolves.toBe(0);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await expect(
      repository.listNotifications({ watchId: watch.id }),
    ).resolves.toMatchObject({
      total: 1,
    });
  });

  it("degrades Tier 1 after three hard failures and recovers on a valid empty success", async () => {
    let now = new Date("2026-07-14T12:00:00.000Z");
    let outcome: "failed" | "succeeded" = "failed";
    const repository = new InMemoryWatchRepository();
    const initializedAt = new Date("2026-07-14T11:00:00.000Z");
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1, initializedAt)],
      }),
    );
    const execution = executionService(
      repository,
      fakeExecutor(() => singleTargetResult(outcome, initializedAt)),
      successfulProvider(),
      () => now,
      "health-worker",
    );

    let run = await execution.runWatch(watch.id);
    expect(run.coverageDegraded).toBe(false);
    now = new Date(now.getTime() + 3 * 60_000);
    run = await execution.runWatch(watch.id);
    expect(run.coverageDegraded).toBe(false);
    now = new Date(now.getTime() + 3 * 60_000);
    run = await execution.runWatch(watch.id);
    expect(run.coverageDegraded).toBe(true);
    expect(run.targetResults?.[0]).toEqual(
      expect.objectContaining({
        outcome: "hard_failure",
        consecutiveHardFailures: 3,
        degraded: true,
      }),
    );

    outcome = "succeeded";
    now = new Date(now.getTime() + 3 * 60_000);
    run = await execution.runWatch(watch.id);
    expect(run.coverageDegraded).toBe(false);
    const health = (await repository.getWatch(watch.id))?.targetHealth?.[
      Site.GOOGLE_CAREERS
    ];
    expect(health).toEqual(
      expect.objectContaining({
        successCount: 1,
        hardFailureCount: 3,
        emptyRunCount: 1,
        consecutiveHardFailures: 0,
        degradedAt: null,
      }),
    );
  });

  it("breaks the hard-failure streak on a partial target outcome", async () => {
    let now = new Date("2026-07-14T12:00:00.000Z");
    const outcomes: Array<"failed" | "partial"> = [
      "failed",
      "partial",
      "failed",
      "failed",
    ];
    const repository = new InMemoryWatchRepository();
    const initializedAt = new Date("2026-07-14T11:00:00.000Z");
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1, initializedAt)],
      }),
    );
    const execution = executionService(
      repository,
      fakeExecutor(() =>
        singleTargetResult(outcomes.shift() ?? "failed", initializedAt),
      ),
      successfulProvider(),
      () => now,
      "partial-health-worker",
    );

    for (let index = 0; index < 4; index += 1) {
      const run = await execution.runWatch(watch.id);
      expect(run.coverageDegraded).toBe(false);
      now = new Date(now.getTime() + 3 * 60_000);
    }
    expect(
      (await repository.getWatch(watch.id))?.targetHealth?.[
        Site.GOOGLE_CAREERS
      ],
    ).toEqual(
      expect.objectContaining({
        partialRunCount: 1,
        hardFailureCount: 3,
        consecutiveHardFailures: 2,
      }),
    );
  });

  it("anchors the watch scheduler deadline to target completion cadence", async () => {
    const startedAt = new Date("2026-07-14T12:00:00.000Z");
    const completedAt = new Date("2026-07-14T12:00:30.000Z");
    let now = startedAt;
    const initializedAt = new Date("2026-07-14T11:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(
      pipelineWatch({
        initializedAt,
        sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS, 1, initializedAt)],
      }),
    );
    const execution = executionService(
      repository,
      fakeExecutor(() => {
        now = completedAt;
        return singleTargetResult("succeeded", initializedAt);
      }),
      successfulProvider(),
      () => now,
      "cadence-worker",
    );

    await execution.runWatch(watch.id);

    const persisted = await repository.getWatch(watch.id);
    const expected = new Date(completedAt.getTime() + 3 * 60_000);
    expect(persisted?.sourceTargets[0].nextRunAt).toEqual(expected);
    expect(persisted?.nextRunAt).toEqual(expected);
    expect(persisted?.nextRunAt).not.toEqual(
      new Date(startedAt.getTime() + 3 * 60_000),
    );
  });
});

function executionService(
  repository: InMemoryWatchRepository,
  executor: ReturnType<typeof fakeExecutor>,
  provider: ReturnType<typeof successfulProvider>,
  now: () => Date,
  ownerId: string,
): WatchExecutionService {
  const notifications = new NotificationDispatcher(
    repository,
    [provider as NotificationProvider],
    {
      ownerId: `${ownerId}-notifications`,
      maxAttempts: 3,
      claimTtlMs: 30_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 10_000,
      now,
      random: () => 0,
    },
  );
  const options: Partial<WatchExecutionOptions> = {
    ownerId,
    leaseTtlMs: 180_000,
    now,
  };
  return new WatchExecutionService(
    repository,
    new JobFingerprintService(),
    new JobScoringService(),
    notifications,
    executor as unknown as JobsServiceWatchExecutor,
    undefined,
    options,
  );
}

function successfulProvider() {
  return {
    type: "discord",
    send: jest.fn(async () => ({
      status: "sent" as const,
      providerResponse: {
        category: "success",
        retryable: false,
        status: 204,
      },
    })),
  };
}

function fakeExecutor(
  result: () =>
    | WatchSourcesExecutionResult
    | Promise<WatchSourcesExecutionResult>,
) {
  return { execute: jest.fn(async () => result()) };
}

function internship(id: string, description: string): JobPostDto {
  return new JobPostDto({
    id,
    site: Site.GOOGLE_CAREERS,
    title: "Software Developer Intern",
    companyName: "Google",
    description: `${description}. Internship building Python distributed systems on Google Cloud with Docker and Kubernetes.`,
    location: {
      city: "Toronto",
      state: "Ontario",
      country: "Canada",
      displayLocation: () => "Toronto, Ontario, Canada",
    },
    workFromHomeType: "Hybrid",
    employmentType: "internship",
    jobUrl: `https://careers.google.com/jobs/${id}`,
    applyUrl: `https://careers.google.com/jobs/${id}/apply`,
    datePosted: "2026-07-14T11:58:00.000Z",
  });
}

function pipelineWatch(overrides: Partial<JobWatch> = {}): Partial<JobWatch> {
  return {
    name: "Pipeline internships",
    enabled: true,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [Site.GOOGLE_CAREERS],
    sourceTiers: { [Site.GOOGLE_CAREERS]: 1 },
    sourceTargets: [sourceTarget(Site.GOOGLE_CAREERS)],
    companySlugs: [],
    companies: ["Google"],
    searchTerms: ["software developer intern"],
    requiredTerms: ["intern"],
    preferredTerms: ["Python", "Docker", "Kubernetes"],
    excludedTerms: [
      "senior",
      "staff",
      "principal",
      "manager",
      "director",
      "architect",
    ],
    locations: ["Toronto", "Ontario", "Canada"],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship", "co-op"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [],
    initializationMode: "baseline",
    nextRunAt: null,
    ...overrides,
  };
}

function sourceTarget(
  site: Site,
  tier: 1 | 2 | 3 = 1,
  initializedAt?: Date | null,
) {
  return {
    site,
    tier,
    intervalMinutes: tier === 1 ? 3 : tier === 2 ? 15 : 60,
    enabled: true,
    initializedAt,
  };
}

function sourceResult(
  jobs: JobPostDto[],
  options: { partialFailure?: Site } = {},
): WatchSourcesExecutionResult {
  const successful = sourceSummary(
    Site.GOOGLE_CAREERS,
    "succeeded",
    jobs.length,
  );
  const failed = options.partialFailure
    ? sourceSummary(options.partialFailure, "failed", 0)
    : undefined;
  const targets = [plannedTarget(Site.GOOGLE_CAREERS)];
  if (options.partialFailure)
    targets.push(plannedTarget(options.partialFailure));
  return {
    status: failed ? "partial" : "completed",
    jobs: jobs.map((job) => ({
      job,
      target: targets[0],
      requestId: `${targets[0].key}:board`,
      countryCodes: ["CA"],
      matrixIndex: 0,
    })),
    sourcesRequested: targets.map((target) => target.key),
    sourcesSucceeded: [Site.GOOGLE_CAREERS],
    sourcesFailed: failed ? [failed.source] : [],
    failures: failed
      ? [
          {
            source: failed.source,
            requestId: `${failed.source}:board`,
            category: "source",
            error: "source unavailable",
            retryable: true,
          },
        ]
      : [],
    requestResults: [],
    sourceResults: failed ? [successful, failed] : [successful],
    plan: {
      dueTiers: [1],
      skippedTiers: [],
      targets,
      skippedTargets: [],
      requests: [],
      issues: [],
    },
  };
}

function plannedTarget(
  site: Site,
  tier: 1 | 2 | 3 = 1,
  initializedAt?: Date | null,
) {
  return {
    key: site,
    configuredSource: site,
    site,
    tier,
    kind: (site === Site.GOOGLE ? "structured" : "direct") as
      | "structured"
      | "direct",
    mode: (site === Site.GOOGLE ? "query" : "board") as "query" | "board",
    intervalMinutes: tier === 1 ? 3 : tier === 2 ? 15 : 60,
    searchScope: {
      countryCodes: ["CA"],
      locations: ["Toronto, Ontario"],
      searchTerms: ["software developer intern"],
    },
    initializedAt,
  };
}

function multiSourceResult(
  jobs: JobPostDto[],
  initializedAt: Date,
): WatchSourcesExecutionResult {
  const targets = [
    plannedTarget(Site.GOOGLE_CAREERS, 1, initializedAt),
    plannedTarget(Site.GOOGLE, 2, initializedAt),
  ];
  return {
    status: "completed",
    jobs: jobs.map((job, index) => ({
      job,
      target: targets[index],
      requestId: `${targets[index].key}:request`,
      searchTerm: "software developer intern",
      location: "Toronto, Ontario",
      countryCodes: ["CA"],
      matrixIndex: 0,
    })),
    sourcesRequested: targets.map((target) => target.key),
    sourcesSucceeded: targets.map((target) => target.key),
    sourcesFailed: [],
    failures: [],
    requestResults: [],
    sourceResults: targets.map((target) => ({
      source: target.key,
      status: "succeeded" as const,
      requests: 1,
      requestsSucceeded: 1,
      requestsFailed: 0,
      jobsFetched: 1,
      durationMs: 10,
    })),
    plan: {
      dueTiers: [1, 2],
      skippedTiers: [3],
      targets,
      skippedTargets: [],
      requests: [],
      issues: [],
    },
  };
}

function oneTargetResult(
  job: JobPostDto,
  target: ReturnType<typeof plannedTarget>,
): WatchSourcesExecutionResult {
  return {
    status: "completed",
    jobs: [
      {
        job,
        target,
        requestId: `${target.key}:request`,
        searchTerm: "software developer intern",
        location: "Seattle, Washington",
        countryCodes: target.tier === 1 ? ["CA"] : ["CA", "US"],
        matrixIndex: 0,
      },
    ],
    sourcesRequested: [target.key],
    sourcesSucceeded: [target.key],
    sourcesFailed: [],
    failures: [],
    requestResults: [],
    sourceResults: [
      {
        source: target.key,
        status: "succeeded",
        requests: 1,
        requestsSucceeded: 1,
        requestsFailed: 0,
        jobsFetched: 1,
        durationMs: 10,
      },
    ],
    plan: {
      dueTiers: [target.tier],
      skippedTiers: ([1, 2, 3] as const).filter((tier) => tier !== target.tier),
      targets: [target],
      skippedTargets: [],
      requests: [],
      issues: [],
    },
  };
}

function singleTargetResult(
  status: "succeeded" | "partial" | "failed",
  initializedAt: Date,
): WatchSourcesExecutionResult {
  const target = plannedTarget(Site.GOOGLE_CAREERS, 1, initializedAt);
  const requestsSucceeded = status === "failed" ? 0 : 1;
  const requestsFailed = status === "succeeded" ? 0 : 1;
  return {
    status:
      status === "succeeded"
        ? "completed"
        : status === "partial"
          ? "partial"
          : "failed",
    jobs: [],
    sourcesRequested: [target.key],
    sourcesSucceeded: status === "succeeded" ? [target.key] : [],
    sourcesFailed: status === "succeeded" ? [] : [target.key],
    failures:
      status === "succeeded"
        ? []
        : [
            {
              source: target.key,
              requestId: `${target.key}:request`,
              category: "source",
              error: "source unavailable",
              retryable: true,
            },
          ],
    requestResults: [],
    sourceResults: [
      {
        source: target.key,
        status,
        requests: requestsSucceeded + requestsFailed,
        requestsSucceeded,
        requestsFailed,
        jobsFetched: 0,
        durationMs: 10,
      },
    ],
    plan: {
      dueTiers: [1],
      skippedTiers: [2, 3],
      targets: [target],
      skippedTargets: [],
      requests: [],
      issues: [],
    },
  };
}

function sourceSummary(
  source: Site,
  status: "succeeded" | "failed",
  jobsFetched: number,
) {
  return {
    source,
    status,
    requests: 1,
    requestsSucceeded: status === "succeeded" ? 1 : 0,
    requestsFailed: status === "failed" ? 1 : 0,
    jobsFetched,
    durationMs: 10,
  };
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
