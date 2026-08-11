import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { NotificationDispatcher } from "../services/notification-dispatcher.service";
import {
  selectNotificationDestinations,
  sourceTierForMatch,
} from "../services/notification-routing.service";
import {
  JobWatch,
  NotificationProvider,
  NotificationRoute,
  WatchMatch,
} from "../interfaces/watch.types";

describe("notification routing", () => {
  it("matches condition groups with AND semantics and inclusive score bounds", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      sourceTargets: [
        {
          site: "ashby",
          companySlug: "wealthsimple",
          tier: 1,
          intervalMinutes: 3,
          enabled: true,
        },
      ],
      notificationRoutes: [
        route("tier-one", "tier-one", {
          sourceTiers: [1, 2],
          notificationTypes: ["urgent"],
          minimumScore: 80,
          maximumScore: 80,
        }),
        route("wrong-type", "standard", {
          sourceTiers: [1],
          notificationTypes: ["standard"],
          minimumScore: 80,
        }),
      ],
    });
    const match = matchFixture({
      score: 80,
      sourceTargetKey: "ashby:wealthsimple",
    });

    expect(sourceTierForMatch(watch, match)).toBe(1);
    expect(selectNotificationDestinations(watch, match, "urgent")).toEqual([
      { type: "discord", destinationRef: "tier-one" },
    ]);
  });

  it("does not match a tier-restricted route when the source tier is unknown", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      sourceTargets: [],
      notificationRoutes: [
        route("tier-one", "tier-one", { sourceTiers: [1] }),
        route("catch-all", "fallback"),
      ],
    });
    const match = matchFixture({ sourceTargetKey: "unknown:target" });

    expect(sourceTierForMatch(watch, match)).toBeUndefined();
    expect(selectNotificationDestinations(watch, match, "standard")).toEqual([
      { type: "discord", destinationRef: "fallback" },
    ]);
  });

  it("deduplicates overlapping rules by provider and destination", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      notificationRoutes: [
        route("first", "primary", { minimumScore: 60 }),
        route("overlap", "primary", { maximumScore: 100 }),
        route("other", "secondary"),
      ],
    });

    expect(
      selectNotificationDestinations(
        watch,
        matchFixture({ score: 80 }),
        "urgent",
      ),
    ).toEqual([
      { type: "discord", destinationRef: "primary" },
      { type: "discord", destinationRef: "secondary" },
    ]);
  });

  it("uses legacy channels only when routes are absent or empty", async () => {
    const repository = new InMemoryWatchRepository();
    const legacy = [{ type: "discord" as const, destinationRef: "legacy" }];
    const withoutRoutes = await repository.createWatch({
      notificationChannels: legacy,
    });
    const withDisabledRoute = await repository.createWatch({
      notificationChannels: legacy,
      notificationRoutes: [
        { ...route("disabled", "disabled"), enabled: false },
      ],
    });

    expect(
      selectNotificationDestinations(
        withoutRoutes,
        matchFixture(),
        "standard",
      ),
    ).toEqual(legacy);
    expect(
      selectNotificationDestinations(
        withDisabledRoute,
        matchFixture(),
        "standard",
      ),
    ).toEqual([]);
  });

  it("suppresses an unmatched routed delivery without broadcasting legacy channels", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      notificationChannels: [
        { type: "discord", destinationRef: "legacy-broadcast" },
      ],
      notificationRoutes: [
        { ...route("disabled", "tier-one"), enabled: false },
      ],
    });
    const { job, match } = await persistedMessageParts(repository, watch);
    const provider = successfulProvider();
    const dispatcher = dispatcherFor(repository, provider);

    await expect(
      dispatcher.dispatch({
        idempotencyKey: "",
        type: "urgent",
        watch,
        job,
        match,
        detectedAt: job.firstSeenAt,
      }),
    ).resolves.toBe(0);

    expect(provider.send).not.toHaveBeenCalled();
    await expect(repository.listNotifications({})).resolves.toMatchObject({
      total: 0,
    });
    await expect(repository.getMatch(match.id)).resolves.toEqual(
      expect.objectContaining({
        notificationState: "suppressed",
        notificationSuppressionReason: "routing",
      }),
    );

    await repository.updateWatch(watch.id, {
      notificationRoutes: [route("new-route", "new-destination")],
    });
    const observedAgain = await repository.upsertMatch({
      ...match,
      notificationState: "pending",
      notificationSuppressionReason: null,
      lastMatchedAt: new Date("2026-08-04T12:03:00.000Z"),
    });
    expect(observedAgain).toEqual({
      isNew: false,
      match: expect.objectContaining({
        notificationState: "suppressed",
        notificationSuppressionReason: "routing",
      }),
    });
  });

  it("keeps route delivery idempotent across notification band changes", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      notificationRoutes: [route("primary", "primary")],
    });
    const { job, match } = await persistedMessageParts(repository, watch);
    const provider = successfulProvider();
    const dispatcher = dispatcherFor(repository, provider);
    const message = {
      idempotencyKey: "",
      watch,
      job,
      match,
      detectedAt: job.firstSeenAt,
    };

    await expect(
      dispatcher.dispatch({ ...message, type: "urgent" }),
    ).resolves.toBe(1);
    await expect(
      dispatcher.dispatch({ ...message, type: "standard" }),
    ).resolves.toBe(0);
    expect(provider.send).toHaveBeenCalledTimes(1);
    await expect(repository.listNotifications({})).resolves.toMatchObject({
      total: 1,
    });
  });
});

