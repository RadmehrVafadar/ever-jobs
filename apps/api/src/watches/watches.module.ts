import { Module } from '@nestjs/common';
import { WatcherModule } from '@ever-jobs/watcher';
import { WatchesController } from './watches.controller';
@Module({ imports: [WatcherModule], controllers: [WatchesController] })
export class WatchesModule {}
