import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WATCH_REPOSITORY, WatchRepository } from "../interfaces/watch.types";
import {
  canadianTechInternshipsWatch,
  CANADIAN_TECH_INTERNSHIPS_NAME,
} from "./canadian-tech-internships.preset";

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
    // This is a fresh-install seed only. An existing legacy or custom
    // watch is operator-owned and must never be duplicated or upgraded during
    // application bootstrap.
    if ((await this.repository.listWatches()).length > 0) return;

    const watch = await this.repository.createWatch(
      canadianTechInternshipsWatch(),
    );
    this.logger.log(
      `Created disabled ${CANADIAN_TECH_INTERNSHIPS_NAME} watch watchId=${watch.id}; initialize targets then resume it to enable alerts`,
    );
  }
}