function route(
  id: string,
  destinationRef: string,
  conditions?: NotificationRoute["conditions"],
): NotificationRoute {
  return {
    id,
    name: id,
    enabled: true,
    provider: "discord",
    destinationRef,
    ...(conditions ? { conditions } : {}),
  };
}

function matchFixture(patch: Partial<WatchMatch> = {}): WatchMatch {
  const now = new Date("2026-08-04T12:00:00.000Z");
  return {
    id: "match-1",
    watchId: "watch-1",
    observedJobId: "job-1",
    score: 80,
    scoreBreakdown: scoreBreakdown(80),
    matchedTerms: ["intern"],
    status: "new",
    firstMatchedAt: now,
    lastMatchedAt: now,
    notificationState: "pending",
    notificationSuppressionReason: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

async function persistedMessageParts(
  repository: InMemoryWatchRepository,
  watch: JobWatch,
) {
  const now = new Date("2026-08-04T12:00:00.000Z");
  const observation = await repository.upsertObservedJob({
    fingerprint: `job-${watch.id}`,
    source: "google-careers",
    sourceTargetKey: "google-careers",
    title: "Software Engineer Intern",
    normalizedTitle: "software engineer intern",
    canonicalEpisodeKey: `episode-${watch.id}`,
    firstSeenAt: now,
    lastSeenAt: now,
  });
  const persisted = await repository.upsertMatch({
    ...matchFixture({
      watchId: watch.id,
      observedJobId: observation.job.id,
      canonicalEpisodeKey: `episode-${watch.id}`,
      sourceTargetKey: "google-careers",
    }),
  });
  return { job: observation.job, match: persisted.match };
}

function dispatcherFor(
  repository: InMemoryWatchRepository,
  provider: ReturnType<typeof successfulProvider>,
): NotificationDispatcher {
  const now = new Date("2026-08-04T12:00:00.000Z");
  return new NotificationDispatcher(
    repository,
    [provider as NotificationProvider],
    {
      ownerId: "routing-test",
      maxAttempts: 3,
      claimTtlMs: 30_000,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 10_000,
      now: () => now,
      random: () => 0,
    },
  );
}

function successfulProvider() {
  return {
    type: "discord",
    send: jest.fn(async () => ({
      status: "sent" as const,
      providerResponse: { category: "success", retryable: false, status: 204 },
    })),
  };
}

function scoreBreakdown(total: number) {
  return {
    total,
    role: 30,
    internship: 25,
    location: 15,
    company: 0,
    source: 10,
    skills: 0,
    matchedKeywords: ["intern"],
    missingRequired: [],
    reasons: ["Internship match"],
  };
}
