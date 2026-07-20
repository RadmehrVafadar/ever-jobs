import { Module } from "@nestjs/common";
import { WatcherModule } from "@ever-jobs/watcher";
import { AppConfigModule } from "../../api/src/config/config.module";
import { AppCacheModule } from "../../api/src/cache/cache.module";
import { JobsModule } from "../../api/src/jobs/jobs.module";
import { JobsService } from "../../api/src/jobs/jobs.service";
import { MetricsProvidersModule } from "../../api/src/metrics/metrics.module";
import { WatcherHealthController } from "./watcher-health.controller";

@Module({
  imports: [
    AppConfigModule,
    AppCacheModule,
    MetricsProvidersModule,
    WatcherModule.register({
      imports: [JobsModule],
      jobsServiceToken: JobsService,
      enableScheduler: true,
    }),
  ],
  controllers: [WatcherHealthController],
})
export class WatcherAppModule {}
