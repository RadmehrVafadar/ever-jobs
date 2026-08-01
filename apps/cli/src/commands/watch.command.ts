import { Inject } from "@nestjs/common";
import { Command, CommandRunner, Option } from "nest-commander";
import * as fs from "fs";
import {
  buildCompanyCoverageReport,
  defaultInternshipWatch,
  DiscordNotificationProvider,
  JobWatch,
  WATCH_REPOSITORY,
  WatchExecutionService,
  WatchMatchStatus,
  WatchPresetApplyResult,
  WatchPresetService,
  WatchRepository,
  WatchValidationService,
  validateWatchTargetKeys,
} from "@ever-jobs/watcher";
import {
  createDiscordTestMessage,
  publicNotificationDelivery,
  publicObservedJob,
  publicWatch,
} from "../../../api/src/watches/watch-management.helpers";
import { collectWatchMetrics } from "../../../api/src/watches/watch-metrics";

interface WatchOptions {
  config?: string;
  id?: string;
  json?: boolean;
  offset?: number;
  limit?: number;
  status?: string;
  company?: string;
  source?: string;
  location?: string;
  minimumScore?: number;
  employmentType?: string;
  workplaceType?: string;
  destinationRef?: string;
  target?: string[];
  watch?: string;
  apply?: boolean;
}

const MATCH_STATUSES = new Set<WatchMatchStatus>([
  "new",
  "reviewed",
  "applied",
  "dismissed",
  "interview",
  "rejected",
  "offer",
]);

