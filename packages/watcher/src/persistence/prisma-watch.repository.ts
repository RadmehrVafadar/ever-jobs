import { Injectable } from "@nestjs/common";
import {
  JobWatch as PrismaJobWatch,
  NotificationDelivery as PrismaNotificationDelivery,
  ObservedJob as PrismaObservedJob,
  Prisma,
  WatchMatch as PrismaWatchMatch,
  WatchRun as PrismaWatchRun,
} from "@prisma/client";
import { createHash } from "crypto";
import { LocationDto } from "@ever-jobs/models";
import {
  AcquireWatchLeaseInput,
  ClaimNotificationDeliveryInput,
  CreateNotificationDeliveryInput,
  JobWatch,
  NotificationDelivery,
  NotificationDeliveryQuery,
  NotificationStatus,
  NotificationSuppressionReason,
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
  ScoreBreakdown,
  UpdateNotificationDeliveryInput,
  WatchInitializationMode,
  WatchLease,
  WatchMatch,
  WatchMatchInput,
  WatchMatchQuery,
  WatchMatchStatus,
  WatchRepository,
  WatchRun,
  WatchRunQuery,
  WatchRunStatus,
  WatchSourceTarget,
  WatchTargetHealth,
  WatchTargetRunResult,
} from "../interfaces/watch.types";
import { WatcherPrismaService } from "./watcher-prisma.service";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const TRANSACTION_ATTEMPTS = 3;

type ObservationUpsertResult = {
  job: ObservedJob;
  isNew: boolean;
  descriptionChanged: boolean;
};

type MatchUpsertResult = {
  match: WatchMatch;
  isNew: boolean;
};

@Injectable()
export class PrismaWatchRepository implements WatchRepository {
  constructor(private readonly prisma: WatcherPrismaService) {}

  async healthCheck(): Promise<boolean> {
    try {
      // Connectivity alone is insufficient: the scheduler cannot operate
      // until watcher migrations have created its durable tables.
      await this.prisma.$queryRaw(
        Prisma.sql`SELECT "targetHealth" FROM "JobWatch" LIMIT 0`,
      );
      await this.prisma.$queryRaw(
        Prisma.sql`SELECT "sourceTargetKey", "locations", "canonicalEpisodeKey", "canonicalEpisodeStartedAt" FROM "ObservedJob" LIMIT 0`,
      );
      await this.prisma.$queryRaw(
        Prisma.sql`SELECT "canonicalEpisodeKey", "sourceTargetKey", "notificationSuppressionReason" FROM "WatchMatch" LIMIT 0`,
      );
      await this.prisma.$queryRaw(
        Prisma.sql`SELECT "targetResults", "coverageDegraded" FROM "WatchRun" LIMIT 0`,
      );
      return true;
    } catch {
      return false;
    }
  }

  async listWatches(): Promise<JobWatch[]> {
    const rows = await this.prisma.jobWatch.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(mapWatch);
  }

