import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WATCH_REPOSITORY, WatchRepository } from "../interfaces/watch.types";
import { NotificationDispatcher } from "./notification-dispatcher.service";
import { WatchExecutionService } from "./watch-execution.service";
import { WatcherMetricsService } from "./watcher-metrics.service";
import { DailyDigestService } from "./daily-digest.service";

export interface WatcherSchedulerStatus {
  enabled: boolean;
  started: boolean;
  databaseHealthy: boolean;
  lastPollAt: Date | null;
  lastError: string | null;
  maxConcurrentWatches: number;
  activeWatchCount: number;
  activeWatchIds: string[];
}

export const WATCHER_SCHEDULER_OPTIONS = Symbol("WATCHER_SCHEDULER_OPTIONS");

export interface WatcherSchedulerOptions {
  now: () => Date;
  shutdownTimeoutMs: number;
}

const DEFAULT_SCHEDULER_OPTIONS: Readonly<WatcherSchedulerOptions> =
  Object.freeze({
    now: () => new Date(),
    shutdownTimeoutMs: 30_000,
  });

@Injectable()
export class WatcherSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WatcherSchedulerService.name);
  private readonly activeRuns = new Map<string, Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private pollPromise: Promise<void> | null = null;
  private queuedPollAt: Date | null = null;
  private currentPollAt: Date | null = null;
  private admissionPromise: Promise<void> | null = null;
  private admissionRequested = false;
  private requestedAdmissionAt: Date | null = null;
  private latestAdmissionAt: Date | null = null;
  private retryPassPromise: Promise<void> | null = null;
  private started = false;
  private stopping = false;
  private databaseHealthy = false;
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;
  private readonly options: WatcherSchedulerOptions;

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    private readonly execution: WatchExecutionService,
    private readonly notifications: NotificationDispatcher,
    private readonly digest: DailyDigestService,
    private readonly metrics: WatcherMetricsService,
    @Optional() private readonly config?: ConfigService,
    @Optional()
    @Inject(WATCHER_SCHEDULER_OPTIONS)
    options: Partial<WatcherSchedulerOptions> = {},
  ) {
    this.options = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
    this.syncSchedulerMetrics();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log("Watcher scheduler is disabled");
      return;
    }
    this.stopping = false;
    this.databaseHealthy = await this.repo.healthCheck();
    if (!this.databaseHealthy) {
      throw new Error("Watcher database health check failed at startup");
    }
    this.started = true;
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollMs());
    this.timer.unref?.();
    this.logger.log(
      `Watcher scheduler started pollMs=${this.pollMs()} maxConcurrent=${this.maxConcurrent()}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.queuedPollAt = null;
    this.admissionRequested = false;
    this.requestedAdmissionAt = null;
    const activeRuns = [...this.activeRuns.values()];
    const pendingOperations = [
      ...activeRuns,
      this.pollPromise,
      this.admissionPromise,
      this.retryPassPromise,
    ].filter((operation): operation is Promise<void> => operation !== null);
    const uniqueOperations = [...new Set(pendingOperations)];
    if (uniqueOperations.length > 0) {
      this.logger.log(
        `Watcher shutdown waiting for ${activeRuns.length} active run(s) across ${uniqueOperations.length} tracked operation(s)`,
      );
      await waitForSettled(
        uniqueOperations,
        positiveInteger(
          this.options.shutdownTimeoutMs,
          DEFAULT_SCHEDULER_OPTIONS.shutdownTimeoutMs,
        ),
      );
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.isEnabled() || this.stopping) return;
    if (this.pollPromise) {
      if (!this.currentPollAt || now > this.currentPollAt) {
        this.queuedPollAt = laterDate(this.queuedPollAt, now);
      }
      return this.pollPromise;
    }

    this.queuedPollAt = laterDate(this.queuedPollAt, now);
    let operation: Promise<void>;
    operation = this.drainPolls().finally(() => {
      if (this.pollPromise === operation) this.pollPromise = null;
    });
    this.pollPromise = operation;
    return this.pollPromise;
  }

  private async drainPolls(): Promise<void> {
    while (this.queuedPollAt && !this.stopping) {
      const now = this.queuedPollAt;
      this.queuedPollAt = null;
      this.currentPollAt = now;
      await this.pollOnce(now);
    }
    this.currentPollAt = null;
  }

  private async pollOnce(now: Date): Promise<void> {
    try {
      this.databaseHealthy = await this.repo.healthCheck();
      if (!this.databaseHealthy)
        throw new Error("database health check failed");
      if (this.stopping) return;

      this.latestAdmissionAt = laterDate(this.latestAdmissionAt, now);
      await this.requestAdmission(now);
      if (this.stopping) return;

      if (!this.retryPassPromise) {
        let operation: Promise<void>;
        operation = this.notifications
          .processDue(25)
          .then(() => undefined)
          .catch((error: unknown) => {
            if (!this.stopping) {
              this.logger.error(
                `Notification retry pass failed: ${safeSchedulerError(error)}`,
              );
            }
          })
          .finally(() => {
            if (this.retryPassPromise === operation) {
              this.retryPassPromise = null;
            }
          });
        this.retryPassPromise = operation;
      }

      if (this.stopping) return;
      await this.digest.deliverDue(now);
      if (this.stopping) return;

      this.lastPollAt = now;
      this.lastError = null;
      this.metrics.schedulerLastPoll.set(now.getTime() / 1_000);
    } catch (error: unknown) {
      if (this.stopping) return;
      this.databaseHealthy = false;
      this.lastError = safeSchedulerError(error);
      this.logger.error(`Watcher scheduler poll failed: ${this.lastError}`);
    }
  }

  status(): WatcherSchedulerStatus {
    const maxConcurrentWatches = this.maxConcurrent();
    return {
      enabled: this.isEnabled(),
      started: this.started,
      databaseHealthy: this.databaseHealthy,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      maxConcurrentWatches,
      activeWatchCount: this.activeRuns.size,
      activeWatchIds: [...this.activeRuns.keys()],
    };
  }

  private requestAdmission(now: Date): Promise<void> {
    if (!this.isEnabled() || this.stopping) return Promise.resolve();
    this.admissionRequested = true;
    this.requestedAdmissionAt = laterDate(this.requestedAdmissionAt, now);
    if (this.admissionPromise) return this.admissionPromise;

    let operation: Promise<void>;
    operation = this.drainAdmissions().finally(() => {
      if (this.admissionPromise === operation) this.admissionPromise = null;
      if (this.admissionRequested && !this.stopping) {
        const retryAt =
          this.requestedAdmissionAt ?? this.latestAdmissionAt ?? new Date();
        void this.requestAdmission(retryAt).catch((error: unknown) => {
          this.recordAdmissionError(error);
        });
      }
    });
    this.admissionPromise = operation;
    return operation;
  }

  private async drainAdmissions(): Promise<void> {
    while (this.admissionRequested && !this.stopping) {
      this.admissionRequested = false;
      const now =
        this.requestedAdmissionAt ?? this.latestAdmissionAt ?? new Date();
      this.requestedAdmissionAt = null;
      await this.dispatchDueWatches(now);
    }
  }

  private async dispatchDueWatches(now: Date): Promise<void> {
    const maximum = this.maxConcurrent();
    const capacity = Math.max(0, maximum - this.activeRuns.size);
    if (capacity === 0 || this.stopping) return;

    const due = await this.repo.listDueWatches(now, maximum * 2);
    for (const watch of due) {
      if (this.stopping || this.activeRuns.size >= maximum) break;
      if (this.activeRuns.has(watch.id)) continue;
      this.startScheduledRun(watch.id);
    }
  }

  private startScheduledRun(watchId: string): void {
    let operation: Promise<void>;
    operation = this.execution
      .runWatch(watchId, undefined, {
        trigger: "scheduled",
        requireDue: true,
        forceSources: false,
      })
      .then(() => undefined)
      .catch((error: unknown) => {
        const message = safeSchedulerError(error);
        // A lease race is expected when multiple replicas see the same due row.
        if (
          !message.includes("already running") &&
          !message.includes("not due")
        ) {
          this.logger.error(`Scheduled watch ${watchId} failed: ${message}`);
        }
      })
      .finally(() => {
        if (this.activeRuns.get(watchId) !== operation) return;
        this.activeRuns.delete(watchId);
        this.syncSchedulerMetrics();
        if (!this.stopping) {
          void this.requestAdmission(this.options.now()).catch(
            (error: unknown) => {
              this.recordAdmissionError(error);
            },
          );
        }
      });
    this.activeRuns.set(watchId, operation);
    this.syncSchedulerMetrics();
  }

  private syncSchedulerMetrics(): void {
    this.metrics.schedulerCapacity.set(this.maxConcurrent());
    this.metrics.schedulerActiveRuns.set(this.activeRuns.size);
  }

  private recordAdmissionError(error: unknown): void {
    if (this.stopping) return;
    this.databaseHealthy = false;
    this.lastError = safeSchedulerError(error);
    this.logger.error(`Watcher scheduler admission failed: ${this.lastError}`);
  }

  private isEnabled(): boolean {
    return this.config?.get<boolean>("watcher.enabled", false) ?? false;
  }

  private pollMs(): number {
    return positiveInteger(
      this.config?.get<number>("watcher.schedulerPollMs", 15_000),
      15_000,
    );
  }

  private maxConcurrent(): number {
    return positiveInteger(
      this.config?.get<number>("watcher.maxConcurrentWatches", 2),
      2,
    );
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function safeSchedulerError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https:\/\/[^\s]+/gi, "[REDACTED_URL]")
    .slice(0, 1_000);
}

function laterDate(current: Date | null, candidate: Date): Date {
  return !current || candidate > current ? candidate : current;
}

async function waitForSettled(
  operations: readonly Promise<void>[],
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(operations).then(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
