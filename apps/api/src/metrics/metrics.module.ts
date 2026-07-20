import { Global, Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsController } from "./metrics.controller";

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsProvidersModule {}

@Global()
@Module({
  imports: [MetricsProvidersModule],
  controllers: [MetricsController],
  exports: [MetricsProvidersModule],
})
export class MetricsModule {}