  async listDueWatches(now: Date, limit: number): Promise<JobWatch[]> {
    const rows = await this.prisma.jobWatch.findMany({
      where: {
        enabled: true,
        AND: [
          { OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
          {
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
        ],
      },
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
      take: clampLimit(limit),
    });
    return rows.map(mapWatch);
  }

  async tryAcquireWatchLease(
    input: AcquireWatchLeaseInput,
  ): Promise<WatchLease | null> {
    const dueCondition: Prisma.JobWatchWhereInput =
      input.requireDue === false
        ? {}
        : { OR: [{ nextRunAt: null }, { nextRunAt: { lte: input.now } }] };
    const result = await this.prisma.jobWatch.updateMany({
      where: {
        id: input.watchId,
        ...(input.requireDue === false ? {} : { enabled: true }),
        AND: [
          dueCondition,
          {
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: input.now } },
            ],
          },
        ],
      },
      data: {
        leaseOwnerId: input.ownerId,
        leaseToken: input.token,
        leaseExpiresAt: input.expiresAt,
        nextRunAt: input.nextRunAt,
      },
    });
    if (result.count !== 1) return null;
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
    const result = await this.prisma.jobWatch.updateMany({
      where: {
        id: input.watchId,
        leaseOwnerId: input.ownerId,
        leaseToken: input.token,
        leaseExpiresAt: { gt: input.now },
      },
      data: { leaseExpiresAt: input.expiresAt },
    });
    if (result.count !== 1) return null;
    return {
      watchId: input.watchId,
      ownerId: input.ownerId,
      token: input.token,
      expiresAt: input.expiresAt,
    };
  }

  async releaseWatchLease(input: ReleaseWatchLeaseInput): Promise<boolean> {
    const result = await this.prisma.jobWatch.updateMany({
      where: {
        id: input.watchId,
        leaseOwnerId: input.ownerId,
        leaseToken: input.token,
      },
      data: {
        leaseOwnerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  async getWatch(id: string): Promise<JobWatch | null> {
    const row = await this.prisma.jobWatch.findUnique({ where: { id } });
    return row ? mapWatch(row) : null;
  }

  async createWatch(input: Partial<JobWatch>): Promise<JobWatch> {
    const data = watchCreateData(input);
    const row = await this.prisma.jobWatch.create({ data });
    return mapWatch(row);
  }

  async updateWatch(id: string, input: Partial<JobWatch>): Promise<JobWatch> {
    const row = await this.prisma.jobWatch.update({
      where: { id },
      data: watchUpdateData(input),
    });
    return mapWatch(row);
  }

  async deleteWatch(id: string): Promise<boolean> {
    const result = await this.prisma.jobWatch.deleteMany({ where: { id } });
    return result.count === 1;
  }

  async createRun(
    input: Partial<WatchRun> & { watchId: string },
  ): Promise<WatchRun> {
    const row = await this.prisma.watchRun.create({
      data: {
        id: input.id,
        watchId: input.watchId,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        status: input.status ?? "running",
        sourcesRequested: jsonInput(input.sourcesRequested ?? []),
        sourcesSucceeded: jsonInput(input.sourcesSucceeded ?? []),
        sourcesFailed: jsonInput(input.sourcesFailed ?? []),
        targetResults: jsonInput(
          targetResultsForStorage(input.targetResults ?? []),
        ),
        coverageDegraded: input.coverageDegraded ?? false,
        jobsFetched: input.jobsFetched ?? 0,
        jobsNormalized: input.jobsNormalized ?? 0,
        newJobsDetected: input.newJobsDetected ?? 0,
        matchesCreated: input.matchesCreated ?? 0,
        notificationsSent: input.notificationsSent ?? 0,
        durationMs: input.durationMs,
        errorSummary: input.errorSummary,
        createdAt: input.createdAt,
      },
    });
    return mapRun(row);
  }

  async getRun(id: string): Promise<WatchRun | null> {
    const row = await this.prisma.watchRun.findUnique({ where: { id } });
    return row ? mapRun(row) : null;
  }

  async completeRun(id: string, patch: Partial<WatchRun>): Promise<WatchRun> {
    const data: Prisma.WatchRunUncheckedUpdateInput = {};
    if (patch.completedAt !== undefined) data.completedAt = patch.completedAt;
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.sourcesRequested !== undefined) {
      data.sourcesRequested = jsonInput(patch.sourcesRequested);
    }
    if (patch.sourcesSucceeded !== undefined) {
      data.sourcesSucceeded = jsonInput(patch.sourcesSucceeded);
    }
    if (patch.sourcesFailed !== undefined) {
      data.sourcesFailed = jsonInput(patch.sourcesFailed);
    }
    if (patch.targetResults !== undefined) {
      data.targetResults = jsonInput(
        targetResultsForStorage(patch.targetResults),
      );
    }
    if (patch.coverageDegraded !== undefined) {
      data.coverageDegraded = patch.coverageDegraded;
    }
    if (patch.jobsFetched !== undefined) data.jobsFetched = patch.jobsFetched;
    if (patch.jobsNormalized !== undefined) {
      data.jobsNormalized = patch.jobsNormalized;
    }
    if (patch.newJobsDetected !== undefined) {
      data.newJobsDetected = patch.newJobsDetected;
    }
    if (patch.matchesCreated !== undefined) {
      data.matchesCreated = patch.matchesCreated;
    }
    if (patch.notificationsSent !== undefined) {
      data.notificationsSent = patch.notificationsSent;
    }
    if (patch.durationMs !== undefined) data.durationMs = patch.durationMs;
    if (patch.errorSummary !== undefined) {
      data.errorSummary = patch.errorSummary;
    }
    const row = await this.prisma.watchRun.update({ where: { id }, data });
    return mapRun(row);
  }

  async listRuns(query: WatchRunQuery): Promise<Page<WatchRun>> {
    const { offset, limit } = pageBounds(query);
    const where: Prisma.WatchRunWhereInput = {};
    if (query.watchId !== undefined) where.watchId = query.watchId;
    if (query.status !== undefined) where.status = query.status;
    if (query.startedAfter || query.startedBefore) {
      where.startedAt = {
        gte: query.startedAfter,
        lte: query.startedBefore,
      };
    }
    const [total, rows] = await Promise.all([
      this.prisma.watchRun.count({ where }),
      this.prisma.watchRun.findMany({
        where,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    return page(rows.map(mapRun), total, offset, limit);
  }

  async getObservedJob(id: string): Promise<ObservedJob | null> {
    const row = await this.prisma.observedJob.findUnique({ where: { id } });
    return row ? mapObservedJob(row) : null;
  }

  async listObservedJobs(query: ObservedJobQuery): Promise<Page<ObservedJob>> {
    const { offset, limit } = pageBounds(query);
    const where = observedJobWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.observedJob.count({ where }),
      this.prisma.observedJob.findMany({
        where,
        orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    return page(rows.map(mapObservedJob), total, offset, limit);
  }

  async upsertObservedJob(input: ObservedJobInput): Promise<{
    job: ObservedJob;
    isNew: boolean;
    descriptionChanged: boolean;
  }> {
    return this.serializableTransaction((transaction) =>
      this.upsertObservedJobInTransaction(transaction, input),
    );
  }

  async upsertMatch(input: WatchMatchInput): Promise<{
    match: WatchMatch;
    isNew: boolean;
  }> {
    return this.serializableTransaction((transaction) =>
      this.upsertMatchInTransaction(transaction, input),
    );
  }

  async persistObservationAndMatch(
    input: PersistObservationAndMatchInput,
  ): Promise<PersistObservationAndMatchResult> {
    return this.serializableTransaction(async (transaction) => {
      const observedJob = await this.resolveAnchoredCanonicalEpisode(
        transaction,
        input.observedJob,
        input.canonicalEpisodeAnchorWindowMs,
      );
      const observation = await this.upsertObservedJobInTransaction(
        transaction,
        observedJob,
      );
      const match = await this.upsertMatchInTransaction(transaction, {
        ...input.match,
        observedJobId: observation.job.id,
        canonicalEpisodeKey:
          observation.job.canonicalEpisodeKey ??
          input.match.canonicalEpisodeKey,
      });
      return {
        job: observation.job,
        match: match.match,
        isNewJob: observation.isNew,
        isNewMatch: match.isNew,
        descriptionChanged: observation.descriptionChanged,
      };
    });
  }

  async getMatch(id: string): Promise<WatchMatch | null> {
    const row = await this.prisma.watchMatch.findUnique({ where: { id } });
    return row ? mapMatch(row) : null;
  }

  async updateMatch(
    id: string,
    patch: Partial<WatchMatch>,
  ): Promise<WatchMatch> {
    const data: Prisma.WatchMatchUncheckedUpdateInput = {};
    if (patch.observedJobId !== undefined) {
      data.observedJobId = patch.observedJobId;
    }
    if (patch.canonicalEpisodeKey !== undefined) {
      data.canonicalEpisodeKey = patch.canonicalEpisodeKey;
    }
    if (patch.sourceTargetKey !== undefined) {
      data.sourceTargetKey = patch.sourceTargetKey;
    }
    if (patch.score !== undefined) data.score = patch.score;
    if (patch.scoreBreakdown !== undefined) {
      data.scoreBreakdown = jsonInput(patch.scoreBreakdown);
    }
    if (patch.matchedTerms !== undefined) {
      data.matchedTerms = jsonInput(patch.matchedTerms);
    }
    if (patch.excludedReason !== undefined) {
      data.excludedReason = patch.excludedReason;
    }
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.lastMatchedAt !== undefined) {
      data.lastMatchedAt = patch.lastMatchedAt;
    }
    if (patch.notificationState !== undefined) {
      data.notificationState = patch.notificationState;
    }
    if (patch.notificationSuppressionReason !== undefined) {
      data.notificationSuppressionReason = patch.notificationSuppressionReason;
    }
    const row = await this.prisma.watchMatch.update({ where: { id }, data });
    return mapMatch(row);
  }

  async listMatches(query: WatchMatchQuery): Promise<Page<WatchMatch>> {
    const { offset, limit } = pageBounds(query);
    const where = watchMatchWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.watchMatch.count({ where }),
      this.prisma.watchMatch.findMany({
        where,
        orderBy: [
          { score: "desc" },
          { firstMatchedAt: "desc" },
          { id: "desc" },
        ],
        skip: offset,
        take: limit,
      }),
    ]);
    return page(rows.map(mapMatch), total, offset, limit);
  }

  async hasNotification(idempotencyKey: string): Promise<boolean> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    return delivery !== null;
  }

  async enqueueNotification(
    input: CreateNotificationDeliveryInput,
  ): Promise<{ delivery: NotificationDelivery; isNew: boolean }> {
    return this.serializableTransaction(async (transaction) => {
      const existing = await transaction.notificationDelivery.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return { delivery: mapDelivery(existing), isNew: false };
      }
      const status = input.status ?? "pending";
      const attempted = status !== "pending";
      const now = attempted ? new Date() : undefined;
      const row = await transaction.notificationDelivery.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          watchMatchId: input.watchMatchId,
          notificationType: input.notificationType,
          channel: input.channel,
          provider: input.provider,
          destinationRef: input.destinationRef,
          status,
          attemptCount: attempted ? 1 : 0,
          lastAttemptAt: now,
          nextAttemptAt: input.nextAttemptAt,
          sentAt: status === "sent" ? now : undefined,
          failedAt: status === "failed" ? now : undefined,
          providerResponse: optionalJson(input.providerResponse),
          errorMessage: input.errorMessage,
        },
      });
      return { delivery: mapDelivery(row), isNew: true };
    });
  }

  async claimNotification(
    input: ClaimNotificationDeliveryInput,
  ): Promise<NotificationDelivery | null> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        id: input.deliveryId,
        status: { in: ["pending", "failed"] },
        attemptCount: { lt: Math.max(1, input.maxAttempts) },
        AND: [
          {
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: input.now } },
            ],
          },
          {
            OR: [
              { claimExpiresAt: null },
              { claimExpiresAt: { lte: input.now } },
            ],
          },
        ],
      },
      data: {
        claimOwnerId: input.ownerId,
        claimToken: input.token,
        claimExpiresAt: input.expiresAt,
      },
    });
    if (result.count !== 1) return null;
    const row = await this.prisma.notificationDelivery.findFirst({
      where: { id: input.deliveryId, claimToken: input.token },
    });
    return row ? mapDelivery(row) : null;
  }

  async updateNotification(
    id: string,
    claimToken: string,
    patch: UpdateNotificationDeliveryInput,
  ): Promise<NotificationDelivery> {
    const data: Prisma.NotificationDeliveryUncheckedUpdateManyInput = {};
    const now = new Date();
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.providerResponse !== undefined) {
      data.providerResponse = optionalJson(patch.providerResponse);
    }
    if (patch.errorMessage !== undefined) {
      data.errorMessage = patch.errorMessage;
    }
    if (patch.sentAt !== undefined) data.sentAt = patch.sentAt;
    if (patch.failedAt !== undefined) data.failedAt = patch.failedAt;
    if (patch.nextAttemptAt !== undefined) {
      data.nextAttemptAt = patch.nextAttemptAt;
    }
    if (patch.incrementAttempt) {
      data.attemptCount = { increment: 1 };
      data.lastAttemptAt = now;
    }
    if (patch.status === "sent" && patch.sentAt === undefined) {
      data.sentAt = now;
      data.failedAt = null;
      data.nextAttemptAt = null;
    }
    if (patch.status === "failed" && patch.failedAt === undefined) {
      data.failedAt = now;
    }
    if (patch.clearClaim !== false) {
      data.claimOwnerId = null;
      data.claimToken = null;
      data.claimExpiresAt = null;
    }
    const result = await this.prisma.notificationDelivery.updateMany({
      where: { id, claimToken },
      data,
    });
    if (result.count !== 1) {
      throw new Error(`Notification claim is not active: ${id}`);
    }
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { id },
    });
    if (!row) throw new Error(`Notification not found after update: ${id}`);
    return mapDelivery(row);
  }

  async getNotification(id: string): Promise<NotificationDelivery | null> {
    const row = await this.prisma.notificationDelivery.findUnique({
      where: { id },
    });
    return row ? mapDelivery(row) : null;
  }

  async listNotifications(
    query: NotificationDeliveryQuery,
  ): Promise<Page<NotificationDelivery>> {
    const { offset, limit } = pageBounds(query);
    const where = notificationWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.notificationDelivery.count({ where }),
      this.prisma.notificationDelivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);
    return page(rows.map(mapDelivery), total, offset, limit);
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
    if (result.isNew) return;
    const now = new Date();
    await this.prisma.notificationDelivery.update({
      where: { id: result.delivery.id },
      data: {
        status: input.status,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        sentAt: input.status === "sent" ? now : undefined,
        failedAt: input.status === "failed" ? now : undefined,
        providerResponse: optionalJson(input.providerResponse),
        errorMessage: input.errorMessage,
      },
    });
  }

  async listDigestMatches(
    watchId: string,
    min: number,
    max: number,
  ): Promise<WatchMatch[]> {
    const rows = await this.prisma.watchMatch.findMany({
      where: {
        watchId,
        score: { gte: min, lt: max },
        excludedReason: null,
        notificationState: "pending",
      },
      orderBy: [{ score: "desc" }, { firstMatchedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(mapMatch);
  }

  private async upsertObservedJobInTransaction(
    transaction: Prisma.TransactionClient,
    input: ObservedJobInput,
  ): Promise<ObservationUpsertResult> {
    let storageFingerprint = input.fingerprint;
    let existing = await transaction.observedJob.findUnique({
      where: { fingerprint: input.fingerprint },
    });
    if (requiresEpisodeScopedObservation(existing, input)) {
      storageFingerprint = episodeObservationFingerprint(
        input.fingerprint,
        input.canonicalEpisodeKey!,
      );
      existing = await transaction.observedJob.findUnique({
        where: { fingerprint: storageFingerprint },
      });
    }
    if (!existing) {
      const row = await transaction.observedJob.create({
        data: observedJobCreateData({
          ...input,
          fingerprint: storageFingerprint,
        }),
      });
      return {
        job: mapObservedJob(row),
        isNew: true,
        descriptionChanged: false,
      };
    }
    const descriptionChanged =
      existing.descriptionHash !== input.descriptionHash;
    const row = await transaction.observedJob.update({
      where: { id: existing.id },
      data: observedJobUpdateData(input),
    });
    return {
      job: mapObservedJob(row),
      isNew: false,
      descriptionChanged,
    };
  }

  private async resolveAnchoredCanonicalEpisode(
    transaction: Prisma.TransactionClient,
    input: ObservedJobInput,
    windowMs: number | undefined,
  ): Promise<ObservedJobInput> {
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
    const recent = await transaction.observedJob.findFirst({
      where: {
        canonicalKey: input.canonicalKey,
        canonicalEpisodeKey: { not: null },
        canonicalEpisodeStartedAt: {
          gte: new Date(anchor.getTime() - windowMs),
          lte: anchor,
        },
      },
      orderBy: [{ canonicalEpisodeStartedAt: "desc" }, { id: "desc" }],
      select: {
        canonicalEpisodeKey: true,
        canonicalEpisodeStartedAt: true,
      },
    });
    return recent?.canonicalEpisodeKey && recent.canonicalEpisodeStartedAt
      ? {
          ...input,
          canonicalEpisodeKey: recent.canonicalEpisodeKey,
          canonicalEpisodeStartedAt: recent.canonicalEpisodeStartedAt,
        }
      : input;
  }

  private async upsertMatchInTransaction(
    transaction: Prisma.TransactionClient,
    input: WatchMatchInput,
  ): Promise<MatchUpsertResult> {
    let existing = input.canonicalEpisodeKey
      ? await transaction.watchMatch.findUnique({
          where: {
            watchId_canonicalEpisodeKey: {
              watchId: input.watchId,
              canonicalEpisodeKey: input.canonicalEpisodeKey,
            },
          },
        })
      : null;
    if (!existing) {
      const observationMatch = await transaction.watchMatch.findUnique({
        where: {
          watchId_observedJobId: {
            watchId: input.watchId,
            observedJobId: input.observedJobId,
          },
        },
      });
      // The observed-job identity is only a compatibility path for rows that
      // predate canonical episodes. A non-null, different episode is never
      // collapsed into the incoming canonical episode.
      if (
        !input.canonicalEpisodeKey ||
        !observationMatch?.canonicalEpisodeKey
      ) {
        existing = observationMatch;
      }
    }
    if (!existing) {
      const row = await transaction.watchMatch.create({
        data: matchCreateData(input),
      });
      return { match: mapMatch(row), isNew: true };
    }
    const promotesEligibilitySuppression =
      existing.notificationState === "suppressed" &&
      existing.notificationSuppressionReason === "eligibility" &&
      input.notificationState === "pending";
    const useIncomingObservation =
      existing.observedJobId === input.observedJobId ||
      input.score > existing.score ||
      promotesEligibilitySuppression ||
      (await incomingObservationIsRicher(
        transaction,
        existing.observedJobId,
        input.observedJobId,
      ));
    const row = await transaction.watchMatch.update({
      where: { id: existing.id },
      data: {
        ...(useIncomingObservation
          ? {
              observedJobId: input.observedJobId,
              canonicalEpisodeKey: input.canonicalEpisodeKey,
              sourceTargetKey: input.sourceTargetKey,
              score: input.score,
              scoreBreakdown: jsonInput(input.scoreBreakdown),
              matchedTerms: jsonInput(input.matchedTerms),
              excludedReason: input.excludedReason,
            }
          : {}),
        ...(promotesEligibilitySuppression
          ? {
              notificationState: "pending",
              notificationSuppressionReason: null,
            }
          : {}),
        lastMatchedAt: input.lastMatchedAt,
      },
    });
    return { match: mapMatch(row), isNew: false };
  }

  private async serializableTransaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (
          !isRetryableTransactionError(error) ||
          attempt === TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw lastError;
  }
}

function watchCreateData(
  input: Partial<JobWatch>,
): Prisma.JobWatchUncheckedCreateInput {
  return {
    id: input.id,
    name: input.name ?? "Untitled watch",
    enabled: input.enabled ?? true,
    description: input.description,
    schedule: input.schedule,
    intervalMinutes: input.intervalMinutes ?? 3,
    timezone: input.timezone ?? "America/Toronto",
    sources: jsonInput(input.sources ?? []),
    sourceTiers: jsonInput(input.sourceTiers ?? {}),
    sourceTargets: jsonInput(
      sourceTargetsForStorage(input.sourceTargets ?? []),
    ),
    targetHealth: jsonInput(targetHealthForStorage(input.targetHealth ?? {})),
    companySlugs: jsonInput(input.companySlugs ?? []),
    companies: jsonInput(input.companies ?? []),
    searchTerms: jsonInput(input.searchTerms ?? []),
    requiredTerms: jsonInput(input.requiredTerms ?? []),
    preferredTerms: jsonInput(input.preferredTerms ?? []),
    excludedTerms: jsonInput(input.excludedTerms ?? []),
    locations: jsonInput(input.locations ?? []),
    countryCodes: jsonInput(input.countryCodes ?? ["CA"]),
    allowedWorkplaceTypes: jsonInput(
      input.allowedWorkplaceTypes ?? ["remote", "hybrid", "on-site"],
    ),
    allowedEmploymentTypes: jsonInput(
      input.allowedEmploymentTypes ?? ["internship", "co-op"],
    ),
    minimumScore: input.minimumScore ?? 60,
    urgentScore: input.urgentScore ?? 80,
    digestScore: input.digestScore ?? 40,
    notificationChannels: jsonInput(input.notificationChannels ?? []),
    initializationMode: input.initializationMode ?? "baseline",
    recentWindowMinutes: input.recentWindowMinutes ?? 180,
    weights: optionalJson(input.weights),
    initializedAt: input.initializedAt,
    lastRunAt: input.lastRunAt,
    nextRunAt: input.nextRunAt,
    leaseOwnerId: input.leaseOwnerId,
    leaseToken: input.leaseToken,
    leaseExpiresAt: input.leaseExpiresAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function watchUpdateData(
  input: Partial<JobWatch>,
): Prisma.JobWatchUncheckedUpdateInput {
  const data: Prisma.JobWatchUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.description !== undefined) data.description = input.description;
  if (input.schedule !== undefined) data.schedule = input.schedule;
  if (input.intervalMinutes !== undefined) {
    data.intervalMinutes = input.intervalMinutes;
  }
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.sources !== undefined) data.sources = jsonInput(input.sources);
  if (input.sourceTiers !== undefined) {
    data.sourceTiers = jsonInput(input.sourceTiers);
  }
  if (input.sourceTargets !== undefined) {
    data.sourceTargets = jsonInput(
      sourceTargetsForStorage(input.sourceTargets),
    );
  }
  if (input.targetHealth !== undefined) {
    data.targetHealth = jsonInput(targetHealthForStorage(input.targetHealth));
  }
  if (input.companySlugs !== undefined) {
    data.companySlugs = jsonInput(input.companySlugs);
  }
  if (input.companies !== undefined)
    data.companies = jsonInput(input.companies);
  if (input.searchTerms !== undefined) {
    data.searchTerms = jsonInput(input.searchTerms);
  }
  if (input.requiredTerms !== undefined) {
    data.requiredTerms = jsonInput(input.requiredTerms);
  }
  if (input.preferredTerms !== undefined) {
    data.preferredTerms = jsonInput(input.preferredTerms);
  }
  if (input.excludedTerms !== undefined) {
    data.excludedTerms = jsonInput(input.excludedTerms);
  }
  if (input.locations !== undefined)
    data.locations = jsonInput(input.locations);
  if (input.countryCodes !== undefined) {
    data.countryCodes = jsonInput(input.countryCodes);
  }
  if (input.allowedWorkplaceTypes !== undefined) {
    data.allowedWorkplaceTypes = jsonInput(input.allowedWorkplaceTypes);
  }
  if (input.allowedEmploymentTypes !== undefined) {
    data.allowedEmploymentTypes = jsonInput(input.allowedEmploymentTypes);
  }
  if (input.minimumScore !== undefined) data.minimumScore = input.minimumScore;
  if (input.urgentScore !== undefined) data.urgentScore = input.urgentScore;
  if (input.digestScore !== undefined) data.digestScore = input.digestScore;
  if (input.notificationChannels !== undefined) {
    data.notificationChannels = jsonInput(input.notificationChannels);
  }
  if (input.initializationMode !== undefined) {
    data.initializationMode = input.initializationMode;
  }
  if (input.recentWindowMinutes !== undefined) {
    data.recentWindowMinutes = input.recentWindowMinutes;
  }
  if (input.weights !== undefined) data.weights = jsonInput(input.weights);
  if (input.initializedAt !== undefined)
    data.initializedAt = input.initializedAt;
  if (input.lastRunAt !== undefined) data.lastRunAt = input.lastRunAt;
  if (input.nextRunAt !== undefined) data.nextRunAt = input.nextRunAt;
  if (input.leaseOwnerId !== undefined) data.leaseOwnerId = input.leaseOwnerId;
  if (input.leaseToken !== undefined) data.leaseToken = input.leaseToken;
  if (input.leaseExpiresAt !== undefined) {
    data.leaseExpiresAt = input.leaseExpiresAt;
  }
  return data;
}

function observedJobCreateData(
  input: ObservedJobInput,
): Prisma.ObservedJobUncheckedCreateInput {
  return {
    fingerprint: input.fingerprint,
    source: input.source,
    sourceTargetKey: input.sourceTargetKey,
    sourceType: input.sourceType,
    externalJobId: input.externalJobId,
    company: input.company,
    normalizedCompany: input.normalizedCompany,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    location: input.location,
    normalizedLocation: input.normalizedLocation,
    locations: jsonInput(input.locations ?? []),
    canonicalKey: input.canonicalKey,
    canonicalEpisodeKey: input.canonicalEpisodeKey,
    canonicalEpisodeStartedAt: input.canonicalEpisodeStartedAt,
    workplaceType: input.workplaceType,
    employmentType: input.employmentType,
    description: input.description,
    descriptionHash: input.descriptionHash,
    jobUrl: input.jobUrl,
    applicationUrl: input.applicationUrl,
    sourcePublishedAt: input.sourcePublishedAt,
    firstSeenAt: input.firstSeenAt,
    lastSeenAt: input.lastSeenAt,
    closedAt: input.closedAt,
    rawPayload: optionalJson(input.rawPayload),
  };
}

function observedJobUpdateData(
  input: ObservedJobInput,
): Prisma.ObservedJobUncheckedUpdateInput {
  return {
    source: input.source,
    sourceTargetKey: input.sourceTargetKey,
    sourceType: input.sourceType,
    externalJobId: input.externalJobId,
    company: input.company,
    normalizedCompany: input.normalizedCompany,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    location: input.location,
    normalizedLocation: input.normalizedLocation,
    locations: jsonInput(input.locations ?? []),
    canonicalKey: input.canonicalKey,
    canonicalEpisodeKey: input.canonicalEpisodeKey,
    canonicalEpisodeStartedAt: input.canonicalEpisodeStartedAt,
    workplaceType: input.workplaceType,
    employmentType: input.employmentType,
    description: input.description,
    descriptionHash: input.descriptionHash,
    jobUrl: input.jobUrl,
    applicationUrl: input.applicationUrl,
    sourcePublishedAt: input.sourcePublishedAt,
    lastSeenAt: input.lastSeenAt,
    closedAt: input.closedAt,
    rawPayload: optionalJson(input.rawPayload),
  };
}

function matchCreateData(
  input: WatchMatchInput,
): Prisma.WatchMatchUncheckedCreateInput {
  return {
    watchId: input.watchId,
    observedJobId: input.observedJobId,
    canonicalEpisodeKey: input.canonicalEpisodeKey,
    sourceTargetKey: input.sourceTargetKey,
    score: input.score,
    scoreBreakdown: jsonInput(input.scoreBreakdown),
    matchedTerms: jsonInput(input.matchedTerms),
    excludedReason: input.excludedReason,
    status: input.status,
    firstMatchedAt: input.firstMatchedAt,
    lastMatchedAt: input.lastMatchedAt,
    notificationState: input.notificationState,
    notificationSuppressionReason: input.notificationSuppressionReason,
  };
}

function observedJobWhere(
  query: ObservedJobQuery,
): Prisma.ObservedJobWhereInput {
  const where: Prisma.ObservedJobWhereInput = {};
  if (query.company !== undefined) {
    where.company = { contains: query.company, mode: "insensitive" };
  }
  if (query.source !== undefined) where.source = query.source;
  if (query.location !== undefined) {
    where.location = { contains: query.location, mode: "insensitive" };
  }
  if (query.employmentType !== undefined) {
    where.employmentType = {
      contains: query.employmentType,
      mode: "insensitive",
    };
  }
  if (query.workplaceType !== undefined) {
    where.workplaceType = {
      contains: query.workplaceType,
      mode: "insensitive",
    };
  }
  if (query.firstSeenAfter || query.firstSeenBefore) {
    where.firstSeenAt = {
      gte: query.firstSeenAfter,
      lte: query.firstSeenBefore,
    };
  }
  return where;
}

function watchMatchWhere(query: WatchMatchQuery): Prisma.WatchMatchWhereInput {
  const where: Prisma.WatchMatchWhereInput = {};
  if (query.watchId !== undefined) where.watchId = query.watchId;
  if (query.status !== undefined) where.status = query.status;
  if (query.notificationState !== undefined) {
    where.notificationState = query.notificationState;
  }
  if (query.minimumScore !== undefined || query.maximumScore !== undefined) {
    where.score = {
      gte: query.minimumScore,
      lte: query.maximumScore,
    };
  }
  if (query.matchedAfter || query.matchedBefore) {
    where.firstMatchedAt = {
      gte: query.matchedAfter,
      lte: query.matchedBefore,
    };
  }
  const observedJob = observedJobWhere({
    company: query.company,
    source: query.source,
    location: query.location,
    employmentType: query.employmentType,
    workplaceType: query.workplaceType,
  });
  if (Object.keys(observedJob).length > 0) where.observedJob = observedJob;
  return where;
}

function notificationWhere(
  query: NotificationDeliveryQuery,
): Prisma.NotificationDeliveryWhereInput {
  const where: Prisma.NotificationDeliveryWhereInput = {};
  const and: Prisma.NotificationDeliveryWhereInput[] = [];
  if (query.watchMatchId !== undefined) where.watchMatchId = query.watchMatchId;
  if (query.watchId !== undefined) {
    where.watchMatch = { watchId: query.watchId };
  }
  if (query.status !== undefined) where.status = query.status;
  if (query.channel !== undefined) where.channel = query.channel;
  if (query.notificationType !== undefined) {
    where.notificationType = query.notificationType;
  }
  if (query.createdAfter || query.createdBefore) {
    where.createdAt = {
      gte: query.createdAfter,
      lte: query.createdBefore,
    };
  }
  if (query.readyAt !== undefined) {
    if (query.status === undefined)
      where.status = { in: ["pending", "failed"] };
    and.push(
      {
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: query.readyAt } },
        ],
      },
      {
        OR: [
          { claimExpiresAt: null },
          { claimExpiresAt: { lte: query.readyAt } },
        ],
      },
    );
  }
  if (and.length > 0) where.AND = and;
  return where;
}