@Command({
  name: "watch",
  description: "Manage persistent job watches and watcher history",
})
export class WatchCommand extends CommandRunner {
  private readonly validation = new WatchValidationService();
  private readonly discord = new DiscordNotificationProvider();

  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
    private readonly execution: WatchExecutionService,
    private readonly presets: WatchPresetService,
  ) {
    super();
  }

  async run(params: string[], options: WatchOptions): Promise<void> {
    const [action, id, value] = params;
    let result: unknown;

    switch (action) {
      case "create":
        result = await this.create(options.config);
        break;
      case "update":
        result = await this.update(
          requireArgument(id, "watch id"),
          options.config,
        );
        break;
      case "list":
        result = (await this.repository.listWatches()).map(publicWatch);
        break;
      case "show":
        result = publicWatch(
          await this.requireWatch(requireArgument(id, "watch id")),
        );
        break;
      case "delete": {
        const watchId = requireArgument(id, "watch id");
        await this.requireWatch(watchId);
        result = {
          deleted: await this.repository.deleteWatch(watchId),
          watchId,
        };
        break;
      }
      case "run":
        result = await this.runSafely(requireArgument(id, "watch id"));
        break;
      case "initialize": {
        const watchId = requireArgument(id, "watch id");
        const watch = await this.requireWatch(watchId);
        const targetKeys = validateWatchTargetKeys(watch, options.target);
        result = await this.execution.runWatch(watchId, "baseline", {
          trigger: "initialize",
          forceSources: true,
          ...(targetKeys.length > 0 ? { targetKeys } : {}),
        });
        break;
      }
      case "preset": {
        if (id !== "apply") {
          throw new Error(`Unknown preset action: ${id ?? ""}. ${usage()}`);
        }
        const presetId = requireArgument(value, "preset id");
        const watchId = requireArgument(options.watch, "--watch <id>");
        result = publicPresetResult(
          await this.presets.apply(presetId, watchId, {
            apply: options.apply === true,
          }),
        );
        break;
      }
      case "pause":
        result = publicWatch(
          await this.setEnabled(requireArgument(id, "watch id"), false),
        );
        break;
      case "resume":
        result = publicWatch(
          await this.setEnabled(requireArgument(id, "watch id"), true),
        );
        break;
      case "runs": {
        const watchId = requireArgument(id, "watch id");
        await this.requireWatch(watchId);
        result = await this.repository.listRuns({
          watchId,
          ...pageOptions(options),
          status: runStatus(options.status),
        });
        break;
      }
      case "matches": {
        const watchId = requireArgument(id, "watch id");
        await this.requireWatch(watchId);
        result = await this.repository.listMatches({
          watchId,
          ...pageOptions(options),
          status: matchStatus(options.status),
          minimumScore: options.minimumScore,
          company: options.company,
          source: options.source,
          location: options.location,
          employmentType: options.employmentType,
          workplaceType: options.workplaceType,
        });
        break;
      }
      case "match-status": {
        const matchId = requireArgument(id, "match id");
        const status = matchStatus(requireArgument(value, "match status"));
        if (!status) throw new Error("A match status is required");
        const match = await this.repository.getMatch(matchId);
        if (!match) throw new Error(`Match not found: ${matchId}`);
        result = await this.repository.updateMatch(matchId, { status });
        break;
      }
      case "metrics": {
        const watch = await this.requireWatch(requireArgument(id, "watch id"));
        result = await collectWatchMetrics(this.repository, watch);
        break;
      }
      case "coverage": {
        const watchId = requireArgument(
          id ?? options.id ?? options.watch,
          "watch id",
        );
        result = buildCompanyCoverageReport(await this.requireWatch(watchId));
        break;
      }
      case "observed-jobs": {
        const page = await this.repository.listObservedJobs({
          ...pageOptions(options),
          company: options.company,
          source: options.source,
          location: options.location,
          employmentType: options.employmentType,
          workplaceType: options.workplaceType,
        });
        result = { ...page, items: page.items.map(publicObservedJob) };
        break;
      }
      case "deliveries": {
        if (id) await this.requireWatch(id);
        const page = await this.repository.listNotifications({
          ...pageOptions(options),
          watchId: id,
          status: notificationStatus(options.status),
          channel: "discord",
        });
        result = {
          ...page,
          items: page.items.map(publicNotificationDelivery),
        };
        break;
      }
      case "notifications-test": {
        const watch = await this.requireWatch(requireArgument(id, "watch id"));
        const notification = await this.discord.send(
          createDiscordTestMessage(watch),
          {
            type: "discord",
            destinationRef: options.destinationRef ?? "default",
          },
        );
        result = { ok: notification.status === "sent", result: notification };
        break;
      }
      default:
        throw new Error(usage());
    }

    process.stdout.write(
      `${JSON.stringify(result, null, options.json ? 2 : 0)}\n`,
    );
  }

  @Option({
    flags: "-c, --config <path>",
    description: "JSON watch configuration for create/update",
  })
  parseConfig(value: string): string {
    return value;
  }

  @Option({ flags: "--json", description: "Pretty-print JSON output" })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: "--id <id>", description: "Watch ID" })
  parseId(value: string): string {
    return value;
  }

  @Option({ flags: "--offset <count>", description: "Pagination offset" })
  parseOffset(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("--offset must be a non-negative integer");
    }
    return parsed;
  }

  @Option({ flags: "--limit <count>", description: "Page size (1-200)" })
  parseLimit(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      throw new Error("--limit must be between 1 and 200");
    }
    return parsed;
  }

  @Option({ flags: "--status <status>", description: "Status filter" })
  parseStatus(value: string): string {
    return value;
  }

  @Option({ flags: "--company <company>", description: "Company filter" })
  parseCompany(value: string): string {
    return value;
  }

  @Option({ flags: "--source <source>", description: "Source filter" })
  parseSource(value: string): string {
    return value;
  }

  @Option({ flags: "--location <location>", description: "Location filter" })
  parseLocation(value: string): string {
    return value;
  }

  @Option({
    flags: "--minimum-score <score>",
    description: "Minimum match score",
  })
  parseMinimumScore(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error("--minimum-score must be a non-negative integer");
    }
    return parsed;
  }

  @Option({ flags: "--employment-type <type>" })
  parseEmploymentType(value: string): string {
    return value;
  }

  @Option({ flags: "--workplace-type <type>" })
  parseWorkplaceType(value: string): string {
    return value;
  }

  @Option({
    flags: "--destination-ref <ref>",
    description: "Discord destination reference (default)",
  })
  parseDestinationRef(value: string): string {
    if (!["default", "DISCORD_WEBHOOK_URL"].includes(value)) {
      throw new Error(
        "--destination-ref must be default or DISCORD_WEBHOOK_URL",
      );
    }
    return value;
  }

  @Option({
    flags: "--target <key>",
    description: "Initialize one target key; repeat for additional targets",
  })
  parseTarget(value: string, previous: string[] | undefined): string[] {
    return [...(previous ?? []), value];
  }

  @Option({
    flags: "--watch <id>",
    description: "Watch ID used by preset apply or coverage",
  })
  parseWatch(value: string): string {
    return value;
  }

  @Option({
    flags: "--apply",
    description: "Apply a preset diff to a paused watch (default: dry-run)",
  })
  parseApply(): boolean {
    return true;
  }

  private async create(configPath: string | undefined) {
    const raw = configPath
      ? readJsonFile(configPath)
      : defaultInternshipWatch();
    const input = this.validation.parseCreate(raw);
    return publicWatch(await this.repository.createWatch(input));
  }

  private async update(id: string, configPath: string | undefined) {
    if (!configPath) throw new Error("watch update requires --config <path>");
    const current = await this.requireWatch(id);
    const input = this.validation.parsePatch(readJsonFile(configPath), current);
    return publicWatch(await this.repository.updateWatch(id, input));
  }

  private async runSafely(id: string) {
    const watch = await this.requireWatch(id);
    return this.execution.runWatch(
      id,
      watch.initializedAt ? "recent-only" : "baseline",
    );
  }

  private async setEnabled(id: string, enabled: boolean): Promise<JobWatch> {
    const watch = await this.requireWatch(id);
    return this.repository.updateWatch(id, {
      enabled,
      ...(enabled ? { nextRunAt: watch.nextRunAt ?? new Date() } : {}),
    });
  }

  private async requireWatch(id: string): Promise<JobWatch> {
    const watch = await this.repository.getWatch(id);
    if (!watch) throw new Error(`Watch not found: ${id}`);
    return watch;
  }
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error: unknown) {
    const reason =
      error instanceof SyntaxError ? "invalid JSON" : "unreadable file";
    throw new Error(`Unable to load watch configuration (${reason}): ${path}`);
  }
}

