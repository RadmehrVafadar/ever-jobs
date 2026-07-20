import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import {
  defaultInternshipWatch,
  DiscordNotificationProvider,
  JobWatch,
  Page,
  RunWatchOptions,
  WATCH_REPOSITORY,
  WatchExecutionService,
  WatchRepository,
  WatchValidationService,
  validateWatchTargetKeys,
} from "@ever-jobs/watcher";
import { AdminAuth } from "../auth/admin-auth.decorator";
import {
  CreateWatchDto,
  DiscordNotificationTestDto,
  InitializeWatchDto,
  NotificationDeliveryQueryDto,
  ObservedJobQueryDto,
  UpdateMatchStatusDto,
  UpdateWatchDto,
  WatchMatchQueryDto,
  WatchRunQueryDto,
} from "./watch.dto";
import {
  createDiscordTestMessage,
  publicNotificationDelivery,
  publicObservedJob,
  publicWatch,
  toNotificationDeliveryQuery,
  toObservedJobQuery,
  toWatchMatchQuery,
  toWatchRunQuery,
} from "./watch-management.helpers";
import { collectWatchMetrics } from "./watch-metrics";

@ApiTags("Watches")
@ApiSecurity("api-key")
@AdminAuth()
@Controller("api/watches")
export class WatchesController {
  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
    private readonly execution: WatchExecutionService,
    private readonly validation: WatchValidationService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a persistent job watch" })
  @ApiResponse({ status: 201, description: "Watch created." })
  @ApiResponse({ status: 400, description: "Invalid watch configuration." })
  async create(@Body() body: CreateWatchDto): Promise<Record<string, unknown>> {
    const input = this.validation.parseCreate(body);
    return publicWatch(await this.repository.createWatch(input));
  }

  @Post("default")
  @ApiOperation({
    summary: "Create the safe prestige Canada/USA internship watch",
    description:
      "Creates the repository default disabled and in baseline mode. Initialize it before resuming.",
  })
  async createDefault(): Promise<Record<string, unknown>> {
    const input = this.validation.parseCreate(defaultInternshipWatch());
    return publicWatch(await this.repository.createWatch(input));
  }

  @Get()
  @ApiOperation({ summary: "List job watches" })
  async list(): Promise<Array<Record<string, unknown>>> {
    return (await this.repository.listWatches()).map(publicWatch);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a job watch" })
  async get(@Param("id") id: string): Promise<Record<string, unknown>> {
    return publicWatch(await this.requireWatch(id));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a job watch" })
  async patch(
    @Param("id") id: string,
    @Body() body: UpdateWatchDto,
  ): Promise<Record<string, unknown>> {
    const current = await this.requireWatch(id);
    const input = this.validation.parsePatch(body, current);
    return publicWatch(await this.repository.updateWatch(id, input));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a job watch and its dependent history" })
  @ApiResponse({ status: 204, description: "Watch deleted." })
  async remove(@Param("id") id: string): Promise<void> {
    const deleted = await this.repository.deleteWatch(id);
    if (!deleted) throw new NotFoundException(`Watch not found: ${id}`);
  }

  @Post(":id/run")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Run a watch manually without notify-all behavior",
    description:
      "Uninitialized watches are baselined. Initialized watches use recent-only safety semantics.",
  })
  async run(@Param("id") id: string): Promise<unknown> {
    const watch = await this.requireWatch(id);
    const mode = watch.initializedAt ? "recent-only" : "baseline";
    return this.executeWatch(id, mode);
  }

  @Post(":id/initialize")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Baseline current jobs without sending notifications",
  })
  async initialize(
    @Param("id") id: string,
    @Body() body: InitializeWatchDto = {},
  ): Promise<unknown> {
    const watch = await this.requireWatch(id);
    const targetKeys = validateWatchTargetKeys(watch, body.targetKeys);
    return this.executeWatch(id, "baseline", {
      trigger: "initialize",
      forceSources: true,
      ...(targetKeys.length > 0 ? { targetKeys } : {}),
    });
  }

  @Post(":id/pause")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Pause automatic execution for a watch" })
  async pause(@Param("id") id: string): Promise<Record<string, unknown>> {
    await this.requireWatch(id);
    return publicWatch(
      await this.repository.updateWatch(id, { enabled: false }),
    );
  }

  @Post(":id/resume")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Resume automatic execution for a watch" })
  async resume(@Param("id") id: string): Promise<Record<string, unknown>> {
    const watch = await this.requireWatch(id);
    const nextRunAt = watch.nextRunAt ?? new Date();
    return publicWatch(
      await this.repository.updateWatch(id, { enabled: true, nextRunAt }),
    );
  }

  @Get(":id/runs")
  @ApiOperation({ summary: "List paginated run history for a watch" })
  async runs(
    @Param("id") id: string,
    @Query() query: WatchRunQueryDto,
  ): Promise<Page<unknown>> {
    await this.requireWatch(id);
    return this.repository.listRuns(toWatchRunQuery(id, query));
  }

  @Get(":id/runs/:runId")
  @ApiOperation({ summary: "Get one watch run" })
  async runDetail(
    @Param("id") id: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    await this.requireWatch(id);
    const run = await this.repository.getRun(runId);
    if (!run || run.watchId !== id) {
      throw new NotFoundException(`Run not found: ${runId}`);
    }
    return run;
  }

  @Get(":id/matches")
  @ApiOperation({ summary: "List filtered, paginated matches for a watch" })
  async matches(
    @Param("id") id: string,
    @Query() query: WatchMatchQueryDto,
  ): Promise<Page<unknown>> {
    await this.requireWatch(id);
    return this.repository.listMatches(toWatchMatchQuery(id, query));
  }

  @Get(":id/matches/:matchId")
  @ApiOperation({ summary: "Get one watch match" })
  async matchDetail(
    @Param("id") id: string,
    @Param("matchId") matchId: string,
  ): Promise<unknown> {
    await this.requireWatch(id);
    return this.requireMatch(id, matchId);
  }

  @Patch(":id/matches/:matchId/status")
  @ApiOperation({ summary: "Update application workflow status for a match" })
  async updateMatchStatus(
    @Param("id") id: string,
    @Param("matchId") matchId: string,
    @Body() body: UpdateMatchStatusDto,
  ): Promise<unknown> {
    await this.requireWatch(id);
    await this.requireMatch(id, matchId);
    return this.repository.updateMatch(matchId, { status: body.status });
  }

  @Get(":id/metrics")
  @ApiOperation({
    summary: "Get dashboard-ready persisted metrics for a watch",
  })
  async metrics(@Param("id") id: string): Promise<Record<string, unknown>> {
    const watch = await this.requireWatch(id);
    return collectWatchMetrics(this.repository, watch);
  }

  private async requireWatch(id: string): Promise<JobWatch> {
    const watch = await this.repository.getWatch(id);
    if (!watch) throw new NotFoundException(`Watch not found: ${id}`);
    return watch;
  }

  private async requireMatch(id: string, matchId: string) {
    const match = await this.repository.getMatch(matchId);
    if (!match || match.watchId !== id) {
      throw new NotFoundException(`Match not found: ${matchId}`);
    }
    return match;
  }

  private async executeWatch(
    id: string,
    mode: "baseline" | "recent-only",
    options?: RunWatchOptions,
  ): Promise<unknown> {
    try {
      return options
        ? await this.execution.runWatch(id, mode, options)
        : await this.execution.runWatch(id, mode);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLocaleLowerCase("en-CA").includes("already running")) {
        throw new ConflictException(`Watch is already running: ${id}`);
      }
      if (message.toLocaleLowerCase("en-CA").includes("not found")) {
        throw new NotFoundException(`Watch not found: ${id}`);
      }
      throw error;
    }
  }
}

