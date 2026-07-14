import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WatcherAppModule } from './app.module';
async function bootstrap() { const app = await NestFactory.createApplicationContext(WatcherAppModule); Logger.log('Ever Jobs watcher started', 'Watcher'); process.on('SIGTERM', async () => app.close()); }
bootstrap();
