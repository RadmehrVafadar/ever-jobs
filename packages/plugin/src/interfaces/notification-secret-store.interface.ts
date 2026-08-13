export const NOTIFICATION_SECRET_STORE = Symbol.for(
  "@ever-jobs/plugin/NotificationSecretStore",
);

export type NotificationSecretSource = "environment" | "local";

export interface NotificationSecretStatus {
  destinationRef: string;
  environmentVariable: string;
  configured: boolean;
  source?: NotificationSecretSource;
  readOnly: boolean;
}

/**
 * Replaceable secret-resolution contract for notification providers.
 * Implementations must never expose secret values through status methods.
 */
export interface INotificationSecretStore {
  resolve(destinationRef: string): Promise<string | undefined>;
  list(
    destinationRefs?: readonly string[],
  ): Promise<NotificationSecretStatus[]>;
  set(
    destinationRef: string,
    secret: string,
  ): Promise<NotificationSecretStatus>;
  remove(destinationRef: string): Promise<boolean>;
}
