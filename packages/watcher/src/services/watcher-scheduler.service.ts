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
  activeWatchIds: string[];
}

@Injectable()
export class WatcherSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WatcherSchedulerService.name);
  private readonly activeWatchIds = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private retryPassActive = false;
  private started = false;
  private databaseHealthy = false;
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    private readonly execution: WatchExecutionService,
    private readonly notifications: NotificationDispatcher,
    private readonly digest: DailyDigestService,
    private readonly metrics: WatcherMetricsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log("Watcher scheduler is disabled");
      return;
    }
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
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.activeWatchIds.size > 0) {
      this.logger.log(
        `Watcher shutdown waiting for ${this.activeWatchIds.size} active run(s) to release their leases`,
      );
      const deadline = Date.now() + 30_000;
      while (this.activeWatchIds.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      this.databaseHealthy = await this.repo.healthCheck();
      if (!this.databaseHealthy)
        throw new Error("database health check failed");

      const capacity = Math.max(
        0,
        this.maxConcurrent() - this.activeWatchIds.size,
      );
      if (capacity > 0) {
        const due = await this.repo.listDueWatches(now, capacity * 2);
        for (const watch of due) {
          if (this.activeWatchIds.size >= this.maxConcurrent()) break;
          if (this.activeWatchIds.has(watch.id)) continue;
          this.activeWatchIds.add(watch.id);
          this.metrics.schedulerActiveRuns.set(this.activeWatchIds.size);
          void this.execution
            .runWatch(watch.id, undefined, {
              trigger: "scheduled",
              requireDue: true,
              forceSources: false,
            })
            .catch((error: unknown) => {
              const message = safeSchedulerError(error);
              // A lease race is expected when multiple replicas see the same due row.
              if (
                !message.includes("already running") &&
                !message.includes("not due")
              ) {
                this.logger.error(
                  `Scheduled watch ${watch.id} failed: ${message}`,
                );
              }
            })
            .finally(() => {
              this.activeWatchIds.delete(watch.id);
              this.metrics.schedulerActiveRuns.set(this.activeWatchIds.size);
            });
        }
      }

      if (!this.retryPassActive) {
        this.retryPassActive = true;
        void this.notifications
          .processDue(25)
          .catch((error: unknown) => {
            this.logger.error(
              `Notification retry pass failed: ${safeSchedulerError(error)}`,
            );
          })
          .finally(() => {
            this.retryPassActive = false;
          });
      }

      await this.digest.deliverDue(now);

      this.lastPollAt = now;
      this.lastError = null;
      this.metrics.schedulerLastPoll.set(now.getTime() / 1_000);
    } catch (error: unknown) {
      this.databaseHealthy = false;
      this.lastError = safeSchedulerError(error);
      this.logger.error(`Watcher scheduler poll failed: ${this.lastError}`);
    }
  }

  status(): WatcherSchedulerStatus {
    return {
      enabled: this.isEnabled(),
      started: this.started,
      databaseHealthy: this.databaseHealthy,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      activeWatchIds: [...this.activeWatchIds],
    };
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