function pageOptions(options: WatchOptions): { offset: number; limit: number } {
  return { offset: options.offset ?? 0, limit: options.limit ?? 50 };
}

function requireArgument(value: string | undefined, label: string): string {
  if (!value) throw new Error(`Missing ${label}. ${usage()}`);
  return value;
}

function matchStatus(value: string | undefined): WatchMatchStatus | undefined {
  if (value === undefined) return undefined;
  if (!MATCH_STATUSES.has(value as WatchMatchStatus)) {
    throw new Error(`Invalid match status: ${value}`);
  }
  return value as WatchMatchStatus;
}

function runStatus(value: string | undefined) {
  if (value === undefined) return undefined;
  const statuses = ["running", "completed", "failed", "partial"] as const;
  if (!statuses.includes(value as (typeof statuses)[number])) {
    throw new Error(`Invalid run status: ${value}`);
  }
  return value as (typeof statuses)[number];
}

function notificationStatus(value: string | undefined) {
  if (value === undefined) return undefined;
  const statuses = ["pending", "sent", "failed", "suppressed"] as const;
  if (!statuses.includes(value as (typeof statuses)[number])) {
    throw new Error(`Invalid notification status: ${value}`);
  }
  return value as (typeof statuses)[number];
}

function publicPresetResult(result: WatchPresetApplyResult): Omit<
  WatchPresetApplyResult,
  "watch"
> & {
  watch?: Record<string, unknown>;
} {
  const { watch, ...publicResult } = result;
  return watch ? { ...publicResult, watch: publicWatch(watch) } : publicResult;
}

function usage(): string {
  return [
    "Usage: watch create|update <id>|list|show <id>|delete <id>|run <id>",
    "|initialize <id>|pause <id>|resume <id>|runs <id>|matches <id>",
    "|match-status <match-id> <status>|metrics <id>|coverage <id>|observed-jobs",
    "|deliveries [watch-id]|notifications-test <watch-id>",
    "|preset apply <preset-id> --watch <id> [--apply]",
  ].join(" ");
}
