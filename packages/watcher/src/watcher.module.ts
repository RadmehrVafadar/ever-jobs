import { DynamicModule, Module, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WATCH_REPOSITORY } from "./interfaces/watch.types";
import { InMemoryWatchRepository } from "./persistence/in-memory-watch.repository";
import { PrismaWatchRepository } from "./persistence/prisma-watch.repository";
import {
  WATCHER_PRISMA_EAGER_CONNECT,
  WatcherPrismaService,
} from "./persistence/watcher-prisma.service";
import { JobFingerprintService } from "./services/job-fingerprint.service";
import { JobScoringService } from "./services/job-scoring.service";
import {
  NOTIFICATION_DISPATCH_OPTIONS,
  NOTIFICATION_PROVIDERS,
  NotificationDispatcher,
} from "./services/notification-dispatcher.service";
import { DiscordNotificationProvider } from "./services/discord-notification.provider";
import {
  TelegramNotificationProvider,
  WebhookNotificationProvider,
} from "./services/webhook-notification.provider";
import {
  WATCH_EXECUTION_OPTIONS,
  WATCH_SOURCE_EXECUTOR,
  WatchExecutionService,
} from "./services/watch-execution.service";
import { DailyDigestService } from "./services/daily-digest.service";
import {
  JobsServiceWatchExecutor,
  WATCH_JOBS_SERVICE,
  WATCH_SOURCE_EXECUTION_OPTIONS,
} from "./services/jobs-service-watch.executor";
import { WatchSourcePlanner } from "./services/watch-source-planner.service";
import { WatchValidationService } from "./services/watch-validation.service";
import { WatcherMetricsService } from "./services/watcher-metrics.service";
import { WatcherSchedulerService } from "./services/watcher-scheduler.service";
import { DefaultWatchSeederService } from "./services/default-watch-seeder.service";

export interface WatcherModuleOptions {
  imports?: DynamicModule["imports"];
  jobsServiceToken: string | symbol | Type<unknown>;
  enableScheduler?: boolean;
  useInMemoryRepository?: boolean;
}

@Module({})
export class WatcherModule {
  static register(options: WatcherModuleOptions): DynamicModule {
    const repositoryProviders = options.useInMemoryRepository
      ? [
          InMemoryWatchRepository,
          { provide: WATCH_REPOSITORY, useExisting: InMemoryWatchRepository },
        ]
      : [
          WatcherPrismaService,
          PrismaWatchRepository,
          { provide: WATCH_REPOSITORY, useExisting: PrismaWatchRepository },
        ];
    const schedulerProviders = options.enableScheduler
      ? [DefaultWatchSeederService, WatcherSchedulerService]
      : [];

    return {
      module: WatcherModule,
      imports: options.imports ?? [],
      providers: [
        ...repositoryProviders,
        {
          provide: WATCHER_PRISMA_EAGER_CONNECT,
          useValue: Boolean(options.enableScheduler),
        },
        JobFingerprintService,
        JobScoringService,
        WatchSourcePlanner,
        WatchValidationService,
        WatcherMetricsService,
        WebhookNotificationProvider,
        DiscordNotificationProvider,
        TelegramNotificationProvider,
        {
          provide: NOTIFICATION_PROVIDERS,
          useFactory: (
            webhook: WebhookNotificationProvider,
            discord: DiscordNotificationProvider,
            telegram: TelegramNotificationProvider,
          ) => [webhook, discord, telegram],
          inject: [
            WebhookNotificationProvider,
            DiscordNotificationProvider,
            TelegramNotificationProvider,
          ],
        },
        {
          provide: NOTIFICATION_DISPATCH_OPTIONS,
          useFactory: (config: ConfigService) => ({
            maxAttempts: config.get<number>("watcher.retryAttempts", 3),
            retryBaseDelayMs: config.get<number>(
              "watcher.retryBaseDelayMs",
              500,
            ),
          }),
          inject: [ConfigService],
        },
        { provide: WATCH_JOBS_SERVICE, useExisting: options.jobsServiceToken },
        {
          provide: WATCH_SOURCE_EXECUTION_OPTIONS,
          useFactory: (config: ConfigService) => ({
            maxConcurrency: config.get<number>(
              "watcher.maxConcurrentSources",
              5,
            ),
            timeoutMs: config.get<number>("watcher.sourceTimeoutMs", 12_000),
            retryAttempts: config.get<number>("watcher.retryAttempts", 3),
            retryBaseDelayMs: config.get<number>(
              "watcher.retryBaseDelayMs",
              500,
            ),
          }),
          inject: [ConfigService],
        },
        JobsServiceWatchExecutor,
        {
          provide: WATCH_SOURCE_EXECUTOR,
          useExisting: JobsServiceWatchExecutor,
        },
        {
          provide: WATCH_EXECUTION_OPTIONS,
          useFactory: (config: ConfigService) => {
            const ownerId = config.get<string>("watcher.instanceId");
            return {
              ...(ownerId ? { ownerId } : {}),
              leaseTtlMs: config.get<number>(
                "watcher.schedulerLockTtlMs",
                180_000,
              ),
            };
          },
          inject: [ConfigService],
        },
        NotificationDispatcher,
        WatchExecutionService,
        DailyDigestService,
        ...schedulerProviders,
      ],
      exports: [
        WATCH_REPOSITORY,
        JobFingerprintService,
        JobScoringService,
        WatchSourcePlanner,
        WatchValidationService,
        WatcherMetricsService,
        JobsServiceWatchExecutor,
        NotificationDispatcher,
        WatchExecutionService,
        DailyDigestService,
        ...schedulerProviders,
      ],
    };
  }
}
