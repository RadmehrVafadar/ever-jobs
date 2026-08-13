import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import {
  AcquireWatchLeaseInput,
  ClaimNotificationDeliveryInput,
  CreateNotificationDeliveryInput,
  JobWatch,
  NotificationDelivery,
  NotificationDeliveryQuery,
  ObservedJob,
  ObservedJobInput,
  ObservedJobQuery,
  Page,
  PageRequest,
  PersistObservationAndMatchInput,
  PersistObservationAndMatchResult,
  RecordNotificationInput,
  ReleaseWatchLeaseInput,
  RenewWatchLeaseInput,
  UpdateNotificationDeliveryInput,
  WatchLease,
  WatchMatch,
  WatchMatchInput,
  WatchMatchQuery,
  WatchRepository,
  WatchRun,
  WatchRunQuery,
} from "../interfaces/watch.types";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Deterministic test repository. Production modules must bind
 * PrismaWatchRepository so state survives process restarts.
 */
@Injectable()
export class InMemoryWatchRepository implements WatchRepository {
  private readonly watches = new Map<string, JobWatch>();
  private readonly jobs = new Map<string, ObservedJob>();
  private readonly matches = new Map<string, WatchMatch>();
  private readonly runs = new Map<string, WatchRun>();
  private readonly notifications = new Map<string, NotificationDelivery>();

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async listWatches(): Promise<JobWatch[]> {
    return [...this.watches.values()];
  }

  async listDueWatches(now: Date, limit: number): Promise<JobWatch[]> {
    return [...this.watches.values()]
      .filter(
        (watch) =>
          watch.enabled &&
          (!watch.nextRunAt || watch.nextRunAt <= now) &&
          (!watch.leaseExpiresAt || watch.leaseExpiresAt <= now),
      )
      .sort(
        (left, right) =>
          (left.nextRunAt?.getTime() ?? 0) - (right.nextRunAt?.getTime() ?? 0),
      )
      .slice(0, clampLimit(limit));
  }

  async tryAcquireWatchLease(
    input: AcquireWatchLeaseInput,
  ): Promise<WatchLease | null> {
    const watch = this.watches.get(input.watchId);
    const due = !watch?.nextRunAt || watch.nextRunAt <= input.now;
    const leaseAvailable =
      !watch?.leaseExpiresAt || watch.leaseExpiresAt <= input.now;
    if (
      !watch ||
      (!watch?.enabled && input.requireDue !== false) ||
      !leaseAvailable ||
      (input.requireDue !== false && !due)
    ) {
      return null;
    }
    this.watches.set(watch.id, {
      ...watch,
      leaseOwnerId: input.ownerId,
      leaseToken: input.token,
      leaseExpiresAt: input.expiresAt,
      nextRunAt: input.nextRunAt,
      updatedAt: new Date(),
    });
    return {
      watchId: input.watchId,
      ownerId: input.ownerId,
      token: input.token,
      expiresAt: input.expiresAt,
    };
  }

  async renewWatchLease(
    input: RenewWatchLeaseInput,
  ): Promise<WatchLease | null> {
    const watch = this.watches.get(input.watchId);
    if (
      !watch ||
      watch.leaseOwnerId !== input.ownerId ||
      watch.leaseToken !== input.token ||
      !watch.leaseExpiresAt ||
      watch.leaseExpiresAt <= input.now
    ) {
      return null;
    }
    this.watches.set(watch.id, {
      ...watch,
      leaseExpiresAt: input.expiresAt,
      updatedAt: new Date(),
    });
    return {
      watchId: input.watchId,
      ownerId: input.ownerId,
      token: input.token,
      expiresAt: input.expiresAt,
    };
  }

  async releaseWatchLease(input: ReleaseWatchLeaseInput): Promise<boolean> {
    const watch = this.watches.get(input.watchId);
    if (
      !watch ||
      watch.leaseOwnerId !== input.ownerId ||
      watch.leaseToken !== input.token
    ) {
      return false;
    }
    this.watches.set(watch.id, {
      ...watch,
      leaseOwnerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    });
    return true;
  }

