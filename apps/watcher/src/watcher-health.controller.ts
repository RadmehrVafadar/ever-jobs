import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  buildCompanyCoverageReport,
  JobWatch,
  WATCH_REPOSITORY,
  WatcherMetricsService,
  WatcherSchedulerService,
  WatchRepository,
} from "@ever-jobs/watcher";
import { MetricsService } from "../../api/src/metrics/metrics.service";

@Controller()
export class WatcherHealthController {
  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    private readonly scheduler: WatcherSchedulerService,
    private readonly metrics: WatcherMetricsService,
    private readonly config: ConfigService,
    private readonly applicationMetrics: MetricsService,
  ) {}

  @Get("health")
  async health() {
    const database = await this.repo.healthCheck();
    const watches = database ? await this.repo.listWatches() : [];
    this.syncWatchMetrics(watches);
    const scheduler = this.scheduler.status();
    const schedulerHealthy =
      !scheduler.enabled ||
      (scheduler.started &&
        scheduler.databaseHealthy &&
        scheduler.lastPollAt !== null &&
        scheduler.lastError === null);
    const coverageWatches = watches.map((watch) => {
      const activeTierOne = new Set(
        watch.sourceTargets.length > 0
          ? watch.sourceTargets
              .filter((target) => target.enabled && target.tier === 1)
              .map((target) =>
                target.companySlug
                  ? `${String(target.site)}:${target.companySlug}`
                  : String(target.site),
              )
          : Object.values(watch.targetHealth ?? {})
              .filter((health) => health.tier === 1)
              .map((health) => health.targetKey),
      );
      const targetHealth = Object.values(watch.targetHealth ?? {}).sort(
        (left, right) => left.targetKey.localeCompare(right.targetKey),
      );
      return {
        watchId: watch.id,
        watchName: watch.name,
        activeTierOneTargetKeys: [...activeTierOne].sort(),
        tier1Degraded: targetHealth.some(
          (health) =>
            activeTierOne.has(health.targetKey) &&
            health.consecutiveHardFailures >= 3,
        ),
        targetHealth,
      };
    });
    const degradedTargets = coverageWatches.flatMap((watch) =>
      watch.targetHealth
        .filter(
          (health) =>
            health.tier === 1 &&
            health.consecutiveHardFailures >= 3 &&
            watch.activeTierOneTargetKeys.includes(health.targetKey),
        )
        .map((health) => ({
          watchId: watch.watchId,
          watchName: watch.watchName,
          ...health,
        })),
    );
    const tier1Degraded = coverageWatches.some((watch) => watch.tier1Degraded);
    const body = {
      status: database && schedulerHealthy ? "healthy" : "unhealthy",
      database,
      scheduler,
      coverage: {
        status: tier1Degraded ? "degraded" : "healthy",
        tier1Degraded,
        degradedTargets,
        watches: coverageWatches,
      },
      notifications: {
        discordConfigured: Boolean(
          this.config.get<string>("watcher.discordWebhookUrl"),
        ),
        status: this.config.get<string>("watcher.discordWebhookUrl")
          ? "configured"
          : "unconfigured",
      },
      timestamp: new Date().toISOString(),
    };
    if (body.status === "unhealthy") {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async metricsText(): Promise<string> {
    try {
      if (await this.repo.healthCheck()) {
        this.syncWatchMetrics(await this.repo.listWatches());
      }
    } catch {
      // Process metrics remain available while durable health is unavailable.
    }
    const [application, watcher] = await Promise.all([
      this.applicationMetrics.getMetrics(),
      this.metrics.render(),
    ]);
    return `${application.trimEnd()}\n${watcher.trimStart()}`;
  }

  private syncWatchMetrics(watches: readonly JobWatch[]): void {
    this.metrics.syncTargetHealth(watches);
    this.metrics.syncCompanyCoverage(
      watches.map((watch) => ({
        watchId: watch.id,
        counts: buildCompanyCoverageReport(watch).summary,
      })),
    );
  }
}
