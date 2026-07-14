import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { defaultInternshipWatch, JobWatch, WatchExecutionService, WatchRepository } from '@ever-jobs/watcher';
import { Inject } from '@nestjs/common';
@ApiTags('watches')
@Controller('api/watches')
export class WatchesController { constructor(@Inject('WatchRepository') private readonly repo: WatchRepository, private readonly execution: WatchExecutionService) {}
  @Post() create(@Body() body: Partial<JobWatch>) { return this.repo.createWatch(body); }
  @Post('default') createDefault() { return this.repo.createWatch(defaultInternshipWatch()); }
  @Get() list() { return this.repo.listWatches(); }
  @Get(':id') get(@Param('id') id: string) { return this.repo.getWatch(id); }
  @Patch(':id') patch(@Param('id') id: string, @Body() body: Partial<JobWatch>) { return this.repo.updateWatch(id, body); }
  @Post(':id/run') run(@Param('id') id: string) { return this.execution.runWatch(id, 'notify-all'); }
  @Post(':id/initialize') initialize(@Param('id') id: string) { return this.execution.runWatch(id, 'baseline'); }
  @Post(':id/pause') pause(@Param('id') id: string) { return this.repo.updateWatch(id, { enabled: false }); }
  @Post(':id/resume') resume(@Param('id') id: string) { return this.repo.updateWatch(id, { enabled: true }); }
}
