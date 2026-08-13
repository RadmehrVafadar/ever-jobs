import { Module } from '@nestjs/common';
import { AccentureService } from './accenture.service';

@Module({
  providers: [AccentureService],
  exports: [AccentureService],
})
export class AccentureModule {}
