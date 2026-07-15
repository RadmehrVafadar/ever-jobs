import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

export const WATCHER_PRISMA_EAGER_CONNECT = Symbol(
  "WATCHER_PRISMA_EAGER_CONNECT",
);

/**
 * Owns the process-local Prisma connection pool used by the watcher.
 * Nest starts and drains the pool with the application lifecycle.
 */
@Injectable()
export class WatcherPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Optional()
    @Inject(WATCHER_PRISMA_EAGER_CONNECT)
    private readonly eagerConnect = false,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (this.eagerConnect) {
      await this.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Prisma's disconnect is safe even when no lazy query opened a pool.
    await this.$disconnect();
  }
}
