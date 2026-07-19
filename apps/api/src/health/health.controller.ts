import {
  Controller,
  Get,
  Inject,
  Logger,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { WATCH_REPOSITORY, WatchRepository } from "@ever-jobs/watcher";

@ApiTags("Health")
@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly config: ConfigService,
    @Inject(WATCH_REPOSITORY) private readonly watches: WatchRepository,
  ) {}

  @Get("health")
  @ApiOperation({
    summary: "Health check",
    description:
      "Returns the health status of the API including uptime, version, memory usage.",
  })
  async health() {
    const mem = process.memoryUsage();
    const watcherCoverage = await this.watcherCoverage();
    return {
      status: "healthy",
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: this.config.get<string>("npm_package_version", "0.1.0"),
      environment: this.config.get<string>("environment", "development"),
      timestamp: new Date().toISOString(),
      memoryUsage: {
        rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
        heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
      },
      watcherCoverage,
    };
  }

  @Get("ping")
  @ApiOperation({
    summary: "Ping",
    description: "Simple ping endpoint for monitoring.",
  })
  ping() {
    return { status: "pong", timestamp: new Date().toISOString() };
  }

  private async watcherCoverage(): Promise<Record<string, unknown>> {
    try {
      const watches = await this.watches.listWatches();
      const watchHealth = watches.map((watch) => {
        const activeTierOneKeys = new Set(
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
          tier1Degraded: targetHealth.some(
            (health) =>
              activeTierOneKeys.has(health.targetKey) &&
              health.consecutiveHardFailures >= 3,
          ),
          targetHealth,
        };
      });
      const tier1Degraded = watchHealth.some((watch) => watch.tier1Degraded);
      return {
        status: tier1Degraded ? "degraded" : "healthy",
        tier1Degraded,
        watches: watchHealth,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Watcher coverage unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        status: "unavailable",
        tier1Degraded: null,
        watches: [],
      };
    }
  }
}
