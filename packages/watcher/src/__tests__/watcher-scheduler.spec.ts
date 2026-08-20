import { ConflictException } from "@nestjs/common";
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
import {
  JobWatch,
  NotificationProvider,
  WatchRun,
} from "../interfaces/watch.types";

describe("WatcherSchedulerService", () => {
  it("runs distinct watches up to capacity and backfills the oldest waiting watch", async () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    await repository.createWatch(
      scheduledWatch({
        id: "watch-a",
        name: "Oldest due",
        nextRunAt: new Date(now.getTime() - 3_000),
      }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-b",
        name: "Second due",
        nextRunAt: new Date(now.getTime() - 2_000),
      }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-c",
        name: "Waiting due",
        nextRunAt: new Date(now.getTime() - 1_000),
      }),
    );
    const listDue = jest.spyOn(repository, "listDueWatches");
    const harness = controlledScheduler(repository, now, 2);

    const firstTick = harness.scheduler.tick(now);
    const reentrantTick = harness.scheduler.tick(now);
    await Promise.all([firstTick, reentrantTick]);
    await waitFor(() => harness.pending.size === 2);

    expect(harness.execution.runWatch.mock.calls.map(([id]) => id)).toEqual([
      "watch-a",
      "watch-b",
    ]);
    expect(listDue).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.status()).toEqual(
      expect.objectContaining({
        maxConcurrentWatches: 2,
        activeWatchCount: 2,
        activeWatchIds: ["watch-a", "watch-b"],
      }),
    );
    const activeMetrics = await harness.metrics.render();
    expect(activeMetrics).toMatch(/ever_jobs_watcher_scheduler_capacity 2\b/);
    expect(activeMetrics).toMatch(
      /ever_jobs_watcher_scheduler_active_runs 2\b/,
    );
    expect(harness.maximumActive()).toBe(2);

    harness.pending.get("watch-a")?.resolve(undefined);
    await waitFor(() => harness.execution.runWatch.mock.calls.length === 3);
    await waitFor(() => harness.pending.has("watch-c"));

    expect(harness.execution.runWatch.mock.calls.map(([id]) => id)).toEqual([
      "watch-a",
      "watch-b",
      "watch-c",
    ]);
    expect(harness.scheduler.status().activeWatchIds).toEqual([
      "watch-b",
      "watch-c",
    ]);
    expect(harness.maximumActive()).toBe(2);

    harness.pending.get("watch-b")?.resolve(undefined);
    harness.pending.get("watch-c")?.resolve(undefined);
    await waitFor(() => harness.scheduler.status().activeWatchCount === 0);
  });

  it("serializes distinct watches when capacity is one", async () => {
    const now = new Date("2026-08-19T13:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    await repository.createWatch(
      scheduledWatch({ id: "watch-a", nextRunAt: null }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-b",
        nextRunAt: new Date(now.getTime() - 1_000),
      }),
    );
    const harness = controlledScheduler(repository, now, 1);

    await harness.scheduler.tick(now);
    await waitFor(() => harness.pending.has("watch-a"));
    expect(harness.execution.runWatch).toHaveBeenCalledTimes(1);
    expect(harness.maximumActive()).toBe(1);

    harness.pending.get("watch-a")?.resolve(undefined);
    await waitFor(() => harness.pending.has("watch-b"));
    expect(harness.execution.runWatch.mock.calls.map(([id]) => id)).toEqual([
      "watch-a",
      "watch-b",
    ]);
    expect(harness.maximumActive()).toBe(1);

    harness.pending.get("watch-b")?.resolve(undefined);
    await waitFor(() => harness.scheduler.status().activeWatchCount === 0);
  });

  it("backfills a watch that becomes due after the preceding poll", async () => {
    const now = new Date("2026-08-19T13:30:00.000Z");
    const repository = new InMemoryWatchRepository();
    await repository.createWatch(
      scheduledWatch({ id: "watch-a", nextRunAt: null }),
    );
    await repository.createWatch(
      scheduledWatch({ id: "watch-b", nextRunAt: null }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-c",
        nextRunAt: new Date(now.getTime() + 30_000),
      }),
    );
    const harness = controlledScheduler(repository, now, 2);

    await harness.scheduler.tick(now);
    await waitFor(() => harness.pending.size === 2);
    expect(harness.execution.runWatch).toHaveBeenCalledTimes(2);

    harness.setNow(new Date(now.getTime() + 30_000));
    harness.pending.get("watch-a")?.resolve(undefined);
    await waitFor(() => harness.pending.has("watch-c"));

    expect(harness.execution.runWatch.mock.calls.map(([id]) => id)).toEqual([
      "watch-a",
      "watch-b",
      "watch-c",
    ]);
    harness.pending.get("watch-b")?.resolve(undefined);
    harness.pending.get("watch-c")?.resolve(undefined);
    await waitFor(() => harness.scheduler.status().activeWatchCount === 0);
  });

  it.each([
    [
      "lease conflict",
      new ConflictException("Watch is already running: watch-a"),
    ],
    ["missing watch", new Error("Watch not found: watch-a")],
    ["failed run", new Error("source failed")],
  ])(
    "releases a %s candidate without cancelling its active sibling",
    async (_label, failure) => {
      const now = new Date("2026-08-19T14:00:00.000Z");
      const repository = new InMemoryWatchRepository();
      for (const [index, id] of ["watch-a", "watch-b", "watch-c"].entries()) {
        await repository.createWatch(
          scheduledWatch({
            id,
            nextRunAt: new Date(now.getTime() - (3 - index) * 1_000),
          }),
        );
      }
      const harness = controlledScheduler(repository, now, 2);

      await harness.scheduler.tick(now);
      await waitFor(() => harness.pending.size === 2);
      harness.pending.get("watch-a")?.reject(failure);

      await waitFor(() => harness.pending.has("watch-c"));
      expect(harness.scheduler.status().activeWatchIds).toEqual([
        "watch-b",
        "watch-c",
      ]);
      expect(harness.maximumActive()).toBe(2);

      harness.pending.get("watch-b")?.resolve(undefined);
      harness.pending.get("watch-c")?.resolve(undefined);
      await waitFor(() => harness.scheduler.status().activeWatchCount === 0);
    },
  );

  it("stops admitting replacements and waits for active runs during shutdown", async () => {
    const now = new Date("2026-08-19T15:00:00.000Z");
    const repository = new InMemoryWatchRepository();
    await repository.createWatch(
      scheduledWatch({ id: "watch-a", nextRunAt: null }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-b",
        nextRunAt: new Date(now.getTime() - 1_000),
      }),
    );
    const harness = controlledScheduler(repository, now, 1);

    await harness.scheduler.tick(now);
    await waitFor(() => harness.pending.has("watch-a"));
    const shutdown = harness.scheduler.onApplicationShutdown();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(harness.execution.runWatch).toHaveBeenCalledTimes(1);

    harness.pending.get("watch-a")?.resolve(undefined);
    await shutdown;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.execution.runWatch).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.status()).toEqual(
      expect.objectContaining({ activeWatchCount: 0, activeWatchIds: [] }),
    );
  });

  it("bounds shutdown waiting and keeps active metrics accurate through late settlement", async () => {
    const now = new Date("2026-08-19T15:15:00.000Z");
    const repository = new InMemoryWatchRepository();
    await repository.createWatch(
      scheduledWatch({ id: "watch-a", nextRunAt: null }),
    );
    await repository.createWatch(
      scheduledWatch({
        id: "watch-b",
        nextRunAt: new Date(now.getTime() - 1_000),
      }),
    );
    const harness = controlledScheduler(repository, now, 1, 10);

    await harness.scheduler.tick(now);
    await waitFor(() => harness.pending.has("watch-a"));
    await harness.scheduler.onApplicationShutdown();

    expect(harness.execution.runWatch).toHaveBeenCalledTimes(1);
    expect(harness.scheduler.status()).toEqual(
      expect.objectContaining({
        activeWatchCount: 1,
        activeWatchIds: ["watch-a"],
      }),
    );
    await expect(harness.metrics.render()).resolves.toMatch(
      /ever_jobs_watcher_scheduler_active_runs 1\b/,
    );

    harness.pending.get("watch-a")?.resolve(undefined);
    await waitFor(() => harness.scheduler.status().activeWatchCount === 0);
    expect(harness.execution.runWatch).toHaveBeenCalledTimes(1);
    await expect(harness.metrics.render()).resolves.toMatch(
      /ever_jobs_watcher_scheduler_active_runs 0\b/,
    );
  });

  it("waits for an in-flight poll with no active watch runs during shutdown", async () => {
    const now = new Date("2026-08-19T15:30:00.000Z");
    const repository = new InMemoryWatchRepository();
    const digestCompletion = deferredValue<void>();
    const digest = {
      deliverDue: jest.fn(() => digestCompletion.promise),
    } as unknown as DailyDigestService;
    const scheduler = new WatcherSchedulerService(
      repository,
      { runWatch: jest.fn() } as unknown as WatchExecutionService,
      {
        processDue: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationDispatcher,
      digest,
      new WatcherMetricsService(),
      configService({
        "watcher.enabled": true,
        "watcher.maxConcurrentWatches": 2,
      }),
      { now: () => now, shutdownTimeoutMs: 5_000 },
    );

    const poll = scheduler.tick(now);
    await waitFor(
      () => (digest.deliverDue as jest.Mock).mock.calls.length === 1,
    );
    let shutdownSettled = false;
    const shutdown = scheduler.onApplicationShutdown().then(() => {
      shutdownSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(shutdownSettled).toBe(false);

    digestCompletion.resolve(undefined);
    await Promise.all([poll, shutdown]);
    expect(shutdownSettled).toBe(true);
  });

  it("waits for an in-flight notification retry pass during shutdown", async () => {
    const now = new Date("2026-08-19T15:45:00.000Z");
    const repository = new InMemoryWatchRepository();
    const retryCompletion = deferredValue<{
      processed: number;
      sent: number;
    }>();
    const notifications = {
      processDue: jest.fn(() => retryCompletion.promise),
    } as unknown as NotificationDispatcher;
    const scheduler = new WatcherSchedulerService(
      repository,
      { runWatch: jest.fn() } as unknown as WatchExecutionService,
      notifications,
      {
        deliverDue: jest.fn().mockResolvedValue(undefined),
      } as unknown as DailyDigestService,
      new WatcherMetricsService(),
      configService({
        "watcher.enabled": true,
        "watcher.maxConcurrentWatches": 2,
      }),
      { now: () => now, shutdownTimeoutMs: 5_000 },
    );

    await scheduler.tick(now);
    expect(notifications.processDue).toHaveBeenCalledTimes(1);

    let shutdownSettled = false;
    const shutdown = scheduler.onApplicationShutdown().then(() => {
      shutdownSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(shutdownSettled).toBe(false);

    retryCompletion.resolve({ processed: 0, sent: 0 });
    await shutdown;
    expect(shutdownSettled).toBe(true);
  });

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
      { now: () => executionNow },
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

    executionNow = new Date(startedAt.getTime() + 180_000);
    firstRun.resolve(sourceResult());
    await waitFor(() => scheduler.status().activeWatchIds.length === 0);
    expect(executor.execute).toHaveBeenCalledTimes(1);

    // Runtime completion advances the target from its actual completion time,
    // so the next cycle becomes due three minutes later rather than overlapping
    // or immediately catching up the same watch.
    executionNow = new Date(startedAt.getTime() + 360_000);
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
    intervalMinutes: 3,
    searchScope: {
      countryCodes: ["CA"],
      locations: ["Toronto"],
      searchTerms: ["software developer intern"],
    },
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

function controlledScheduler(
  repository: InMemoryWatchRepository,
  now: Date,
  maximum: number,
  shutdownTimeoutMs = 30_000,
): {
  scheduler: WatcherSchedulerService;
  execution: { runWatch: jest.Mock<Promise<WatchRun>, [string]> };
  metrics: WatcherMetricsService;
  pending: Map<string, ReturnType<typeof deferredValue<void>>>;
  maximumActive: () => number;
  setNow: (value: Date) => void;
} {
  const pending = new Map<string, ReturnType<typeof deferredValue<void>>>();
  let schedulerNow = now;
  let active = 0;
  let maximumActive = 0;
  const execution = {
    runWatch: jest.fn<Promise<WatchRun>, [string]>(async (watchId) => {
      await repository.updateWatch(watchId, {
        nextRunAt: new Date(now.getTime() + 3_600_000),
      });
      const completion = deferredValue<void>();
      pending.set(watchId, completion);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        await completion.promise;
        return {
          id: `run-${watchId}`,
          watchId,
          status: "completed",
        } as WatchRun;
      } finally {
        active -= 1;
      }
    }),
  };
  const notifications = {
    processDue: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationDispatcher;
  const digest = {
    deliverDue: jest.fn().mockResolvedValue(undefined),
  } as unknown as DailyDigestService;
  const metrics = new WatcherMetricsService();
  const scheduler = new WatcherSchedulerService(
    repository,
    execution as unknown as WatchExecutionService,
    notifications,
    digest,
    metrics,
    configService({
      "watcher.enabled": true,
      "watcher.maxConcurrentWatches": maximum,
      "watcher.schedulerPollMs": 15_000,
      "watcher.digestEnabled": false,
    }),
    { now: () => schedulerNow, shutdownTimeoutMs },
  );
  return {
    scheduler,
    execution,
    metrics,
    pending,
    maximumActive: () => maximumActive,
    setNow: (value) => {
      schedulerNow = value;
    },
  };
}

function deferredValue<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, resolve, reject };
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
