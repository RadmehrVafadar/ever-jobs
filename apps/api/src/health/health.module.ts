import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { WatchesModule } from "../watches/watches.module";

@Module({
  imports: [WatchesModule],
  controllers: [HealthController],
})
export class HealthModule {}
