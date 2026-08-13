import { ConflictException } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import {
  JobWatch,
  WatchRepository,
  WatchValidationService,
} from "@ever-jobs/watcher";
import { WatchApplyService } from "../watch-apply.service";

describe("WatchApplyService", () => {
  let repository: jest.Mocked<WatchRepository>;
  let service: WatchApplyService;

  beforeEach(() => {
    repository = {
      getWatch: jest.fn(),
      updateWatchIfCurrent: jest.fn(),
    } as unknown as jest.Mocked<WatchRepository>;
    service = new WatchApplyService(repository, new WatchValidationService());
  });

  it("applies metadata and routing changes without pausing or rebaselining", async () => {
    const current = watchFixture({ enabled: true });
    const updated = watchFixture({
      enabled: true,
      name: "Renamed",
      notificationRoutes: [
        {
          id: "tier-one",
          name: "Tier one",
          enabled: true,
          provider: "discord",
          destinationRef: "tier-one",
        },
      ],
      updatedAt: new Date("2026-08-04T12:01:00.000Z"),
    });
    repository.getWatch.mockResolvedValue(current);
    repository.updateWatchIfCurrent.mockResolvedValue(updated);

    const result = await service.apply(current.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      patch: {
        name: "Renamed",
        notificationRoutes: updated.notificationRoutes,
      },
    });

    expect(repository.updateWatchIfCurrent).toHaveBeenCalledWith(
      current.id,
      current.updatedAt,
      {
        name: "Renamed",
        notificationRoutes: updated.notificationRoutes,
      },
    );
    expect(result.behaviorChanged).toBe(false);
    expect(result.paused).toBe(false);
    expect(result.targetKeysRequiringInitialization).toEqual([]);
    expect(result.diff.map(({ classification }) => classification)).toEqual([
      "metadata",
      "routing",
    ]);
  });

  it("atomically pauses behavior changes and invalidates enabled targets", async () => {
    const initializedAt = new Date("2026-08-04T11:00:00.000Z");
    const current = watchFixture({ enabled: true, initializedAt });
    repository.getWatch.mockResolvedValue(current);
    repository.updateWatchIfCurrent.mockImplementation(
      async (_id, _expected, patch) =>
        watchFixture({
          ...patch,
          updatedAt: new Date("2026-08-04T12:01:00.000Z"),
        }),
    );

    const result = await service.apply(current.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      patch: { locations: ["Ottawa"] },
    });

    expect(repository.updateWatchIfCurrent).toHaveBeenCalledWith(
      current.id,
      current.updatedAt,
      expect.objectContaining({
        locations: ["Ottawa"],
        enabled: false,
        initializedAt: null,
        nextRunAt: null,
        sourceTargets: [
          expect.objectContaining({
            site: Site.ASHBY,
            initializedAt: null,
            nextRunAt: null,
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      changed: true,
      behaviorChanged: true,
      paused: true,
      pausedByApply: true,
      resumeRequired: true,
      targetKeysRequiringInitialization: ["ashby:acme"],
    });
  });

  it("treats role-family changes as baseline-requiring behavior", async () => {
    const initializedAt = new Date("2026-08-04T11:00:00.000Z");
    const current = watchFixture({ enabled: true, initializedAt });
    repository.getWatch.mockResolvedValue(current);
    repository.updateWatchIfCurrent.mockImplementation(
      async (_id, _expected, patch) => watchFixture(patch),
    );

    const result = await service.apply(current.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      patch: {
        roleFamilies: [...current.roleFamilies, "technology-risk-it-audit"],
      },
    });

    expect(result.diff).toEqual([
      expect.objectContaining({
        field: "roleFamilies",
        classification: "behavior",
      }),
    ]);
    expect(repository.updateWatchIfCurrent).toHaveBeenCalledWith(
      current.id,
      current.updatedAt,
      expect.objectContaining({
        enabled: false,
        initializedAt: null,
        roleFamilies: expect.arrayContaining(["technology-risk-it-audit"]),
      }),
    );
    expect(result.targetKeysRequiringInitialization).toEqual(["ashby:acme"]);
  });

  it("returns 409 before validation when the draft timestamp is stale", async () => {
    const current = watchFixture();
    repository.getWatch.mockResolvedValue(current);

    await expect(
      service.apply(current.id, {
        expectedUpdatedAt: "2026-08-04T11:59:00.000Z",
        patch: { name: "Stale" },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "WATCH_STALE_UPDATE",
        currentUpdatedAt: current.updatedAt.toISOString(),
      }),
    });
    expect(repository.updateWatchIfCurrent).not.toHaveBeenCalled();
  });

  it("returns 409 when the repository CAS loses a race", async () => {
    const current = watchFixture();
    const latest = watchFixture({
      updatedAt: new Date("2026-08-04T12:02:00.000Z"),
    });
    repository.getWatch
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(latest);
    repository.updateWatchIfCurrent.mockResolvedValue(null);

    await expect(
      service.apply(current.id, {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        patch: { name: "Racing update" },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not write an unchanged draft", async () => {
    const current = watchFixture();
    repository.getWatch.mockResolvedValue(current);

    const result = await service.apply(current.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      patch: { name: current.name },
    });

    expect(result.changed).toBe(false);
    expect(repository.updateWatchIfCurrent).not.toHaveBeenCalled();
  });

  it("rejects execution-state changes so apply cannot bypass explicit resume", async () => {
    const current = watchFixture();
    repository.getWatch.mockResolvedValue(current);

    await expect(
      service.apply(current.id, {
        expectedUpdatedAt: current.updatedAt.toISOString(),
        patch: { enabled: true },
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "WATCH_ENABLED_REQUIRES_EXPLICIT_ACTION",
      }),
    });
    expect(repository.updateWatchIfCurrent).not.toHaveBeenCalled();
  });

  it("never echoes deprecated webhook fields from a legacy watch in the apply diff", async () => {
    const webhook =
      "https://discord.com/api/webhooks/123456789012345678/super-secret-token";
    const current = watchFixture({
      notificationChannels: [
        {
          type: "discord",
          destinationRef: webhook,
          destination: webhook,
          secretRef: webhook,
        },
      ],
    });
    const updated = watchFixture({
      notificationChannels: [{ type: "discord", destinationRef: "default" }],
      updatedAt: new Date("2026-08-04T12:01:00.000Z"),
    });
    repository.getWatch.mockResolvedValue(current);
    repository.updateWatchIfCurrent.mockResolvedValue(updated);

    const result = await service.apply(current.id, {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      patch: {
        notificationChannels: [{ type: "discord", destinationRef: "default" }],
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(webhook);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("secretRef");
    expect(serialized).not.toContain('"destination"');
    expect(serialized).toContain("[redacted-destination]");
  });
});

function watchFixture(patch: Partial<JobWatch> = {}): JobWatch {
  const now = new Date("2026-08-04T12:00:00.000Z");
  return {
    id: "watch-1",
    name: "Internships",
    enabled: false,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [Site.ASHBY],
    sourceTiers: { [Site.ASHBY]: 1 },
    sourceTargets: [
      {
        site: Site.ASHBY,
        companySlug: "acme",
        tier: 1,
        intervalMinutes: 3,
        enabled: true,
        initializedAt: now,
        nextRunAt: now,
      },
    ],
    companySlugs: ["acme"],
    companies: ["Acme"],
    searchTerms: ["software intern"],
    roleFamilies: [
      "software-engineering",
      "data-ai",
      "cybersecurity",
      "cloud-platform-infrastructure",
    ],
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
    notificationRoutes: [],
    initializationMode: "baseline",
    initializedAt: now,
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
