import { Command, CommandRunner, Option } from 'nest-commander';
import * as fs from 'fs';
import { Inject } from '@nestjs/common';
import { defaultInternshipWatch, JobWatch, WatchExecutionService, WatchRepository } from '@ever-jobs/watcher';
interface WatchOptions { config?: string; json?: boolean; }
@Command({ name: 'watch', description: 'Manage persistent job watches' })
export class WatchCommand extends CommandRunner { constructor(@Inject('WatchRepository') private readonly repo: WatchRepository, private readonly execution: WatchExecutionService) { super(); }
  async run(params: string[], options: WatchOptions): Promise<void> { const [action, id] = params; let result: unknown; if (action === 'create') { const input = options.config ? JSON.parse(fs.readFileSync(options.config, 'utf8')) : defaultInternshipWatch(); result = await this.repo.createWatch(input as Partial<JobWatch>); } else if (action === 'list') result = await this.repo.listWatches(); else if (action === 'show' && id) result = await this.repo.getWatch(id); else if (action === 'run' && id) result = await this.execution.runWatch(id, 'notify-all'); else if (action === 'initialize' && id) result = await this.execution.runWatch(id, 'baseline'); else if (action === 'pause' && id) result = await this.repo.updateWatch(id, { enabled: false }); else if (action === 'resume' && id) result = await this.repo.updateWatch(id, { enabled: true }); else throw new Error('Usage: watch create|list|show <id>|run <id>|initialize <id>|pause <id>|resume <id>'); console.log(JSON.stringify(result, null, options.json ? 2 : 0)); }
  @Option({ flags: '-c, --config <path>' }) parseConfig(v: string) { return v; }
  @Option({ flags: '--json' }) parseJson() { return true; }
}
