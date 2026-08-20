import { InMemoryWatchRepository } from "../in-memory-watch.repository";

describe("InMemoryWatchRepository contract", () => {
  it("orders due watches null-first and then by due time, creation time, and id", async () => {
    const repository = new InMemoryWatchRepository();
    const now = new Date("2026-08-19T12:00:00.000Z");
    const earlierCreation = new Date("2026-08-01T00:00:00.000Z");
    const laterCreation = new Date("2026-08-02T00:00:00.000Z");
    const inputs = [
      {
        id: "scheduled-later",
        nextRunAt: new Date(now.getTime() - 1_000),
        createdAt: earlierCreation,
      },
      { id: "null-b", nextRunAt: null, createdAt: laterCreation },
      {
        id: "scheduled-b",
        nextRunAt: new Date(now.getTime() - 2_000),
        createdAt: laterCreation,
      },
      { id: "null-a", nextRunAt: null, createdAt: laterCreation },
      { id: "null-oldest", nextRunAt: null, createdAt: earlierCreation },
      {
        id: "scheduled-a",
        nextRunAt: new Date(now.getTime() - 2_000),
        createdAt: laterCreation,
      },
    ];
    for (const input of inputs) {
      await repository.createWatch({ ...input, enabled: true });
    }

    const due = await repository.listDueWatches(now, 20);
    expect(due.map(({ id }) => id)).toEqual([
      "null-oldest",
      "null-a",
      "null-b",
      "scheduled-a",
      "scheduled-b",
      "scheduled-later",
    ]);
  });

  it("allows explicit initialization of a disabled watch but never schedules it", async () => {
    const repository = new InMemoryWatchRepository();
    const now = new Date("2026-07-14T12:00:00.000Z");
    const watch = await repository.createWatch({
      id: "disabled-watch",
      enabled: false,
      nextRunAt: now,
    });

    await expect(repository.listDueWatches(now, 10)).resolves.toEqual([]);
    await expect(
      repository.tryAcquireWatchLease({
        watchId: watch.id,
        ownerId: "initializer",
        token: "initialization-lease",
        now,
        expiresAt: new Date(now.getTime() + 120_000),
        nextRunAt: new Date(now.getTime() + 180_000),
        requireDue: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        watchId: watch.id,
        ownerId: "initializer",
      }),
    );
  });

  it("prevents overlapping leases and rejects stale releases", async () => {
    const repository = new InMemoryWatchRepository();
    const now = new Date("2026-07-14T12:00:00.000Z");
    const watch = await repository.createWatch({
      id: "watch-1",
      nextRunAt: now,
    });
    const leaseInput = {
      watchId: watch.id,
      ownerId: "worker-a",
      token: "lease-a",
      now,
      expiresAt: new Date(now.getTime() + 120_000),
      nextRunAt: new Date(now.getTime() + 180_000),
      requireDue: false,
    };

    await expect(
      repository.tryAcquireWatchLease(leaseInput),
    ).resolves.not.toBeNull();
    await expect(
      repository.tryAcquireWatchLease({
        ...leaseInput,
        ownerId: "worker-b",
        token: "lease-b",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.releaseWatchLease({
        watchId: watch.id,
        ownerId: "worker-a",
        token: "stale-token",
      }),
    ).resolves.toBe(false);
    await expect(
      repository.releaseWatchLease({
        watchId: watch.id,
        ownerId: "worker-a",
        token: "lease-a",
      }),
    ).resolves.toBe(true);
  });

  it("updates a watch only when its expected revision is current", async () => {
    const repository = new InMemoryWatchRepository();
    const originalUpdatedAt = new Date("2026-08-04T12:00:00.000Z");
    const watch = await repository.createWatch({
      id: "cas-watch",
      name: "Original",
      updatedAt: originalUpdatedAt,
      notificationRoutes: [],
    });

    await expect(
      repository.updateWatchIfCurrent(watch.id, originalUpdatedAt, {
        name: "Applied",
      }),
    ).resolves.toEqual(expect.objectContaining({ name: "Applied" }));
    await expect(
      repository.updateWatchIfCurrent(watch.id, originalUpdatedAt, {
        name: "Stale overwrite",
      }),
    ).resolves.toBeNull();
    await expect(repository.getWatch(watch.id)).resolves.toEqual(
      expect.objectContaining({ name: "Applied" }),
    );
  });

  it("deduplicates delivery intents and applies a claimed delivery result once", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({ id: "watch-1" });
    const observed = await repository.upsertObservedJob({
      fingerprint: "fingerprint-1",
      source: "fake",
      title: "Software Engineer Intern",
      normalizedTitle: "software engineer intern",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    const match = await repository.upsertMatch({
      watchId: watch.id,
      observedJobId: observed.job.id,
      score: 90,
      scoreBreakdown: scoreBreakdown(90),
      matchedTerms: ["software internship"],
      status: "new",
      firstMatchedAt: new Date(),
      lastMatchedAt: new Date(),
      notificationState: "pending",
    });
    const intent = {
      idempotencyKey: "watch-1:job-1:urgent:discord-primary",
      watchMatchId: match.match.id,
      notificationType: "urgent" as const,
      channel: "discord",
      provider: "discord",
      destinationRef: "discord-primary",
    };

    const first = await repository.enqueueNotification(intent);
    const duplicate = await repository.enqueueNotification(intent);
    expect(first.isNew).toBe(true);
    expect(duplicate).toEqual({ delivery: first.delivery, isNew: false });

    const now = new Date();
    const claimed = await repository.claimNotification({
      deliveryId: first.delivery.id,
      ownerId: "worker-a",
      token: "claim-a",
      now,
      expiresAt: new Date(now.getTime() + 30_000),
      maxAttempts: 3,
    });
    expect(claimed?.claimToken).toBe("claim-a");

    const sent = await repository.updateNotification(
      first.delivery.id,
      "claim-a",
      { status: "sent", incrementAttempt: true },
    );
    expect(sent).toEqual(
      expect.objectContaining({
        status: "sent",
        attemptCount: 1,
        claimToken: null,
      }),
    );
    await expect(
      repository.updateNotification(first.delivery.id, "claim-a", {
        status: "sent",
      }),
    ).rejects.toThrow("Notification claim is not active");
  });

  it("reuses a persisted observation anchor for 14 days without calendar-boundary splits", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({ id: "anchored-watch" });
    const start = new Date("2026-07-13T23:59:59.000Z");
    const withinWindow = new Date("2026-07-27T23:59:58.000Z");
    const afterWindow = new Date("2026-07-28T00:00:00.000Z");
    const persist = (fingerprint: string, episode: string, seenAt: Date) =>
      repository.persistObservationAndMatch({
        observedJob: {
          fingerprint,
          source: fingerprint,
          title: "Software Engineer Intern",
          normalizedTitle: "software engineer intern",
          canonicalKey: "canonical-core",
          canonicalEpisodeKey: episode,
          canonicalEpisodeStartedAt: seenAt,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
        },
        canonicalEpisodeAnchorWindowMs: 14 * 24 * 60 * 60 * 1_000,
        match: {
          watchId: watch.id,
          canonicalEpisodeKey: episode,
          score: 90,
          scoreBreakdown: scoreBreakdown(90),
          matchedTerms: ["software internship"],
          status: "new",
          firstMatchedAt: seenAt,
          lastMatchedAt: seenAt,
          notificationState: "pending",
        },
      });

    const first = await persist("source-a", "episode-a", start);
    const second = await persist(
      "source-b",
      "would-cross-calendar-bucket",
      withinWindow,
    );
    // The upstream source identity remains stable across the repost. The
    // repository must preserve the first episode's observation and allocate
    // an episode-scoped observation for the new canonical match.
    const third = await persist("source-a", "episode-c", afterWindow);

    expect(second.job.canonicalEpisodeKey).toBe("episode-a");
    expect(second.job.canonicalEpisodeStartedAt).toEqual(start);
    expect(second.match.id).toBe(first.match.id);
    expect(second.isNewMatch).toBe(false);
    expect(third.job.canonicalEpisodeKey).toBe("episode-c");
    expect(third.job.id).not.toBe(first.job.id);
    expect(third.job.fingerprint).not.toBe(first.job.fingerprint);
    expect(third.isNewMatch).toBe(true);
    expect(third.match.id).not.toBe(first.match.id);
  });
});

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
