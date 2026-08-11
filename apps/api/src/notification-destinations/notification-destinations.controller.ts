import {
  BadRequestException,
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
  Post,
  Put,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import {
  INotificationSecretStore,
  NOTIFICATION_SECRET_STORE,
  NotificationSecretStatus,
} from "@ever-jobs/plugin";
import {
  DiscordNotificationProvider,
  JobWatch,
  WATCH_REPOSITORY,
  WatchRepository,
} from "@ever-jobs/watcher";
import { AdminAuth } from "../auth/admin-auth.decorator";
import { createDiscordTestMessage } from "../watches/watch-management.helpers";
import {
  SetDiscordDestinationDto,
  TestDiscordDestinationDto,
} from "./notification-destination.dto";

interface PublicDestinationStatus {
  alias: string;
  provider: "discord";
  configured: boolean;
  source: NotificationSecretStatus["source"] | "unconfigured";
}

@ApiTags("Notification destinations")
@ApiSecurity("api-key")
@AdminAuth()
@Controller("api/notification-destinations")
export class NotificationDestinationsController {
  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
    @Inject(NOTIFICATION_SECRET_STORE)
    private readonly secrets: INotificationSecretStore,
    private readonly discord: DiscordNotificationProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: "List masked notification destination aliases" })
  async list(): Promise<PublicDestinationStatus[]> {
    const watches = await this.repository.listWatches();
    const references = destinationReferenceCounts(watches);
    return (await this.secrets.list([...references.keys()])).map(
      publicDestinationStatus,
    );
  }

  @Put(":destinationRef")
  @ApiOperation({
    summary: "Create or rotate a GUI-managed Discord destination",
  })
  @ApiResponse({
    status: 200,
    description: "Returns masked configuration metadata only.",
  })
  async set(
    @Param("destinationRef") destinationRef: string,
    @Body() body: SetDiscordDestinationDto,
  ): Promise<PublicDestinationStatus> {
    try {
      const status = await this.secrets.set(destinationRef, body.webhookUrl);
      return publicDestinationStatus(status);
    } catch (error: unknown) {
      throw safeDestinationError(error);
    }
  }

  @Delete(":destinationRef")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove an unreferenced GUI-managed destination" })
  async remove(@Param("destinationRef") destinationRef: string): Promise<void> {
    const references = destinationReferenceCounts(
      await this.repository.listWatches(),
    );
    if ((references.get(destinationRef) ?? 0) > 0) {
      throw new ConflictException(
        `Destination is referenced by a watch: ${destinationRef}`,
      );
    }
    try {
      const removed = await this.secrets.remove(destinationRef);
      if (!removed) {
        throw new NotFoundException(
          `Notification destination not found: ${destinationRef}`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof NotFoundException) throw error;
      throw safeDestinationError(error);
    }
  }

  @Post(":destinationRef/test")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Send a non-persistent Discord test to a named destination",
  })
  async test(
    @Param("destinationRef") destinationRef: string,
    @Body() body: TestDiscordDestinationDto,
  ): Promise<Record<string, unknown>> {
    const watch = await this.repository.getWatch(body.watchId);
    if (!watch) throw new NotFoundException(`Watch not found: ${body.watchId}`);
    const result = await this.discord.send(createDiscordTestMessage(watch), {
      type: "discord",
      destinationRef,
    });
    return { ok: result.status === "sent", result };
  }
}

function publicDestinationStatus(
  status: NotificationSecretStatus,
): PublicDestinationStatus {
  return {
    alias: status.destinationRef,
    provider: "discord",
    configured: status.configured,
    source: status.source ?? "unconfigured",
  };
}

export function destinationReferenceCounts(
  watches: readonly JobWatch[],
): Map<string, number> {
  const references = new Map<string, number>();
  for (const watch of watches) {
    const watchRefs = new Set<string>();
    for (const channel of watch.notificationChannels) {
      if (channel.type !== "discord") continue;
      watchRefs.add(channel.destinationRef?.trim() || "default");
    }
    for (const route of watch.notificationRoutes ?? []) {
      if (route.provider !== "discord") continue;
      watchRefs.add(route.destinationRef.trim());
    }
    for (const ref of watchRefs) {
      references.set(ref, (references.get(ref) ?? 0) + 1);
    }
  }
  return references;
}

function safeDestinationError(
  error: unknown,
): BadRequestException | ConflictException {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("managed by the process environment")) {
    return new ConflictException(message);
  }
  return new BadRequestException(
    message.includes("Destination reference")
      ? message
      : "Discord destination configuration is invalid",
  );
}
