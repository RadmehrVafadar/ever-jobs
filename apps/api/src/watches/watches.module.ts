import { Module } from "@nestjs/common";
import { WatcherModule } from "@ever-jobs/watcher";
import { JobsModule } from "../jobs/jobs.module";
import { JobsService } from "../jobs/jobs.service";
import {
  NotificationsController,
  ObservedJobsController,
  WatchesController,
} from "./watches.controller";

@Module({
  imports: [
    WatcherModule.register({
      imports: [JobsModule],
      jobsServiceToken: JobsService,
      enableScheduler: false,
    }),
  ],
  controllers: [
    WatchesController,
    ObservedJobsController,
    NotificationsController,
  ],
})
export class WatchesModule {}
