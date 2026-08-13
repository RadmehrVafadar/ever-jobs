import { Module } from "@nestjs/common";
import { NotificationSecretLocalModule } from "@ever-jobs/notification-secret-local";
import { WatchesModule } from "../watches/watches.module";
import { NotificationDestinationsController } from "./notification-destinations.controller";

@Module({
  imports: [WatchesModule, NotificationSecretLocalModule],
  controllers: [NotificationDestinationsController],
})
export class NotificationDestinationsModule {}
