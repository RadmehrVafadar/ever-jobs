import { Module } from '@nestjs/common';
import { YelloService } from './yello.service';

@Module({
  providers: [YelloService],
  exports: [YelloService],
})
export class YelloModule {}
