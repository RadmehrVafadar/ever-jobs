import { Inject, Injectable, Optional } from '@nestjs/common';
import { JobNotificationMessage, NotificationProvider, WatchRepository } from '../interfaces/watch.types';
export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
@Injectable()
export class NotificationDispatcher {
  constructor(@Inject('WatchRepository') private readonly repo: WatchRepository, @Optional() @Inject(NOTIFICATION_PROVIDERS) private readonly providers: NotificationProvider[] = []) {}
  async dispatch(message: JobNotificationMessage): Promise<number> { let sent = 0; for (const destination of message.watch.notificationChannels) { const key = `${message.watch.id}:${message.job.id}:${message.type}:${destination.type}:${destination.destination}`; if (await this.repo.hasNotification(key)) continue; const provider = this.providers.find((p) => p.type === destination.type); const result = provider ? await provider.send({ ...message, idempotencyKey: key }, destination) : { status: 'suppressed' as const, errorMessage: 'provider not configured' }; await this.repo.recordNotification({ idempotencyKey: key, watchMatchId: message.match.id, channel: destination.type, provider: provider?.type ?? destination.type, status: result.status, providerResponse: result.providerResponse, errorMessage: result.errorMessage }); if (result.status === 'sent') sent++; } return sent; }
}
