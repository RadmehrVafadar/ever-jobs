import { ConfigService } from "@nestjs/config";
import { INotificationSecretStore } from "@ever-jobs/plugin";
import { JobWatch, WatchRepository } from "@ever-jobs/watcher";
import {
  OperatorOverviewService,
  WorkerHealthClient,
} from "../operator-overview.service";

describe("OperatorOverviewService", () => {
  const watch = {
    id: "watch-1",
    enabled: true,
    sourceTargets: [
      { site: "greenhouse", companySlug: "acme", enabled: true, tier: 1 },
    ],
    targetHealth: {
      "greenhouse:acme": {
        targetKey: "greenhouse:acme",
        tier: 1,
        consecutiveHardFailures: 3,
      },
    },
  } as unknown as JobWatch;

  function build(
    workerState: "healthy" | "unhealthy" | "unavailable" = "healthy",
    databaseHealthy = true,
  ) {
    const repository = {
      healthCheck: jest.fn().mockResolvedValue(databaseHealthy),
      listWatches: jest.fn().mockResolvedValue([watch]),
      listMatches: jest.fn().mockResolvedValue({ total: 4 }),
      listNotifications: jest.fn().mockResolvedValue({ total: 2 }),
    } as unknown as WatchRepository;
    const secrets = {
      list: jest.fn().mockResolvedValue([
        {
          destinationRef: "tier-one",
          environmentVariable: "DISCORD_WEBHOOK_TIER_ONE",
          configured: true,
          source: "local",
          readOnly: false,
        },
      ]),
    } as unknown as INotificationSecretStore;
    const worker = {
      get: workerState === "unavailable"
        ? jest.fn().mockRejectedValue(new Error("offline"))
        : jest.fn().mockResolvedValue({
            data: {
              status: workerState,
              timestamp: "2026-08-04T12:00:00.000Z",
              scheduler: {
                enabled: true,
                started: true,
                databaseHealthy: workerState === "healthy",
                lastPollAt: "2026-08-04T12:00:00.000Z",
                lastError:
                  workerState === "healthy" ? null : "database unavailable",
              },
            },
          }),
    } as WorkerHealthClient;
    return new OperatorOverviewService(
      new ConfigService({
        watcher: { healthUrl: "http://127.0.0.1:3002/health" },
      }),
      repository,
      secrets,
      worker,
    );
  }

  it("aggregates durable counts, routing readiness, and Tier 1 degradation", async () => {
    await expect(build().getOverview()).resolves.toMatchObject({
      status: "degraded",
      database: { status: "healthy" },
      worker: {
        status: "healthy",
        lastSeenAt: "2026-08-04T12:00:00.000Z",
      },
      scheduler: { status: "healthy", enabled: true },
      notifications: { status: "configured", discordConfigured: true },
      sourceCoverage: {
        status: "degraded",
        configured: 1,
        degraded: 1,
        tier1Degraded: true,
      },
      counts: {
        watches: 1,
        activeWatches: 1,
        recentMatches: 4,
        failedDeliveries: 2,
      },
    });
  });

  it("reports an interrupted worker without making the API unavailable", async () => {
    await expect(build("unavailable").getOverview()).resolves.toMatchObject({
      status: "degraded",
      worker: { status: "unavailable", lastSeenAt: null },
      scheduler: { status: "unavailable" },
    });
  });

  it("distinguishes a connected unhealthy worker from an unavailable worker", async () => {
    await expect(build("unhealthy").getOverview()).resolves.toMatchObject({
      status: "degraded",
      worker: {
        status: "unhealthy",
        lastSeenAt: "2026-08-04T12:00:00.000Z",
      },
      scheduler: { status: "unhealthy" },
    });
  });

  it("returns a usable degraded overview when the database is unhealthy", async () => {
    await expect(build("healthy", false).getOverview()).resolves.toMatchObject({
      status: "unhealthy",
      database: { status: "unhealthy" },
      sourceCoverage: {
        status: "unavailable",
        configured: 0,
        degraded: 0,
        tier1Degraded: false,
      },
      counts: {
        watches: 0,
        activeWatches: 0,
        recentMatches: 0,
        failedDeliveries: 0,
      },
    });
  });
});
