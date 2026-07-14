import { Module } from '@nestjs/common';
import { JobsModule } from '../../api/src/jobs/jobs.module';
import { AppConfigModule } from '../../api/src/config/config.module';
import { MetricsModule } from '../../api/src/metrics/metrics.module';
import { WatcherModule } from '@ever-jobs/watcher';
@Module({ imports: [AppConfigModule, MetricsModule, JobsModule, WatcherModule] })
export class WatcherAppModule {}
