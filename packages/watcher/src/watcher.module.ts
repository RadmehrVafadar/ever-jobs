import { Module } from '@nestjs/common';
import { JobFingerprintService } from './services/job-fingerprint.service';
import { JobScoringService } from './services/job-scoring.service';
import { InMemoryWatchRepository } from './persistence/in-memory-watch.repository';
import { NotificationDispatcher, NOTIFICATION_PROVIDERS } from './services/notification-dispatcher.service';
import { DiscordNotificationProvider, TelegramNotificationProvider, WebhookNotificationProvider } from './services/webhook-notification.provider';
import { WatchExecutionService, WATCH_SOURCE_EXECUTOR } from './services/watch-execution.service';
import { DailyDigestService } from './services/daily-digest.service';
import { JobsServiceWatchExecutor } from './services/jobs-service-watch.executor';
@Module({ providers: [JobFingerprintService, JobScoringService, InMemoryWatchRepository, { provide: 'WatchRepository', useExisting: InMemoryWatchRepository }, WebhookNotificationProvider, DiscordNotificationProvider, TelegramNotificationProvider, { provide: NOTIFICATION_PROVIDERS, useFactory: (w: WebhookNotificationProvider, d: DiscordNotificationProvider, t: TelegramNotificationProvider) => [w, d, t], inject: [WebhookNotificationProvider, DiscordNotificationProvider, TelegramNotificationProvider] }, JobsServiceWatchExecutor, { provide: WATCH_SOURCE_EXECUTOR, useExisting: JobsServiceWatchExecutor }, NotificationDispatcher, WatchExecutionService, DailyDigestService], exports: ['WatchRepository', JobFingerprintService, JobScoringService, WatchExecutionService, DailyDigestService] })
export class WatcherModule {}
