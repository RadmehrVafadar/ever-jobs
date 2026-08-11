import { Module } from "@nestjs/common";
import { WatcherModule } from "@ever-jobs/watcher";
import { NotificationSecretLocalModule } from "@ever-jobs/notification-secret-local";
import { JobsModule } from "../jobs/jobs.module";
import { JobsService } from "../jobs/jobs.service";
import {
  NotificationsController,
  ObservedJobsController,
  WatchesController,
} from "./watches.controller";
import { WatchApplyService } from "./watch-apply.service";

@Module({
  imports: [
    WatcherModule.register({
      imports: [JobsModule, NotificationSecretLocalModule],
      jobsServiceToken: JobsService,
      enableScheduler: false,
    }),
  ],
  controllers: [
    WatchesController,
    ObservedJobsController,
    NotificationsController,
  ],
  providers: [WatchApplyService],
  exports: [WatcherModule],
})
export class WatchesModule {}