function mapWatch(row: PrismaJobWatch): JobWatch {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    description: row.description ?? undefined,
    schedule: row.schedule ?? undefined,
    intervalMinutes: row.intervalMinutes,
    timezone: row.timezone,
    sources: stringArray(row.sources),
    sourceTiers: numberRecord(row.sourceTiers),
    sourceTargets: sourceTargetsFromStorage(row.sourceTargets),
    targetHealth: targetHealthFromStorage(row.targetHealth),
    companySlugs: stringArray(row.companySlugs),
    companies: stringArray(row.companies),
    searchTerms: stringArray(row.searchTerms),
    requiredTerms: stringArray(row.requiredTerms),
    preferredTerms: stringArray(row.preferredTerms),
    excludedTerms: stringArray(row.excludedTerms),
    locations: stringArray(row.locations),
    countryCodes: stringArray(row.countryCodes),
    allowedWorkplaceTypes: stringArray(row.allowedWorkplaceTypes),
    allowedEmploymentTypes: stringArray(row.allowedEmploymentTypes),
    minimumScore: row.minimumScore,
    urgentScore: row.urgentScore,
    digestScore: row.digestScore,
    notificationChannels: Array.isArray(row.notificationChannels)
      ? (row.notificationChannels as unknown as JobWatch["notificationChannels"])
      : [],
    initializationMode: row.initializationMode as WatchInitializationMode,
    recentWindowMinutes: row.recentWindowMinutes,
    weights: row.weights ? numberRecord(row.weights) : undefined,
    initializedAt: row.initializedAt,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    leaseOwnerId: row.leaseOwnerId,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapObservedJob(row: PrismaObservedJob): ObservedJob {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    sourceTargetKey: row.sourceTargetKey,
    sourceType: row.sourceType,
    externalJobId: row.externalJobId,
    company: row.company,
    normalizedCompany: row.normalizedCompany,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    location: row.location,
    normalizedLocation: row.normalizedLocation,
    locations: locationArray(row.locations),
    canonicalKey: row.canonicalKey,
    canonicalEpisodeKey: row.canonicalEpisodeKey,
    canonicalEpisodeStartedAt: row.canonicalEpisodeStartedAt,
    workplaceType: row.workplaceType,
    employmentType: row.employmentType,
    description: row.description,
    descriptionHash: row.descriptionHash,
    jobUrl: row.jobUrl,
    applicationUrl: row.applicationUrl,
    sourcePublishedAt: row.sourcePublishedAt,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    closedAt: row.closedAt,
    rawPayload: row.rawPayload ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMatch(row: PrismaWatchMatch): WatchMatch {
  return {
    id: row.id,
    watchId: row.watchId,
    observedJobId: row.observedJobId,
    canonicalEpisodeKey: row.canonicalEpisodeKey,
    sourceTargetKey: row.sourceTargetKey,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown as unknown as ScoreBreakdown,
    matchedTerms: stringArray(row.matchedTerms),
    excludedReason: row.excludedReason,
    status: row.status as WatchMatchStatus,
    firstMatchedAt: row.firstMatchedAt,
    lastMatchedAt: row.lastMatchedAt,
    notificationState: row.notificationState as NotificationStatus,
    notificationSuppressionReason:
      row.notificationSuppressionReason as NotificationSuppressionReason | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDelivery(row: PrismaNotificationDelivery): NotificationDelivery {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    watchMatchId: row.watchMatchId,
    notificationType:
      row.notificationType as NotificationDelivery["notificationType"],
    channel: row.channel,
    provider: row.provider,
    destinationRef: row.destinationRef,
    status: row.status as NotificationStatus,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    nextAttemptAt: row.nextAttemptAt,
    sentAt: row.sentAt,
    failedAt: row.failedAt,
    claimOwnerId: row.claimOwnerId,
    claimToken: row.claimToken,
    claimExpiresAt: row.claimExpiresAt,
    providerResponse: row.providerResponse ?? undefined,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRun(row: PrismaWatchRun): WatchRun {
  return {
    id: row.id,
    watchId: row.watchId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    status: row.status as WatchRunStatus,
    sourcesRequested: stringArray(row.sourcesRequested),
    sourcesSucceeded: stringArray(row.sourcesSucceeded),
    sourcesFailed: stringArray(row.sourcesFailed),
    targetResults: targetResultsFromStorage(row.targetResults),
    coverageDegraded: row.coverageDegraded,
    jobsFetched: row.jobsFetched,
    jobsNormalized: row.jobsNormalized,
    newJobsDetected: row.newJobsDetected,
    matchesCreated: row.matchesCreated,
    notificationsSent: row.notificationsSent,
    durationMs: row.durationMs ?? undefined,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt,
  };
}

function sourceTargetsForStorage(
  targets: WatchSourceTarget[],
): Prisma.InputJsonObject[] {
  return targets.map((target) => ({
    site: String(target.site),
    tier: target.tier,
    intervalMinutes: target.intervalMinutes,
    enabled: target.enabled,
    ...(target.resultsWanted === undefined
      ? {}
      : { resultsWanted: target.resultsWanted }),
    ...(target.companySlug === undefined
      ? {}
      : { companySlug: target.companySlug }),
    ...(target.companyName === undefined
      ? {}
      : { companyName: target.companyName }),
    ...(target.searchScope === undefined
      ? {}
      : {
          searchScope: {
            countryCodes: target.searchScope.countryCodes,
            locations: target.searchScope.locations,
            ...(target.searchScope.searchTerms === undefined
              ? {}
              : { searchTerms: target.searchScope.searchTerms }),
            ...(target.searchScope.maxRequestsPerRun === undefined
              ? {}
              : { maxRequestsPerRun: target.searchScope.maxRequestsPerRun }),
          },
        }),
    ...(target.initializedAt === undefined
      ? {}
      : { initializedAt: target.initializedAt?.toISOString() ?? null }),
    ...(target.lastRunAt === undefined
      ? {}
      : { lastRunAt: target.lastRunAt?.toISOString() ?? null }),
    ...(target.nextRunAt === undefined
      ? {}
      : { nextRunAt: target.nextRunAt?.toISOString() ?? null }),
  }));
}

function sourceTargetsFromStorage(
  value: Prisma.JsonValue,
): WatchSourceTarget[] {
  if (!Array.isArray(value)) return [];
  const targets: WatchSourceTarget[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const tier = candidate.tier;
    if (
      typeof candidate.site !== "string" ||
      (tier !== 1 && tier !== 2 && tier !== 3) ||
      typeof candidate.intervalMinutes !== "number" ||
      typeof candidate.enabled !== "boolean"
    ) {
      continue;
    }
    targets.push({
      site: candidate.site,
      tier,
      intervalMinutes: candidate.intervalMinutes,
      enabled: candidate.enabled,
      ...(typeof candidate.resultsWanted === "number" &&
      Number.isFinite(candidate.resultsWanted)
        ? {
            resultsWanted: Math.min(
              1_000,
              Math.max(1, Math.trunc(candidate.resultsWanted)),
            ),
          }
        : {}),
      ...(typeof candidate.companySlug === "string"
        ? { companySlug: candidate.companySlug }
        : {}),
      ...(typeof candidate.companyName === "string"
        ? { companyName: candidate.companyName }
        : {}),
      ...(searchScopeFromStorage(candidate.searchScope)
        ? { searchScope: searchScopeFromStorage(candidate.searchScope) }
        : {}),
      ...(candidate.initializedAt === undefined
        ? {}
        : { initializedAt: nullableDate(candidate.initializedAt) }),
      ...(candidate.lastRunAt === undefined
        ? {}
        : { lastRunAt: nullableDate(candidate.lastRunAt) }),
      ...(candidate.nextRunAt === undefined
        ? {}
        : { nextRunAt: nullableDate(candidate.nextRunAt) }),
    });
  }
  return targets;
}

function targetHealthForStorage(
  health: Record<string, WatchTargetHealth>,
): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(health).map(([targetKey, state]) => [
      targetKey,
      {
        targetKey: state.targetKey,
        tier: state.tier,
        successCount: state.successCount,
        hardFailureCount: state.hardFailureCount,
        emptyRunCount: state.emptyRunCount,
        partialRunCount: state.partialRunCount,
        consecutiveHardFailures: state.consecutiveHardFailures,
        lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        lastNonEmptyAt: state.lastNonEmptyAt?.toISOString() ?? null,
        degradedAt: state.degradedAt?.toISOString() ?? null,
      },
    ]),
  );
}

function targetHealthFromStorage(
  value: Prisma.JsonValue,
): Record<string, WatchTargetHealth> {
  if (!isJsonObject(value)) return {};
  const health: Record<string, WatchTargetHealth> = {};
  for (const [targetKey, candidate] of Object.entries(value)) {
    if (!isJsonObject(candidate)) continue;
    const tier = candidate.tier;
    if (tier !== 1 && tier !== 2 && tier !== 3) continue;
    health[targetKey] = {
      targetKey,
      tier,
      successCount: nonNegativeJsonInteger(candidate.successCount),
      hardFailureCount: nonNegativeJsonInteger(candidate.hardFailureCount),
      emptyRunCount: nonNegativeJsonInteger(candidate.emptyRunCount),
      partialRunCount: nonNegativeJsonInteger(candidate.partialRunCount),
      consecutiveHardFailures: nonNegativeJsonInteger(
        candidate.consecutiveHardFailures,
      ),
      lastAttemptAt: nullableDate(candidate.lastAttemptAt),
      lastSuccessAt: nullableDate(candidate.lastSuccessAt),
      lastNonEmptyAt: nullableDate(candidate.lastNonEmptyAt),
      degradedAt: nullableDate(candidate.degradedAt),
    };
  }
  return health;
}

function targetResultsForStorage(
  results: WatchTargetRunResult[],
): Prisma.InputJsonObject[] {
  return results.map((result) => ({
    ...result,
    lastSuccessAt: result.lastSuccessAt?.toISOString() ?? null,
    lastNonEmptyAt: result.lastNonEmptyAt?.toISOString() ?? null,
  }));
}

function targetResultsFromStorage(
  value: Prisma.JsonValue,
): WatchTargetRunResult[] {
  if (!Array.isArray(value)) return [];
  const results: WatchTargetRunResult[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const tier = candidate.tier;
    const status = candidate.status;
    const outcome = candidate.outcome;
    if (
      typeof candidate.targetKey !== "string" ||
      (tier !== 1 && tier !== 2 && tier !== 3) ||
      (status !== "succeeded" && status !== "partial" && status !== "failed") ||
      (outcome !== "success" &&
        outcome !== "empty" &&
        outcome !== "partial" &&
        outcome !== "hard_failure")
    ) {
      continue;
    }
    results.push({
      targetKey: candidate.targetKey,
      tier,
      status,
      outcome,
      requests: nonNegativeJsonInteger(candidate.requests),
      requestsSucceeded: nonNegativeJsonInteger(candidate.requestsSucceeded),
      requestsFailed: nonNegativeJsonInteger(candidate.requestsFailed),
      jobsFetched: nonNegativeJsonInteger(candidate.jobsFetched),
      durationMs: nonNegativeJsonInteger(candidate.durationMs),
      empty: candidate.empty === true,
      hardFailure: candidate.hardFailure === true,
      consecutiveHardFailures: nonNegativeJsonInteger(
        candidate.consecutiveHardFailures,
      ),
      degraded: candidate.degraded === true,
      lastSuccessAt: nullableDate(candidate.lastSuccessAt),
      lastNonEmptyAt: nullableDate(candidate.lastNonEmptyAt),
    });
  }
  return results;
}

function locationArray(
  value: Prisma.JsonValue,
): NonNullable<ObservedJob["locations"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isJsonObject(candidate)) return [];
    const location: Record<string, string | null> = {};
    for (const key of ["city", "state", "country"] as const) {
      const part = candidate[key];
      if (typeof part === "string" || part === null) location[key] = part;
    }
    return Object.keys(location).length > 0 ? [new LocationDto(location)] : [];
  });
}

function nonNegativeJsonInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function searchScopeFromStorage(
  value: Prisma.JsonValue | undefined,
): WatchSourceTarget["searchScope"] | undefined {
  if (!value || !isJsonObject(value)) return undefined;
  const countryCodes = stringArray(value.countryCodes ?? []);
  const locations = stringArray(value.locations ?? []);
  if (countryCodes.length === 0 || locations.length === 0) return undefined;
  const searchTerms =
    value.searchTerms === undefined
      ? undefined
      : stringArray(value.searchTerms);
  const maxRequestsPerRun =
    typeof value.maxRequestsPerRun === "number" &&
    Number.isFinite(value.maxRequestsPerRun)
      ? Math.max(1, Math.trunc(value.maxRequestsPerRun))
      : undefined;
  return {
    countryCodes,
    locations,
    ...(searchTerms === undefined ? {} : { searchTerms }),
    ...(maxRequestsPerRun === undefined ? {} : { maxRequestsPerRun }),
  };
}

function nullableDate(value: unknown): Date | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isJsonObject(value: unknown): value is Prisma.JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberRecord(value: Prisma.JsonValue): Record<string, number> {
  if (!isJsonObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function optionalJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return jsonInput(value);
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

function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = Reflect.get(error, "code");
  return code === "P2002" || code === "P2034";
}

function requiresEpisodeScopedObservation(
  existing: PrismaObservedJob | null,
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

async function incomingObservationIsRicher(
  transaction: Prisma.TransactionClient,
  currentId: string,
  incomingId: string,
): Promise<boolean> {
  const [current, incoming] = await Promise.all([
    transaction.observedJob.findUnique({ where: { id: currentId } }),
    transaction.observedJob.findUnique({ where: { id: incomingId } }),
  ]);
  if (!incoming) return false;
  if (!current) return true;
  return observationRichness(incoming) > observationRichness(current);
}

function observationRichness(row: PrismaObservedJob): number {
  const locations = Array.isArray(row.locations) ? row.locations.length : 0;
  return (
    (row.applicationUrl ? 100 : 0) +
    (row.sourcePublishedAt ? 30 : 0) +
    Math.min(50, locations * 10) +
    (row.jobUrl ? 10 : 0) +
    Math.min(40, Math.floor((row.description?.length ?? 0) / 500))
  );
}
