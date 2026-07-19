import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import {
  JobWatch,
  ObservedJob,
  WatchValidationService,
  WatchRepository,
} from "@ever-jobs/watcher";
import { ADMIN_AUTH_METADATA_KEY } from "../../auth/admin-auth.decorator";
import {
  NotificationsController,
  ObservedJobsController,
  WatchesController,
} from "../watches.controller";

describe("watcher management controllers", () => {
  let repository: jest.Mocked<WatchRepository>;
  let execution: { runWatch: jest.Mock };
  let controller: WatchesController;

  beforeEach(() => {
    repository = {
      getWatch: jest.fn(),
      createWatch: jest.fn(),
      updateWatch: jest.fn(),
      deleteWatch: jest.fn(),
      listWatches: jest.fn(),
      getMatch: jest.fn(),
      updateMatch: jest.fn(),
      listRuns: jest.fn(),
      getRun: jest.fn(),
      listMatches: jest.fn(),
      listObservedJobs: jest.fn(),
      getObservedJob: jest.fn(),
      listNotifications: jest.fn(),
      getNotification: jest.fn(),
    } as unknown as jest.Mocked<WatchRepository>;
    execution = { runWatch: jest.fn() };
    controller = new WatchesController(
      repository,
      execution as never,
      new WatchValidationService(),
    );
  });

  it("marks every watcher management controller as admin-only", () => {
    expect(
      Reflect.getMetadata(ADMIN_AUTH_METADATA_KEY, WatchesController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ADMIN_AUTH_METADATA_KEY, ObservedJobsController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ADMIN_AUTH_METADATA_KEY, NotificationsController),
    ).toBe(true);
  });

  it("validates watch creation and removes runtime lease fields from output", async () => {
    const watch = watchFixture({
      leaseOwnerId: "worker-1",
      leaseToken: "secret-lease-token",
      leaseExpiresAt: new Date(),
    });
    repository.createWatch.mockResolvedValue(watch);

    const result = await controller.create({
      name: "Internships",
      notificationChannels: [{ type: "discord", destinationRef: "default" }],
    });

    expect(repository.createWatch).toHaveBeenCalledWith({
      name: "Internships",
      notificationChannels: [{ type: "discord", destinationRef: "default" }],
    });
    expect(result).not.toHaveProperty("leaseOwnerId");
    expect(result).not.toHaveProperty("leaseToken");
    expect(JSON.stringify(result)).not.toContain("secret-lease-token");
  });

  it("baselines an uninitialized manual run and never passes notify-all", async () => {
    repository.getWatch.mockResolvedValue(
      watchFixture({ initializedAt: null }),
    );
    execution.runWatch.mockResolvedValue({ id: "run-1" });

    await controller.run("watch-1");

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "baseline");
    expect(execution.runWatch).not.toHaveBeenCalledWith(
      "watch-1",
      "notify-all",
    );
  });

  it("uses recent-only safety for an initialized manual run", async () => {
    repository.getWatch.mockResolvedValue(
      watchFixture({ initializedAt: new Date("2026-07-14T12:00:00Z") }),
    );
    execution.runWatch.mockResolvedValue({ id: "run-1" });

    await controller.run("watch-1");

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "recent-only");
  });

  it("always uses baseline for explicit initialization", async () => {
    repository.getWatch.mockResolvedValue(watchFixture());
    execution.runWatch.mockResolvedValue({ id: "run-1" });

    await controller.initialize("watch-1", {});

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "baseline", {
      trigger: "initialize",
      forceSources: true,
    });
  });

  it("validates selected targets before initialization", async () => {
    repository.getWatch.mockResolvedValue(
      watchFixture({
        sourceTargets: [
          {
            site: "ashby",
            companySlug: "wealthsimple",
            tier: 1,
            intervalMinutes: 3,
            enabled: true,
          },
          {
            site: "google_careers",
            tier: 1,
            intervalMinutes: 3,
            enabled: false,
          },
        ],
      }),
    );
    execution.runWatch.mockResolvedValue({ id: "run-1" });

    await controller.initialize("watch-1", {
      targetKeys: ["ashby:wealthsimple"],
    });

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "baseline", {
      trigger: "initialize",
      forceSources: true,
      targetKeys: ["ashby:wealthsimple"],
    });
    await expect(
      controller.initialize("watch-1", {
        targetKeys: ["google_careers"],
      }),
    ).rejects.toThrow("disabled");
    expect(execution.runWatch).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when deleting an unknown watch", async () => {
    repository.deleteWatch.mockResolvedValue(false);
    await expect(controller.remove("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("updates match workflow status only when it belongs to the watch", async () => {
    const watch = watchFixture();
    const match = {
      id: "match-1",
      watchId: watch.id,
      status: "new",
    };
    repository.getWatch.mockResolvedValue(watch);
    repository.getMatch.mockResolvedValue(match as never);
    repository.updateMatch.mockResolvedValue({
      ...match,
      status: "applied",
    } as never);

    await controller.updateMatchStatus(watch.id, match.id, {
      status: "applied",
    });

    expect(repository.updateMatch).toHaveBeenCalledWith(match.id, {
      status: "applied",
    });
  });

  it("does not expose raw observed payloads", async () => {
    const job = observedJobFixture();
    repository.getObservedJob.mockResolvedValue(job);
    const observedController = new ObservedJobsController(repository);

    const result = await observedController.get(job.id);

    expect(result).not.toHaveProperty("rawPayload");
    expect(JSON.stringify(result)).not.toContain("source-secret");
  });

  it("uses the configured watch for a non-persistent Discord test", async () => {
    const watch = watchFixture();
    repository.getWatch.mockResolvedValue(watch);
    const discord = {
      send: jest.fn().mockResolvedValue({ status: "sent" }),
    };
    const notifications = new NotificationsController(
      repository,
      discord as never,
    );

    const result = await notifications.testDiscord({
      watchId: watch.id,
      destinationRef: "default",
    });

    expect(result).toEqual({ ok: true, result: { status: "sent" } });
    expect(discord.send).toHaveBeenCalledWith(
      expect.objectContaining({
        watch,
        job: expect.objectContaining({ title: "Discord notification test" }),
      }),
      { type: "discord", destinationRef: "default" },
    );
  });

  it("removes internal claims and legacy secret-bearing idempotency keys", async () => {
    repository.getNotification.mockResolvedValue({
      id: "delivery-1",
      idempotencyKey:
        "watch:job:discord:https://discord.com/api/webhooks/1/secret",
      claimOwnerId: "worker-1",
      claimToken: "claim-secret",
      errorMessage:
        "request failed at https://discord.com/api/webhooks/1/secret",
    } as never);
    const notifications = new NotificationsController(repository, {
      send: jest.fn(),
    } as never);

    const result = await notifications.delivery("delivery-1");

    expect(result).not.toHaveProperty("idempotencyKey");
    expect(result).not.toHaveProperty("claimOwnerId");
    expect(result).not.toHaveProperty("claimToken");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.errorMessage).toBe("request failed at [redacted-url]");
  });
});

function watchFixture(patch: Partial<JobWatch> = {}): JobWatch {
  const now = new Date("2026-07-14T12:00:00Z");
  return {
    id: "watch-1",
    name: "Internships",
    enabled: false,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [],
    sourceTiers: {},
    sourceTargets: [],
    companySlugs: [],
    companies: [],
    searchTerms: ["software intern"],
    requiredTerms: [],
    preferredTerms: [],
    excludedTerms: [],
    locations: ["Toronto"],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [{ type: "discord", destinationRef: "default" }],
    initializationMode: "baseline",
    initializedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function observedJobFixture(): ObservedJob {
  const now = new Date("2026-07-14T12:00:00Z");
  return {
    id: "job-1",
    fingerprint: "fingerprint",
    source: "test",
    title: "Software Intern",
    normalizedTitle: "software intern",
    firstSeenAt: now,
    lastSeenAt: now,
    rawPayload: { token: "source-secret" },
    createdAt: now,
    updatedAt: now,
  };
}
