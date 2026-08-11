import { Module } from "@nestjs/common";
import { NOTIFICATION_SECRET_STORE } from "@ever-jobs/plugin";
import { LocalNotificationSecretStore } from "./local-notification-secret.store";

@Module({
  providers: [
    LocalNotificationSecretStore,
    {
      provide: NOTIFICATION_SECRET_STORE,
      useExisting: LocalNotificationSecretStore,
    },
  ],
  exports: [LocalNotificationSecretStore, NOTIFICATION_SECRET_STORE],
})
export class NotificationSecretLocalModule {}