  async getWatch(id: string): Promise<JobWatch | null> {
    return this.watches.get(id) ?? null;
  }

  async createWatch(input: Partial<JobWatch>): Promise<JobWatch> {
    const now = new Date();
    const watch: JobWatch = {
      id: input.id ?? randomUUID(),
      name: input.name ?? "Untitled watch",
      enabled: input.enabled ?? true,
      description: input.description,
      schedule: input.schedule,
      intervalMinutes: input.intervalMinutes ?? 3,
      timezone: input.timezone ?? "America/Toronto",
      sources: input.sources ?? [],
      sourceTiers: input.sourceTiers ?? {},
      sourceTargets: input.sourceTargets ?? [],
      targetHealth: input.targetHealth ?? {},
      companySlugs: input.companySlugs ?? [],
      companies: input.companies ?? [],
      searchTerms: input.searchTerms ?? [],
      requiredTerms: input.requiredTerms ?? [],
      preferredTerms: input.preferredTerms ?? [],
      excludedTerms: input.excludedTerms ?? [],
      locations: input.locations ?? [],
      countryCodes: input.countryCodes ?? ["CA"],
      allowedWorkplaceTypes: input.allowedWorkplaceTypes ?? [
        "remote",
        "hybrid",
        "on-site",
      ],
      allowedEmploymentTypes: input.allowedEmploymentTypes ?? [
        "internship",
        "co-op",
      ],
      minimumScore: input.minimumScore ?? 60,
      urgentScore: input.urgentScore ?? 80,
      digestScore: input.digestScore ?? 40,
      notificationChannels: input.notificationChannels ?? [],
      notificationRoutes: input.notificationRoutes ?? [],
      initializationMode: input.initializationMode ?? "baseline",
      recentWindowMinutes: input.recentWindowMinutes ?? 180,
      weights: input.weights,
      initializedAt: input.initializedAt,
      lastRunAt: input.lastRunAt,
      nextRunAt: input.nextRunAt,
      leaseOwnerId: input.leaseOwnerId,
      leaseToken: input.leaseToken,
      leaseExpiresAt: input.leaseExpiresAt,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.watches.set(watch.id, watch);
    return watch;
  }

  async updateWatch(id: string, input: Partial<JobWatch>): Promise<JobWatch> {
    const current = this.watches.get(id);
    if (!current) throw new Error(`Watch not found: ${id}`);
    const next: JobWatch = {
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    };
    this.watches.set(id, next);
    return next;
  }

  async updateWatchIfCurrent(
    id: string,
    expectedUpdatedAt: Date,
    input: Partial<JobWatch>,
  ): Promise<JobWatch | null> {
    const current = this.watches.get(id);
    if (
      !current ||
      current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
    ) {
      return null;
    }
    return this.updateWatch(id, input);
  }

  async deleteWatch(id: string): Promise<boolean> {
    if (!this.watches.delete(id)) return false;
    for (const [runId, run] of this.runs) {
      if (run.watchId === id) this.runs.delete(runId);
    }
    const removedMatches = new Set<string>();
    for (const [key, match] of this.matches) {
      if (match.watchId === id) {
        removedMatches.add(match.id);
        this.matches.delete(key);
      }
    }
    for (const [key, delivery] of this.notifications) {
      if (removedMatches.has(delivery.watchMatchId))
        this.notifications.delete(key);
    }
    return true;
  }

  async createRun(
    input: Partial<WatchRun> & { watchId: string },
  ): Promise<WatchRun> {
    const now = new Date();
    const run: WatchRun = {
      id: input.id ?? randomUUID(),
      watchId: input.watchId,
      startedAt: input.startedAt ?? now,
      completedAt: input.completedAt,
      status: input.status ?? "running",
      sourcesRequested: input.sourcesRequested ?? [],
      sourcesSucceeded: input.sourcesSucceeded ?? [],
      sourcesFailed: input.sourcesFailed ?? [],
      targetResults: input.targetResults ?? [],
      coverageDegraded: input.coverageDegraded ?? false,
      jobsFetched: input.jobsFetched ?? 0,
      jobsNormalized: input.jobsNormalized ?? 0,
      newJobsDetected: input.newJobsDetected ?? 0,
      matchesCreated: input.matchesCreated ?? 0,
      notificationsSent: input.notificationsSent ?? 0,
      durationMs: input.durationMs,
      errorSummary: input.errorSummary,
      createdAt: input.createdAt ?? now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async getRun(id: string): Promise<WatchRun | null> {
    return this.runs.get(id) ?? null;
  }

  async completeRun(id: string, patch: Partial<WatchRun>): Promise<WatchRun> {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    const next: WatchRun = {
      ...run,
      ...patch,
      id: run.id,
      watchId: run.watchId,
      createdAt: run.createdAt,
    };
    this.runs.set(id, next);
    return next;
  }

  async listRuns(query: WatchRunQuery): Promise<Page<WatchRun>> {
    const { offset, limit } = pageBounds(query);
    const rows = [...this.runs.values()]
      .filter(
        (run) =>
          (!query.watchId || run.watchId === query.watchId) &&
          (!query.status || run.status === query.status) &&
          (!query.startedAfter || run.startedAt >= query.startedAfter) &&
          (!query.startedBefore || run.startedAt <= query.startedBefore),
      )
      .sort(
        (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
      );
    return page(rows.slice(offset, offset + limit), rows.length, offset, limit);
  }

  async getObservedJob(id: string): Promise<ObservedJob | null> {
    return [...this.jobs.values()].find((job) => job.id === id) ?? null;
  }

  async listObservedJobs(query: ObservedJobQuery): Promise<Page<ObservedJob>> {
    const { offset, limit } = pageBounds(query);
    const rows = [...this.jobs.values()]
      .filter((job) => matchesObservedQuery(job, query))
      .sort(
        (left, right) =>
          right.firstSeenAt.getTime() - left.firstSeenAt.getTime(),
      );
    return page(rows.slice(offset, offset + limit), rows.length, offset, limit);
  }

  async upsertObservedJob(input: ObservedJobInput): Promise<{
    job: ObservedJob;
    isNew: boolean;
    descriptionChanged: boolean;
  }> {
    const baseExisting = this.jobs.get(input.fingerprint);
    const storageFingerprint = requiresEpisodeScopedObservation(
      baseExisting,
      input,
    )
      ? episodeObservationFingerprint(
          input.fingerprint,
          input.canonicalEpisodeKey!,
        )
      : input.fingerprint;
    const existing = this.jobs.get(storageFingerprint);
    const now = new Date();
    if (existing) {
      const descriptionChanged =
        existing.descriptionHash !== input.descriptionHash;
      const job: ObservedJob = {
        ...existing,
        ...input,
        id: existing.id,
        fingerprint: existing.fingerprint,
        firstSeenAt: existing.firstSeenAt,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.jobs.set(storageFingerprint, job);
      return { job, isNew: false, descriptionChanged };
    }
    const job: ObservedJob = {
      ...input,
      fingerprint: storageFingerprint,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(storageFingerprint, job);
    return { job, isNew: true, descriptionChanged: false };
  }

  async upsertMatch(input: WatchMatchInput): Promise<{
    match: WatchMatch;
    isNew: boolean;
  }> {
    const key = matchKey(
      input.watchId,
      input.observedJobId,
      input.canonicalEpisodeKey,
    );
    let existingKey = key;
    let existing = this.matches.get(key);
    if (!existing && input.canonicalEpisodeKey) {
      const legacy = [...this.matches.entries()].find(
        ([, match]) =>
          match.watchId === input.watchId &&
          match.observedJobId === input.observedJobId &&
          !match.canonicalEpisodeKey,
      );
      if (legacy) {
        [existingKey, existing] = legacy;
      }
    }
    const now = new Date();
    if (existing) {
      const currentObservation = await this.getObservedJob(
        existing.observedJobId,
      );
      const incomingObservation = await this.getObservedJob(
        input.observedJobId,
      );
      const promotesEligibilitySuppression =
        existing.notificationState === "suppressed" &&
        existing.notificationSuppressionReason === "eligibility" &&
        input.notificationState === "pending";
      const useIncomingObservation =
        existing.observedJobId === input.observedJobId ||
        input.score > existing.score ||
        promotesEligibilitySuppression ||
        observationRichness(incomingObservation) >
          observationRichness(currentObservation);
      const match: WatchMatch = {
        ...existing,
        ...(useIncomingObservation
          ? {
              observedJobId: input.observedJobId,
              canonicalEpisodeKey: input.canonicalEpisodeKey,
              sourceTargetKey: input.sourceTargetKey,
              score: input.score,
              scoreBreakdown: input.scoreBreakdown,
              matchedTerms: input.matchedTerms,
              excludedReason: input.excludedReason,
            }
          : {}),
        ...(promotesEligibilitySuppression
          ? {
              notificationState: "pending" as const,
              notificationSuppressionReason: null,
            }
          : {}),
        lastMatchedAt: input.lastMatchedAt,
        updatedAt: now,
      };
      if (existingKey !== key) this.matches.delete(existingKey);
      this.matches.set(key, match);
      return { match, isNew: false };
    }
    const match: WatchMatch = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.matches.set(key, match);
    return { match, isNew: true };
  }

  async persistObservationAndMatch(
    input: PersistObservationAndMatchInput,
  ): Promise<PersistObservationAndMatchResult> {
    const observedJob = this.resolveAnchoredCanonicalEpisode(
      input.observedJob,
      input.canonicalEpisodeAnchorWindowMs,
    );
    const observation = await this.upsertObservedJob(observedJob);
    const match = await this.upsertMatch({
      ...input.match,
      observedJobId: observation.job.id,
      canonicalEpisodeKey:
        observation.job.canonicalEpisodeKey ?? input.match.canonicalEpisodeKey,
    });
    return {
      job: observation.job,
      match: match.match,
      isNewJob: observation.isNew,
      isNewMatch: match.isNew,
      descriptionChanged: observation.descriptionChanged,
    };
  }

  private resolveAnchoredCanonicalEpisode(
    input: ObservedJobInput,
    windowMs: number | undefined,
  ): ObservedJobInput {
    const anchor = input.canonicalEpisodeStartedAt;
    if (
      !windowMs ||
      windowMs <= 0 ||
      !input.canonicalKey ||
      !input.canonicalEpisodeKey ||
      !anchor ||
      !Number.isFinite(anchor.getTime())
    ) {
      return input;
    }
    const minimumAnchor = anchor.getTime() - windowMs;
    const recent = [...this.jobs.values()]
      .filter(
        (job) =>
          job.canonicalKey === input.canonicalKey &&
          Boolean(job.canonicalEpisodeKey) &&
          Boolean(job.canonicalEpisodeStartedAt) &&
          (job.canonicalEpisodeStartedAt?.getTime() ?? 0) >= minimumAnchor &&
          (job.canonicalEpisodeStartedAt?.getTime() ?? 0) <= anchor.getTime(),
      )
      .sort(
        (left, right) =>
          (right.canonicalEpisodeStartedAt?.getTime() ?? 0) -
          (left.canonicalEpisodeStartedAt?.getTime() ?? 0),
      )[0];
    return recent?.canonicalEpisodeKey && recent.canonicalEpisodeStartedAt
      ? {
          ...input,
          canonicalEpisodeKey: recent.canonicalEpisodeKey,
          canonicalEpisodeStartedAt: recent.canonicalEpisodeStartedAt,
        }
      : input;
  }

  async getMatch(id: string): Promise<WatchMatch | null> {
    return [...this.matches.values()].find((match) => match.id === id) ?? null;
  }

  async updateMatch(
    id: string,
    patch: Partial<WatchMatch>,
  ): Promise<WatchMatch> {
    const entry = [...this.matches.entries()].find(
      ([, match]) => match.id === id,
    );
    if (!entry) throw new Error(`Watch match not found: ${id}`);
    const [key, current] = entry;
    const next: WatchMatch = {
      ...current,
      ...patch,
      id: current.id,
      watchId: current.watchId,
      observedJobId: patch.observedJobId ?? current.observedJobId,
      firstMatchedAt: current.firstMatchedAt,
      createdAt: current.createdAt,
      updatedAt: new Date(),
    };
    this.matches.set(key, next);
    return next;
  }

  async listMatches(query: WatchMatchQuery): Promise<Page<WatchMatch>> {
    const { offset, limit } = pageBounds(query);
    const rows = [...this.matches.values()]
      .filter((match) => this.matchesMatchQuery(match, query))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.firstMatchedAt.getTime() - left.firstMatchedAt.getTime(),
      );
    return page(rows.slice(offset, offset + limit), rows.length, offset, limit);
  }

  async hasNotification(key: string): Promise<boolean> {
    return this.notifications.has(key);
  }

  async enqueueNotification(
    input: CreateNotificationDeliveryInput,
  ): Promise<{ delivery: NotificationDelivery; isNew: boolean }> {
    const existing = this.notifications.get(input.idempotencyKey);
    if (existing) return { delivery: existing, isNew: false };
    const now = new Date();
    const status = input.status ?? "pending";
    const attempted = status !== "pending";
    const delivery: NotificationDelivery = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      watchMatchId: input.watchMatchId,
      notificationType: input.notificationType,
      channel: input.channel,
      provider: input.provider,
      destinationRef: input.destinationRef,
      status,
      attemptCount: attempted ? 1 : 0,
      lastAttemptAt: attempted ? now : null,
      nextAttemptAt: input.nextAttemptAt,
      sentAt: status === "sent" ? now : null,
      failedAt: status === "failed" ? now : null,
      claimOwnerId: null,
      claimToken: null,
      claimExpiresAt: null,
      providerResponse: input.providerResponse,
      errorMessage: input.errorMessage,
      createdAt: now,
      updatedAt: now,
    };
    this.notifications.set(delivery.idempotencyKey, delivery);
    return { delivery, isNew: true };
  }

  async claimNotification(
    input: ClaimNotificationDeliveryInput,
  ): Promise<NotificationDelivery | null> {
    const delivery = [...this.notifications.values()].find(
      (candidate) => candidate.id === input.deliveryId,
    );
    if (
      !delivery ||
      !["pending", "failed"].includes(delivery.status) ||
      delivery.attemptCount >= Math.max(1, input.maxAttempts) ||
      (delivery.nextAttemptAt && delivery.nextAttemptAt > input.now) ||
      (delivery.claimExpiresAt && delivery.claimExpiresAt > input.now)
    ) {
      return null;
    }
    const next: NotificationDelivery = {
      ...delivery,
      claimOwnerId: input.ownerId,
      claimToken: input.token,
      claimExpiresAt: input.expiresAt,
      updatedAt: new Date(),
    };
    this.notifications.set(next.idempotencyKey, next);
    return next;
  }

  async updateNotification(
    id: string,
    claimToken: string,
    patch: UpdateNotificationDeliveryInput,
  ): Promise<NotificationDelivery> {
    const delivery = [...this.notifications.values()].find(
      (candidate) => candidate.id === id,
    );
    if (!delivery || delivery.claimToken !== claimToken) {
      throw new Error(`Notification claim is not active: ${id}`);
    }
    const now = new Date();
    const next: NotificationDelivery = {
      ...delivery,
      status: patch.status ?? delivery.status,
      providerResponse:
        patch.providerResponse === undefined
          ? delivery.providerResponse
          : patch.providerResponse,
      errorMessage:
        patch.errorMessage === undefined
          ? delivery.errorMessage
          : patch.errorMessage,
      attemptCount:
        delivery.attemptCount + (patch.incrementAttempt === true ? 1 : 0),
      lastAttemptAt: patch.incrementAttempt ? now : delivery.lastAttemptAt,
      sentAt:
        patch.status === "sent"
          ? (patch.sentAt ?? now)
          : (patch.sentAt ?? delivery.sentAt),
      failedAt:
        patch.status === "failed"
          ? (patch.failedAt ?? now)
          : patch.status === "sent"
            ? null
            : (patch.failedAt ?? delivery.failedAt),
      nextAttemptAt:
        patch.status === "sent"
          ? null
          : (patch.nextAttemptAt ?? delivery.nextAttemptAt),
      claimOwnerId: patch.clearClaim === false ? delivery.claimOwnerId : null,
      claimToken: patch.clearClaim === false ? delivery.claimToken : null,
      claimExpiresAt:
        patch.clearClaim === false ? delivery.claimExpiresAt : null,
      id: delivery.id,
      idempotencyKey: delivery.idempotencyKey,
      watchMatchId: delivery.watchMatchId,
      notificationType: delivery.notificationType,
      channel: delivery.channel,
      provider: delivery.provider,
      destinationRef: delivery.destinationRef,
      createdAt: delivery.createdAt,
      updatedAt: now,
    };
    this.notifications.set(next.idempotencyKey, next);
    return next;
  }

  async getNotification(id: string): Promise<NotificationDelivery | null> {
    return (
      [...this.notifications.values()].find((delivery) => delivery.id === id) ??
      null
    );
  }

  async listNotifications(
    query: NotificationDeliveryQuery,
  ): Promise<Page<NotificationDelivery>> {
    const { offset, limit } = pageBounds(query);
    const rows = [...this.notifications.values()]
      .filter((delivery) => this.matchesNotificationQuery(delivery, query))
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
    return page(rows.slice(offset, offset + limit), rows.length, offset, limit);
  }

  async recordNotification(input: RecordNotificationInput): Promise<void> {
    const result = await this.enqueueNotification({
      idempotencyKey: input.idempotencyKey,
      watchMatchId: input.watchMatchId,
      notificationType: input.notificationType ?? "standard",
      channel: input.channel,
      provider: input.provider,
      destinationRef: input.destinationRef ?? input.channel,
      status: input.status,
      providerResponse: input.providerResponse,
      errorMessage: input.errorMessage,
    });
    if (!result.isNew) {
      const now = new Date();
      this.notifications.set(input.idempotencyKey, {
        ...result.delivery,
        status: input.status,
        providerResponse: input.providerResponse,
        errorMessage: input.errorMessage,
        attemptCount: result.delivery.attemptCount + 1,
        lastAttemptAt: now,
        sentAt: input.status === "sent" ? now : result.delivery.sentAt,
        failedAt: input.status === "failed" ? now : result.delivery.failedAt,
        updatedAt: now,
      });
    }
  }

  async listDigestMatches(
    watchId: string,
    min: number,
    max: number,
  ): Promise<WatchMatch[]> {
    return [...this.matches.values()]
      .filter(
        (match) =>
          match.watchId === watchId &&
          match.score >= min &&
          match.score < max &&
          !match.excludedReason &&
          match.notificationState === "pending",
      )
      .sort((left, right) => right.score - left.score);
  }

  private matchesMatchQuery(
    match: WatchMatch,
    query: WatchMatchQuery,
  ): boolean {
    const job = [...this.jobs.values()].find(
      (candidate) => candidate.id === match.observedJobId,
    );
    return (
      (!query.watchId || match.watchId === query.watchId) &&
      (!query.status || match.status === query.status) &&
      (!query.notificationState ||
        match.notificationState === query.notificationState) &&
      (query.minimumScore === undefined || match.score >= query.minimumScore) &&
      (query.maximumScore === undefined || match.score <= query.maximumScore) &&
      (!query.matchedAfter || match.firstMatchedAt >= query.matchedAfter) &&
      (!query.matchedBefore || match.firstMatchedAt <= query.matchedBefore) &&
      (!hasObservedFilters(query) ||
        (job !== undefined && matchesObservedQuery(job, query)))
    );
  }

  private matchesNotificationQuery(
    delivery: NotificationDelivery,
    query: NotificationDeliveryQuery,
  ): boolean {
    const match = [...this.matches.values()].find(
      (candidate) => candidate.id === delivery.watchMatchId,
    );
    return (
      (!query.watchId || match?.watchId === query.watchId) &&
      (!query.watchMatchId || delivery.watchMatchId === query.watchMatchId) &&
      (!query.status || delivery.status === query.status) &&
      (!query.channel || delivery.channel === query.channel) &&
      (!query.notificationType ||
        delivery.notificationType === query.notificationType) &&
      (!query.createdAfter || delivery.createdAt >= query.createdAfter) &&
      (!query.createdBefore || delivery.createdAt <= query.createdBefore) &&
      (!query.readyAt ||
        (["pending", "failed"].includes(delivery.status) &&
          (!delivery.nextAttemptAt ||
            delivery.nextAttemptAt <= query.readyAt) &&
          (!delivery.claimExpiresAt ||
            delivery.claimExpiresAt <= query.readyAt)))
    );
  }
}

function hasObservedFilters(query: WatchMatchQuery): boolean {
  return Boolean(
    query.company ||
    query.source ||
    query.location ||
    query.employmentType ||
    query.workplaceType,
  );
}

function matchesObservedQuery(
  job: ObservedJob,
  query: ObservedJobQuery | WatchMatchQuery,
): boolean {
  return (
    contains(job.company, query.company) &&
    (!query.source || job.source === query.source) &&
    contains(job.location, query.location) &&
    contains(job.employmentType, query.employmentType) &&
    contains(job.workplaceType, query.workplaceType) &&
    (!("firstSeenAfter" in query) ||
      !query.firstSeenAfter ||
      job.firstSeenAt >= query.firstSeenAfter) &&
    (!("firstSeenBefore" in query) ||
      !query.firstSeenBefore ||
      job.firstSeenAt <= query.firstSeenBefore)
  );
}

function contains(value?: string | null, expected?: string): boolean {
  return (
    !expected ||
    value?.toLocaleLowerCase().includes(expected.toLocaleLowerCase()) === true
  );
}

function matchKey(
  watchId: string,
  observedJobId: string,
  canonicalEpisodeKey?: string | null,
): string {
  return canonicalEpisodeKey
    ? `${watchId}:canonical:${canonicalEpisodeKey}`
    : `${watchId}:observation:${observedJobId}`;
}

function requiresEpisodeScopedObservation(
  existing: ObservedJob | undefined,
  input: ObservedJobInput,
): boolean {
  return Boolean(
    existing?.canonicalEpisodeKey &&
    input.canonicalEpisodeKey &&
    existing.canonicalEpisodeKey !== input.canonicalEpisodeKey,
  );
}

function episodeObservationFingerprint(
  sourceFingerprint: string,
  canonicalEpisodeKey: string,
): string {
  return createHash("sha256")
    .update(
      ["observation-episode", sourceFingerprint, canonicalEpisodeKey].join("|"),
    )
    .digest("hex");
}

function observationRichness(job: ObservedJob | null): number {
  if (!job) return -1;
  return (
    (job.applicationUrl ? 100 : 0) +
    (job.sourcePublishedAt ? 30 : 0) +
    Math.min(50, (job.locations?.length ?? 0) * 10) +
    (job.jobUrl ? 10 : 0) +
    Math.min(40, Math.floor((job.description?.length ?? 0) / 500))
  );
}

function pageBounds(query: PageRequest): { offset: number; limit: number } {
  return {
    offset: Math.max(0, Math.trunc(query.offset ?? 0)),
    limit: clampLimit(query.limit ?? DEFAULT_PAGE_LIMIT),
  };
}

function clampLimit(limit: number): number {
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));
}

function page<T>(
  items: T[],
  total: number,
  offset: number,
  limit: number,
): Page<T> {
  return { items, total, offset, limit };
}
