import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpClient } from "@ever-jobs/common";
import {
  INotificationSecretStore,
  NOTIFICATION_SECRET_STORE,
} from "@ever-jobs/plugin";
import {
  JobWatch,
  WATCH_REPOSITORY,
  WatchRepository,
  watchSourceTargetKey,
} from "@ever-jobs/watcher";

export const WORKER_HEALTH_CLIENT = Symbol.for(
  "@ever-jobs/api/WorkerHealthClient",
);

export interface WorkerHealthClient {
  get<T>(
    url: string,
    config?: { validateStatus?(status: number): boolean },
  ): Promise<{ data: T }>;
}

type HealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unavailable"
  | "configured"
  | "unconfigured";

interface WorkerHealthResponse {
  status?: string;
  timestamp?: string;
  scheduler?: {
    enabled?: boolean;
    started?: boolean;
    databaseHealthy?: boolean;
    lastPollAt?: string | null;
    lastError?: string | null;
  };
  notifications?: {
    discordConfigured?: boolean;
    status?: string;
  };
}

export interface OperatorOverview {
  status: HealthState;
  api: { status: HealthState; uptime: number; version: string };
  database: { status: HealthState };
  worker: { status: HealthState; lastSeenAt: string | null };
  scheduler: {
    status: HealthState;
    enabled: boolean;
    lastPollAt: string | null;
  };
  notifications: {
    status: HealthState;
    discordConfigured: boolean;
  };
  sourceCoverage: {
    status: HealthState;
    configured: number;
    degraded: number;
    tier1Degraded: boolean;
  };
  counts: {
    watches: number;
    activeWatches: number;
    recentMatches: number;
    failedDeliveries: number;
  };
  generatedAt: string;
}

@Injectable()
export class OperatorOverviewService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: ConfigService,
    @Inject(WATCH_REPOSITORY) private readonly repository: WatchRepository,
    @Inject(NOTIFICATION_SECRET_STORE)
    private readonly secrets: INotificationSecretStore,
    @Inject(WORKER_HEALTH_CLIENT)
    private readonly workerClient: WorkerHealthClient,
  ) {}

  async getOverview(): Promise<OperatorOverview> {
    const generatedAt = new Date();
    const databaseHealthy = await this.safeDatabaseHealth();
    const watches = databaseHealthy ? await this.safeWatches() : [];
    const [worker, destinationStatuses, recentMatches, failedDeliveries] =
      await Promise.all([
        this.workerHealth(),
        this.secrets.list().catch(() => []),
        databaseHealthy
          ? this.repository
              .listMatches({
                limit: 1,
                matchedAfter: new Date(generatedAt.getTime() - 86_400_000),
              })
              .then((page) => page.total)
              .catch(() => 0)
          : Promise.resolve(0),
        databaseHealthy
          ? this.repository
              .listNotifications({
                limit: 1,
                status: "failed",
                createdAfter: new Date(generatedAt.getTime() - 86_400_000),
              })
              .then((page) => page.total)
              .catch(() => 0)
          : Promise.resolve(0),
      ]);

    const coverage = databaseHealthy
      ? summarizeCoverage(watches)
      : {
          status: "unavailable" as const,
          configured: 0,
          degraded: 0,
          tier1Degraded: false,
        };
    const discordConfigured = destinationStatuses.some(
      (destination) => destination.configured,
    );
    const scheduler = worker.body?.scheduler;
    const schedulerHealthy = Boolean(
      scheduler &&
      (!scheduler.enabled ||
        (scheduler.started &&
          scheduler.databaseHealthy &&
          scheduler.lastPollAt &&
          !scheduler.lastError)),
    );
    const schedulerStatus: HealthState =
      worker.status === "unavailable"
        ? "unavailable"
        : schedulerHealthy
          ? "healthy"
          : "unhealthy";
    const status: HealthState = !databaseHealthy
      ? "unhealthy"
      : worker.status !== "healthy" ||
          schedulerStatus !== "healthy" ||
          coverage.tier1Degraded
        ? "degraded"
        : "healthy";

    return {
      status,
      api: {
        status: "healthy",
        uptime: Math.floor((Date.now() - this.startedAt) / 1_000),
        version: this.config.get<string>("npm_package_version", "0.1.0"),
      },
      database: { status: databaseHealthy ? "healthy" : "unhealthy" },
      worker: {
        status: worker.status,
        lastSeenAt: worker.body?.timestamp ?? null,
      },
      scheduler: {
        status: schedulerStatus,
        enabled: Boolean(scheduler?.enabled),
        lastPollAt: scheduler?.lastPollAt ?? null,
      },
      notifications: {
        status: discordConfigured ? "configured" : "unconfigured",
        discordConfigured,
      },
      sourceCoverage: coverage,
      counts: {
        watches: watches.length,
        activeWatches: watches.filter((watch) => watch.enabled).length,
        recentMatches,
        failedDeliveries,
      },
      generatedAt: generatedAt.toISOString(),
    };
  }

  private async safeDatabaseHealth(): Promise<boolean> {
    try {
      return await this.repository.healthCheck();
    } catch {
      return false;
    }
  }

  private async safeWatches(): Promise<JobWatch[]> {
    try {
      return await this.repository.listWatches();
    } catch {
      return [];
    }
  }

  private async workerHealth(): Promise<{
    status: HealthState;
    body?: WorkerHealthResponse;
  }> {
    const url = this.config.get<string>(
      "watcher.healthUrl",
      "http://127.0.0.1:3002/health",
    );
    try {
      const response = await this.workerClient.get<WorkerHealthResponse>(url, {
        // The worker intentionally returns 503 with a structured health body.
        // Accept it so "unhealthy" remains distinct from a connection failure.
        validateStatus: (status) => status >= 200 && status < 600,
      });
      return {
        status: response.data.status === "healthy" ? "healthy" : "unhealthy",
        body: response.data,
      };
    } catch {
      return { status: "unavailable" };
    }
  }
}

function summarizeCoverage(watches: readonly JobWatch[]): {
  status: HealthState;
  configured: number;
  degraded: number;
  tier1Degraded: boolean;
} {
  let configured = 0;
  let degraded = 0;
  let tier1Degraded = false;

  for (const watch of watches) {
    const enabledTargets = new Map(
      watch.sourceTargets
        .filter((target) => target.enabled)
        .map((target) => [watchSourceTargetKey(target), target.tier]),
    );
    configured += enabledTargets.size;
    for (const health of Object.values(watch.targetHealth ?? {})) {
      const tier = enabledTargets.get(health.targetKey);
      if (tier === undefined || health.consecutiveHardFailures < 3) continue;
      degraded += 1;
      if (tier === 1) tier1Degraded = true;
    }
  }

  return {
    status: tier1Degraded ? "degraded" : "healthy",
    configured,
    degraded,
    tier1Degraded,
  };
}

export function createWorkerHealthClient(): WorkerHealthClient {
  return new HttpClient({ timeout: 1, retries: 0 });
}
