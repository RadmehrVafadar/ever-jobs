import { BadRequestException } from "@nestjs/common";
import {
  JobNotificationMessage,
  JobWatch,
  NotificationDelivery,
  NotificationDeliveryQuery,
  ObservedJob,
  ObservedJobQuery,
  WatchMatchQuery,
  WatchRunQuery,
} from "@ever-jobs/watcher";
import {
  NotificationDeliveryQueryDto,
  ObservedJobQueryDto,
  WatchMatchQueryDto,
  WatchRunQueryDto,
} from "./watch.dto";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function toWatchRunQuery(
  watchId: string,
  query: WatchRunQueryDto,
): WatchRunQuery {
  const startedAfter = queryDate(query.startedAfter, "startedAfter");
  const startedBefore = queryDate(query.startedBefore, "startedBefore");
  assertDateOrder(startedAfter, startedBefore, "startedAfter", "startedBefore");
  return {
    watchId,
    ...pageQuery(query),
    status: query.status,
    startedAfter,
    startedBefore,
  };
}

export function toWatchMatchQuery(
  watchId: string,
  query: WatchMatchQueryDto,
): WatchMatchQuery {
  const matchedAfter = queryDate(query.matchedAfter, "matchedAfter");
  const matchedBefore = queryDate(query.matchedBefore, "matchedBefore");
  assertDateOrder(matchedAfter, matchedBefore, "matchedAfter", "matchedBefore");
  if (
    query.minimumScore !== undefined &&
    query.maximumScore !== undefined &&
    query.minimumScore > query.maximumScore
  ) {
    throw new BadRequestException(
      "minimumScore must be less than or equal to maximumScore",
    );
  }
  return {
    watchId,
    ...pageQuery(query),
    status: query.status,
    notificationState: query.notificationState,
    minimumScore: optionalNumber(query.minimumScore),
    maximumScore: optionalNumber(query.maximumScore),
    company: optionalText(query.company),
    source: optionalText(query.source),
    location: optionalText(query.location),
    employmentType: optionalText(query.employmentType),
    workplaceType: optionalText(query.workplaceType),
    matchedAfter,
    matchedBefore,
  };
}

export function toObservedJobQuery(
  query: ObservedJobQueryDto,
): ObservedJobQuery {
  const firstSeenAfter = queryDate(query.firstSeenAfter, "firstSeenAfter");
  const firstSeenBefore = queryDate(query.firstSeenBefore, "firstSeenBefore");
  assertDateOrder(
    firstSeenAfter,
    firstSeenBefore,
    "firstSeenAfter",
    "firstSeenBefore",
  );
  return {
    ...pageQuery(query),
    company: optionalText(query.company),
    source: optionalText(query.source),
    location: optionalText(query.location),
    employmentType: optionalText(query.employmentType),
    workplaceType: optionalText(query.workplaceType),
    firstSeenAfter,
    firstSeenBefore,
  };
}

export function toNotificationDeliveryQuery(
  query: NotificationDeliveryQueryDto,
): NotificationDeliveryQuery {
  const createdAfter = queryDate(query.createdAfter, "createdAfter");
  const createdBefore = queryDate(query.createdBefore, "createdBefore");
  assertDateOrder(createdAfter, createdBefore, "createdAfter", "createdBefore");
  return {
    ...pageQuery(query),
    watchId: optionalText(query.watchId),
    watchMatchId: optionalText(query.watchMatchId),
    status: query.status,
    channel: optionalText(query.channel),
    notificationType: query.notificationType,
    createdAfter,
    createdBefore,
  };
}

export function publicWatch(watch: JobWatch): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ...watch,
    notificationChannels: watch.notificationChannels.map((destination) => ({
      type: destination.type,
      destinationRef: destination.destinationRef ?? "default",
    })),
  };
  delete result.leaseOwnerId;
  delete result.leaseToken;
  delete result.leaseExpiresAt;
  return result;
}

export function publicObservedJob(job: ObservedJob): Record<string, unknown> {
  const result: Record<string, unknown> = { ...job };
  delete result.rawPayload;
  return result;
}

export function publicNotificationDelivery(
  delivery: NotificationDelivery,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...delivery };
  // Legacy idempotency keys may contain the deprecated raw destination URL.
  // The delivery id is sufficient for API/CLI consumers.
  delete result.idempotencyKey;
  delete result.claimOwnerId;
  delete result.claimToken;
  delete result.claimExpiresAt;
  if (typeof result.errorMessage === "string") {
    result.errorMessage = result.errorMessage.replace(
      /https?:\/\/[^\s]+/gi,
      "[redacted-url]",
    );
  }
  return result;
}

export function createDiscordTestMessage(
  watch: JobWatch,
  now = new Date(),
): JobNotificationMessage {
  const job: ObservedJob = {
    id: `discord-test-job-${now.getTime()}`,
    fingerprint: `discord-test-${now.getTime()}`,
    source: "ever-jobs-watcher-test",
    company: "rad.ar",
    normalizedCompany: "rad ar",
    title: "Discord notification test",
    normalizedTitle: "discord notification test",
    location: "Toronto, Ontario, Canada",
    normalizedLocation: "toronto ontario canada",
    workplaceType: "remote",
    employmentType: "test",
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
  return {
    idempotencyKey: `discord-test:${watch.id}:${now.getTime()}`,
    type: "urgent",
    watch,
    job,
    match: {
      id: `discord-test-match-${now.getTime()}`,
      watchId: watch.id,
      observedJobId: job.id,
      score: 100,
      scoreBreakdown: {
        total: 100,
        role: 30,
        internship: 25,
        location: 25,
        company: 10,
        source: 10,
        skills: 0,
        matchedKeywords: ["Discord configuration test"],
        missingRequired: [],
        reasons: [
          "Discord webhook configuration is working",
          "This is a test; it is not a real job posting",
        ],
      },
      matchedTerms: ["Discord configuration test"],
      status: "new",
      firstMatchedAt: now,
      lastMatchedAt: now,
      notificationState: "pending",
      createdAt: now,
      updatedAt: now,
    },
    detectedAt: now,
  };
}

function pageQuery(query: { offset?: number; limit?: number }): {
  offset: number;
  limit: number;
} {
  const offset = optionalNumber(query.offset) ?? 0;
  const limit = optionalNumber(query.limit) ?? DEFAULT_LIMIT;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new BadRequestException("offset must be a non-negative integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return { offset, limit };
}

function optionalNumber(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException("Numeric query value is invalid");
  }
  return parsed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function queryDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${name} must be a valid ISO-8601 date`);
  }
  return parsed;
}

function assertDateOrder(
  after: Date | undefined,
  before: Date | undefined,
  afterName: string,
  beforeName: string,
): void {
  if (after && before && after > before) {
    throw new BadRequestException(
      `${afterName} must not be after ${beforeName}`,
    );
  }
}
