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

function sourceTarget(site: Site) {
  return {
    site,
    tier: 1 as const,
    intervalMinutes: 3,
    enabled: true,
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
    jobs,
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

function plannedTarget(site: Site) {
  return {
    key: site,
    configuredSource: site,
    site,
    tier: 1 as const,
    kind: "direct" as const,
    mode: "board" as const,
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
