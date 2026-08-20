import { ConfigService } from "@nestjs/config";
import {
  WatcherMetricsService,
  WatcherSchedulerService,
  WatchRepository,
} from "@ever-jobs/watcher";
import { MetricsService } from "../../../api/src/metrics/metrics.service";
import { WatcherHealthController } from "../watcher-health.controller";

describe("WatcherHealthController", () => {
  it("renders application/source and watcher metrics through one endpoint", async () => {
    const repository = {
      healthCheck: jest.fn().mockResolvedValue(true),
      listWatches: jest.fn().mockResolvedValue([]),
    } as unknown as WatchRepository;
    const watcherMetrics = {
      syncTargetHealth: jest.fn(),
      syncCompanyCoverage: jest.fn(),
      render: jest.fn().mockResolvedValue("watcher_metric 2\n"),
    } as unknown as WatcherMetricsService;
    const applicationMetrics = {
      getMetrics: jest.fn().mockResolvedValue("application_metric 1\n"),
    } as unknown as MetricsService;
    const controller = makeController(
      repository,
      watcherMetrics,
      applicationMetrics,
    );

    await expect(controller.metricsText()).resolves.toBe(
      "application_metric 1\nwatcher_metric 2\n",
    );
    expect(watcherMetrics.syncTargetHealth).toHaveBeenCalledWith([]);
    expect(watcherMetrics.syncCompanyCoverage).toHaveBeenCalledWith([]);
  });

  it("reports Tier 1 degradation without making process health unavailable", async () => {
    const repository = {
      healthCheck: jest.fn().mockResolvedValue(true),
      listWatches: jest.fn().mockResolvedValue([
        {
          id: "watch-1",
          name: "Prestige internships",
          companies: ["Google"],
          sourceTargets: [
            {
              site: "google_careers",
              companyName: "Google",
              tier: 1,
              intervalMinutes: 3,
              enabled: true,
            },
          ],
          targetHealth: {
            google_careers: {
              targetKey: "google_careers",
              tier: 1,
              successCount: 0,
              hardFailureCount: 3,
              emptyRunCount: 0,
              partialRunCount: 0,
              consecutiveHardFailures: 3,
              degradedAt: new Date("2026-07-14T12:00:00.000Z"),
            },
          },
        },
      ]),
    } as unknown as WatchRepository;
    const watcherMetrics = {
      syncTargetHealth: jest.fn(),
      syncCompanyCoverage: jest.fn(),
      render: jest.fn(),
    } as unknown as WatcherMetricsService;
    const controller = makeController(repository, watcherMetrics, {
      getMetrics: jest.fn(),
    } as unknown as MetricsService);

    await expect(controller.health()).resolves.toEqual(
      expect.objectContaining({
        status: "healthy",
        scheduler: expect.objectContaining({
          maxConcurrentWatches: 2,
          activeWatchCount: 1,
          activeWatchIds: ["watch-1"],
        }),
        coverage: expect.objectContaining({
          status: "degraded",
          tier1Degraded: true,
          degradedTargets: [
            expect.objectContaining({
              watchId: "watch-1",
              targetKey: "google_careers",
              consecutiveHardFailures: 3,
            }),
          ],
        }),
      }),
    );
    expect(watcherMetrics.syncCompanyCoverage).toHaveBeenCalledWith([
      {
        watchId: "watch-1",
        counts: expect.objectContaining({
          configured: 1,
          active: 1,
          degraded: 1,
        }),
      },
    ]);
  });
});

function makeController(
  repository: WatchRepository,
  watcherMetrics: WatcherMetricsService,
  applicationMetrics: MetricsService,
): WatcherHealthController {
  const scheduler = {
    status: jest.fn(() => ({
      enabled: true,
      started: true,
      databaseHealthy: true,
      lastPollAt: new Date("2026-07-14T12:00:00.000Z"),
      lastError: null,
      maxConcurrentWatches: 2,
      activeWatchCount: 1,
      activeWatchIds: ["watch-1"],
    })),
  } as unknown as WatcherSchedulerService;
  const config = {
    get: jest.fn(() => undefined),
  } as unknown as ConfigService;
  return new WatcherHealthController(
    repository,
    scheduler,
    watcherMetrics,
    config,
    applicationMetrics,
  );
}
