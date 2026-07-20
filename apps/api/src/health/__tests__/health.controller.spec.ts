import { ConfigService } from "@nestjs/config";
import { WatchRepository } from "@ever-jobs/watcher";
import { HealthController } from "../health.controller";

describe("HealthController watcher coverage", () => {
  it("exposes durable Tier 1 degradation without failing API liveness", async () => {
    const repository = {
      listWatches: jest.fn().mockResolvedValue([
        {
          id: "watch-1",
          sourceTargets: [
            {
              site: "google_careers",
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
            },
          },
        },
      ]),
    } as unknown as WatchRepository;
    const config = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
    } as unknown as ConfigService;
    const controller = new HealthController(config, repository);

    await expect(controller.health()).resolves.toEqual(
      expect.objectContaining({
        status: "healthy",
        watcherCoverage: expect.objectContaining({
          status: "degraded",
          tier1Degraded: true,
          watches: [
            expect.objectContaining({
              watchId: "watch-1",
              tier1Degraded: true,
            }),
          ],
        }),
      }),
    );
  });
});
