import { ConfigService } from "@nestjs/config";
import { Site } from "@ever-jobs/models";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { JobFingerprintService } from "../services/job-fingerprint.service";
import { JobScoringService } from "../services/job-scoring.service";
import {
  JobsServiceWatchExecutor,
  WatchSourcesExecutionResult,
} from "../services/jobs-service-watch.executor";
import { NotificationDispatcher } from "../services/notification-dispatcher.service";
import { DailyDigestService } from "../services/daily-digest.service";
import { WatchExecutionService } from "../services/watch-execution.service";
import { WatcherMetricsService } from "../services/watcher-metrics.service";
import { WatcherSchedulerService } from "../services/watcher-scheduler.service";
import { JobWatch, NotificationProvider } from "../interfaces/watch.types";

describe("WatcherSchedulerService", () => {
  it("does not overlap a due watch and starts its next run at three minutes", async () => {
    const startedAt = new Date("2026-07-14T12:00:00.000Z");
    let executionNow = startedAt;
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(scheduledWatch());
    const firstRun = deferredValue<WatchSourcesExecutionResult>();
    const executor = {
      execute: jest
        .fn<Promise<WatchSourcesExecutionResult>, []>()
        .mockImplementationOnce(() => firstRun.promise)
        .mockResolvedValue(sourceResult()),
    };
    const provider = {
      type: "discord",
      send: jest.fn(async () => ({ status: "sent" as const })),
    };
    const notifications = new NotificationDispatcher(
      repository,
      [provider as NotificationProvider],
      {
        ownerId: "scheduler-notifications",
        maxAttempts: 3,
        claimTtlMs: 30_000,
        retryBaseDelayMs: 1_000,
        retryMaxDelayMs: 10_000,
        now: () => executionNow,
        random: () => 0,
      },
    );
    const execution = new WatchExecutionService(
      repository,
      new JobFingerprintService(),
      new JobScoringService(),
      notifications,
      executor as unknown as JobsServiceWatchExecutor,
      undefined,
      {
        ownerId: "scheduler-worker",
        leaseTtlMs: 180_000,
        now: () => executionNow,
      },
    );
    const metrics = new WatcherMetricsService();
    const config = configService({
      "watcher.enabled": true,
      "watcher.maxConcurrentWatches": 2,
      "watcher.schedulerPollMs": 15_000,
      "watcher.digestEnabled": false,
    });
    const scheduler = new WatcherSchedulerService(
      repository,
      execution,
      notifications,
      new DailyDigestService(repository, notifications, config),
      metrics,
      config,
    );

    await scheduler.tick(startedAt);
    await waitFor(() => executor.execute.mock.calls.length === 1);
    expect(scheduler.status().activeWatchIds).toEqual([watch.id]);

    await scheduler.tick(new Date(startedAt.getTime() + 179_000));
    expect(executor.execute).toHaveBeenCalledTimes(1);

    // The watch is due again at exactly three minutes, but this process still
    // owns an active execution and must not overlap it.
    await scheduler.tick(new Date(startedAt.getTime() + 180_000));
    expect(executor.execute).toHaveBeenCalledTimes(1);

    firstRun.resolve(sourceResult());
    await waitFor(() => scheduler.status().activeWatchIds.length === 0);

    executionNow = new Date(startedAt.getTime() + 180_000);
    await scheduler.tick(executionNow);
    await waitFor(() => executor.execute.mock.calls.length === 2);
    await waitFor(() => scheduler.status().activeWatchIds.length === 0);

    const runs = await repository.listRuns({ watchId: watch.id });
    expect(runs.total).toBe(2);
    expect(runs.items.every((run) => run.status === "completed")).toBe(true);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

function scheduledWatch(overrides: Partial<JobWatch> = {}): Partial<JobWatch> {
  return {
    name: "Scheduled internships",
    enabled: true,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [Site.GOOGLE_CAREERS],
    sourceTiers: { [Site.GOOGLE_CAREERS]: 1 },
    sourceTargets: [
      {
        site: Site.GOOGLE_CAREERS,
        tier: 1,
        intervalMinutes: 3,
        enabled: true,
        nextRunAt: null,
      },
    ],
    companySlugs: [],
    companies: ["Google"],
    searchTerms: ["software developer intern"],
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
    nextRunAt: null,
    ...overrides,
  };
}

function sourceResult(): WatchSourcesExecutionResult {
  const target = {
    key: Site.GOOGLE_CAREERS,
    configuredSource: Site.GOOGLE_CAREERS,
    site: Site.GOOGLE_CAREERS,
    tier: 1 as const,
    kind: "direct" as const,
    mode: "board" as const,
  };
  return {
    status: "completed",
    jobs: [],
    sourcesRequested: [Site.GOOGLE_CAREERS],
    sourcesSucceeded: [Site.GOOGLE_CAREERS],
    sourcesFailed: [],
    failures: [],
    requestResults: [],
    sourceResults: [
      {
        source: Site.GOOGLE_CAREERS,
        status: "succeeded",
        requests: 1,
        requestsSucceeded: 1,
        requestsFailed: 0,
        jobsFetched: 0,
        durationMs: 1,
      },
    ],
    plan: {
      dueTiers: [1],
      skippedTiers: [],
      targets: [target],
      skippedTargets: [],
      requests: [],
      issues: [],
    },
  };
}

function configService(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, fallback: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
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
