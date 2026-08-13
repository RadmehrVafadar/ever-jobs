import { Module } from "@nestjs/common";
import { NotificationSecretLocalModule } from "@ever-jobs/notification-secret-local";
import { WatchesModule } from "../watches/watches.module";
import { OperatorOverviewController } from "./operator-overview.controller";
import {
  createWorkerHealthClient,
  OperatorOverviewService,
  WORKER_HEALTH_CLIENT,
} from "./operator-overview.service";

@Module({
  imports: [WatchesModule, NotificationSecretLocalModule],
  controllers: [OperatorOverviewController],
  providers: [
    OperatorOverviewService,
    {
      provide: WORKER_HEALTH_CLIENT,
      useFactory: createWorkerHealthClient,
    },
  ],
})
export class OperatorModule {}