@ApiTags("Observed Jobs")
@ApiSecurity("api-key")
@AdminAuth()
@Controller("api/observed-jobs")
export class ObservedJobsController {
  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
  ) {}

  @Get()
  @ApiOperation({ summary: "List filtered, paginated observed jobs" })
  async list(
    @Query() query: ObservedJobQueryDto,
  ): Promise<Page<Record<string, unknown>>> {
    const page = await this.repository.listObservedJobs(
      toObservedJobQuery(query),
    );
    return { ...page, items: page.items.map(publicObservedJob) };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one observed job" })
  async get(@Param("id") id: string): Promise<Record<string, unknown>> {
    const job = await this.repository.getObservedJob(id);
    if (!job) throw new NotFoundException(`Observed job not found: ${id}`);
    return publicObservedJob(job);
  }
}

@ApiTags("Notifications")
@ApiSecurity("api-key")
@AdminAuth()
@Controller("api/notifications")
export class NotificationsController {
  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
    private readonly discord: DiscordNotificationProvider,
  ) {}

  @Get("deliveries")
  @ApiOperation({ summary: "List filtered notification delivery history" })
  async deliveries(
    @Query() query: NotificationDeliveryQueryDto,
  ): Promise<Page<Record<string, unknown>>> {
    const page = await this.repository.listNotifications(
      toNotificationDeliveryQuery(query),
    );
    return { ...page, items: page.items.map(publicNotificationDelivery) };
  }

  @Get("deliveries/:id")
  @ApiOperation({ summary: "Get one notification delivery" })
  async delivery(@Param("id") id: string): Promise<Record<string, unknown>> {
    const delivery = await this.repository.getNotification(id);
    if (!delivery) {
      throw new NotFoundException(`Notification delivery not found: ${id}`);
    }
    return publicNotificationDelivery(delivery);
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Send a non-persistent Discord configuration test",
    description:
      "Uses the environment-backed Discord webhook. It does not create a fake job, match, or delivery row.",
  })
  async testDiscord(
    @Body() body: DiscordNotificationTestDto,
  ): Promise<Record<string, unknown>> {
    const watch = await this.repository.getWatch(body.watchId);
    if (!watch) {
      throw new NotFoundException(`Watch not found: ${body.watchId}`);
    }
    const result = await this.discord.send(createDiscordTestMessage(watch), {
      type: "discord",
      destinationRef: body.destinationRef ?? "default",
    });
    return { ok: result.status === "sent", result };
  }
}
