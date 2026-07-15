import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  WATCH_REPOSITORY,
  WatcherMetricsService,
  WatcherSchedulerService,
  WatchRepository,
} from "@ever-jobs/watcher";

@Controller()
export class WatcherHealthController {
  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    private readonly scheduler: WatcherSchedulerService,
    private readonly metrics: WatcherMetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get("health")
  async health() {
    const database = await this.repo.healthCheck();
    const scheduler = this.scheduler.status();
    const schedulerHealthy =
      !scheduler.enabled ||
      (scheduler.started &&
        scheduler.databaseHealthy &&
        scheduler.lastPollAt !== null &&
        scheduler.lastError === null);
    const body = {
      status: database && schedulerHealthy ? "healthy" : "unhealthy",
      database,
      scheduler,
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
  metricsText(): Promise<string> {
    return this.metrics.render();
  }
}
