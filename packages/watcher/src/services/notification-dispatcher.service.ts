import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import {
  JobNotificationMessage,
  NotificationDelivery,
  NotificationDestination,
  NotificationProvider,
  NotificationResult,
  NotificationStatus,
  WATCH_REPOSITORY,
  WatchRepository,
} from "../interfaces/watch.types";
import { WatcherMetricsService } from "./watcher-metrics.service";

export const NOTIFICATION_PROVIDERS = Symbol("NOTIFICATION_PROVIDERS");
export const NOTIFICATION_DISPATCH_OPTIONS = Symbol(
  "NOTIFICATION_DISPATCH_OPTIONS",
);

export interface NotificationDispatchOptions {
  ownerId: string;
  maxAttempts: number;
  claimTtlMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  now: () => Date;
  random: () => number;
}

const DEFAULT_OPTIONS: NotificationDispatchOptions = {
  ownerId: `notification-${process.pid}-${randomUUID()}`,
  maxAttempts: 5,
  claimTtlMs: 30_000,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 5 * 60_000,
  now: () => new Date(),
  random: Math.random,
};

@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly providersByType: Map<string, NotificationProvider>;
  private readonly options: NotificationDispatchOptions;

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    @Optional()
    @Inject(NOTIFICATION_PROVIDERS)
    providers: NotificationProvider[] = [],
    @Optional()
    @Inject(NOTIFICATION_DISPATCH_OPTIONS)
    options: Partial<NotificationDispatchOptions> = {},
    @Optional() private readonly metrics?: WatcherMetricsService,
  ) {
    this.providersByType = new Map(
      providers.map((provider) => [provider.type, provider]),
    );
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Persist an outbox row before attempting any provider I/O. */
  async dispatch(message: JobNotificationMessage): Promise<number> {
    let sent = 0;
    for (const destination of message.watch.notificationChannels) {
      const destinationRef = this.destinationRef(destination);
      const key = this.idempotencyKey(
        message.watch.id,
        message.match.canonicalEpisodeKey ?? message.job.id,
        destination.type,
        destinationRef,
      );
      const queued = await this.repo.enqueueNotification({
        idempotencyKey: key,
        watchMatchId: message.match.id,
        notificationType: message.type,
        channel: destination.type,
        provider: destination.type,
        destinationRef,
        status: "pending",
        nextAttemptAt: this.options.now(),
      });

      if (!queued.isNew && queued.delivery.status === "sent") {
        this.metrics?.duplicatesTotal.inc({ kind: "notification" });
        continue;
      }

      if (await this.attempt(queued.delivery, message, destination)) sent += 1;
    }
    return sent;
  }

  /** Retry outbox rows left pending by failures or process restarts. */
  async processDue(limit = 25): Promise<{ processed: number; sent: number }> {
    const page = await this.repo.listNotifications({
      status: "pending",
      readyAt: this.options.now(),
      offset: 0,
      limit,
    });
    let processed = 0;
    let sent = 0;

    for (const delivery of page.items) {
      const message = await this.rehydrate(delivery);
      if (!message) {
        await this.failUnrecoverable(
          delivery,
          "Delivery references missing watch data",
        );
        processed += 1;
        continue;
      }
      processed += 1;
      if (
        await this.attempt(delivery, message, {
          type: delivery.channel as NotificationDestination["type"],
          destinationRef: delivery.destinationRef,
        })
      )
        sent += 1;
    }

    return { processed, sent };
  }

  private async attempt(
    delivery: NotificationDelivery,
    message: JobNotificationMessage,
    destination: NotificationDestination,
  ): Promise<boolean> {
    const now = this.options.now();
    const claimToken = randomUUID();
    const claimed = await this.repo.claimNotification({
      deliveryId: delivery.id,
      ownerId: this.options.ownerId,
      token: claimToken,
      now,
      expiresAt: new Date(now.getTime() + this.options.claimTtlMs),
      maxAttempts: this.options.maxAttempts,
    });
    if (!claimed) return false;

    const provider = this.providersByType.get(delivery.provider);
    const result: NotificationResult = provider
      ? await provider.send(
          { ...message, idempotencyKey: delivery.idempotencyKey },
          destination,
        )
      : {
          status: "failed",
          errorMessage: `Notification provider is not configured: ${delivery.provider}`,
          providerResponse: {
            category: "configuration_error",
            retryable: false,
          },
        };

    if (result.status === "sent") {
      await this.repo.updateNotification(delivery.id, claimToken, {
        status: "sent",
        sentAt: this.options.now(),
        failedAt: null,
        nextAttemptAt: null,
        incrementAttempt: true,
        clearClaim: true,
        providerResponse: sanitizeProviderResponse(result.providerResponse),
        errorMessage: null,
      });
      this.metrics?.notificationsTotal.inc({
        provider: delivery.provider,
        status: "sent",
      });
      const latencySeconds = Math.max(
        0,
        (this.options.now().getTime() - message.job.firstSeenAt.getTime()) /
          1_000,
      );
      this.metrics?.notificationLatency.observe(latencySeconds);
      await this.repo.updateMatch(message.match.id, {
        notificationState: "sent",
      });
      return true;
    }

    if (result.status === "suppressed") {
      await this.repo.updateNotification(delivery.id, claimToken, {
        status: "suppressed",
        nextAttemptAt: null,
        incrementAttempt: true,
        clearClaim: true,
        providerResponse: sanitizeProviderResponse(result.providerResponse),
        errorMessage: sanitizeError(result.errorMessage),
      });
      await this.repo.updateMatch(message.match.id, {
        notificationState: "suppressed",
      });
      this.metrics?.notificationsTotal.inc({
        provider: delivery.provider,
        status: "suppressed",
      });
      return false;
    }

    const classification = providerClassification(result.providerResponse);
    const nextAttemptNumber = claimed.attemptCount + 1;
    const canRetry =
      classification.retryable && nextAttemptNumber < this.options.maxAttempts;
    const retryAfterMs =
      classification.retryAfterMs ?? this.retryDelayMs(nextAttemptNumber);
    const terminalStatus: NotificationStatus = canRetry ? "pending" : "failed";

    await this.repo.updateNotification(delivery.id, claimToken, {
      status: terminalStatus,
      failedAt: canRetry ? null : this.options.now(),
      nextAttemptAt: canRetry
        ? new Date(this.options.now().getTime() + retryAfterMs)
        : null,
      incrementAttempt: true,
      clearClaim: true,
      providerResponse: sanitizeProviderResponse(result.providerResponse),
      errorMessage: sanitizeError(result.errorMessage),
    });
    this.metrics?.notificationsTotal.inc({
      provider: delivery.provider,
      status: terminalStatus,
    });
    this.logger.warn(
      `Notification delivery ${delivery.id} ${canRetry ? "scheduled for retry" : "failed permanently"} (${classification.category})`,
    );
    await this.repo.updateMatch(message.match.id, {
      notificationState: terminalStatus,
    });
    return false;
  }

  private async rehydrate(
    delivery: NotificationDelivery,
  ): Promise<JobNotificationMessage | null> {
    const match = await this.repo.getMatch(delivery.watchMatchId);
    if (!match) return null;
    const [watch, job] = await Promise.all([
      this.repo.getWatch(match.watchId),
      this.repo.getObservedJob(match.observedJobId),
    ]);
    if (!watch || !job) return null;
    return {
      idempotencyKey: delivery.idempotencyKey,
      type: delivery.notificationType,
      watch,
      job,
      match,
      detectedAt: job.firstSeenAt,
    };
  }

  private async failUnrecoverable(
    delivery: NotificationDelivery,
    errorMessage: string,
  ): Promise<void> {
    const now = this.options.now();
    const token = randomUUID();
    const claimed = await this.repo.claimNotification({
      deliveryId: delivery.id,
      ownerId: this.options.ownerId,
      token,
      now,
      expiresAt: new Date(now.getTime() + this.options.claimTtlMs),
      maxAttempts: this.options.maxAttempts,
    });
    if (!claimed) return;
    await this.repo.updateNotification(delivery.id, token, {
      status: "failed",
      failedAt: now,
      nextAttemptAt: null,
      incrementAttempt: true,
      clearClaim: true,
      errorMessage,
    });
  }

  private destinationRef(destination: NotificationDestination): string {
    return (
      destination.destinationRef?.trim() ||
      destination.secretRef?.trim() ||
      "default"
    );
  }

  private idempotencyKey(
    watchId: string,
    canonicalEpisodeKey: string,
    channel: string,
    destinationRef: string,
  ): string {
    const value = [watchId, canonicalEpisodeKey, channel, destinationRef].join(
      "\u001f",
    );
    return `watch-v2:${createHash("sha256").update(value).digest("hex")}`;
  }

  private retryDelayMs(attempt: number): number {
    const base = Math.min(
      this.options.retryMaxDelayMs,
      this.options.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1),
    );
    return Math.floor(base * (0.8 + this.options.random() * 0.4));
  }
}

function providerClassification(value: unknown): {
  category: string;
  retryable: boolean;
  retryAfterMs?: number;
} {
  if (!value || typeof value !== "object") {
    return { category: "unknown", retryable: false };
  }
  const record = value as Record<string, unknown>;
  return {
    category: typeof record.category === "string" ? record.category : "unknown",
    retryable: record.retryable === true,
    ...(typeof record.retryAfterMs === "number" &&
    Number.isFinite(record.retryAfterMs)
      ? { retryAfterMs: Math.max(0, record.retryAfterMs) }
      : {}),
  };
}

function sanitizeProviderResponse(value: unknown): unknown {
  const classification = providerClassification(value);
  const status =
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).status === "number"
      ? (value as Record<string, unknown>).status
      : undefined;
  return { ...classification, ...(status === undefined ? {} : { status }) };
}

function sanitizeError(value: string | undefined): string {
  return (value ?? "Notification delivery failed")
    .replace(/https:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(
      /((?:authorization|token|api[-_ ]?key|secret)[=: ]+)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 500);
}
