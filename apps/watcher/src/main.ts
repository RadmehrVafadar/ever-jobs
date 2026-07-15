import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { WatcherAppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(WatcherAppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  const port = positivePort(process.env.WATCHER_HEALTH_PORT, 3002);
  await app.listen(port, "0.0.0.0");
  Logger.log(
    `Ever Jobs watcher started; health endpoint listening on ${port}`,
    "Watcher",
  );
}

function positivePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : fallback;
}

void bootstrap();
