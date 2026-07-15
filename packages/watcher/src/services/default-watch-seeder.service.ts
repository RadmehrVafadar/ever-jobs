import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WATCH_REPOSITORY, WatchRepository } from "../interfaces/watch.types";
import { defaultInternshipWatch } from "./default-watch";

const DEFAULT_WATCH_NAME = "Toronto and Canada Software Internships";

/**
 * Creates the safe, disabled baseline watch on a fresh deployment.
 *
 * Existing watches are never overwritten: source cadence, initialization
 * state, enablement, and user edits remain durable across restarts.
 */
@Injectable()
export class DefaultWatchSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DefaultWatchSeederService.name);

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repository: WatchRepository,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config?.get<boolean>("watcher.seedDefault", true) === false)
      return;
    const existing = (await this.repository.listWatches()).some(
      (watch) => watch.name === DEFAULT_WATCH_NAME,
    );
    if (existing) return;

    const watch = await this.repository.createWatch(defaultInternshipWatch());
    this.logger.log(
      `Created disabled baseline watch watchId=${watch.id}; initialize then resume it to enable alerts`,
    );
  }
}
