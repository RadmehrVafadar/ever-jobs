import { InMemoryWatchRepository } from "../in-memory-watch.repository";

describe("InMemoryWatchRepository contract", () => {
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
