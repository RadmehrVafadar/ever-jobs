import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  WATCH_REPOSITORY,
  WatchMatch,
  WatchRepository,
} from "../interfaces/watch.types";
import { NotificationDispatcher } from "./notification-dispatcher.service";

@Injectable()
export class DailyDigestService {
  private readonly completedLocalDates = new Map<string, string>();

  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repo: WatchRepository,
    @Optional() private readonly dispatcher?: NotificationDispatcher,
    @Optional() private readonly config?: ConfigService,
  ) {}

  selectDigestMatches(
    watchId: string,
    digestScore: number,
    minimumScore: number,
  ): Promise<WatchMatch[]> {
    return this.repo.listDigestMatches(watchId, digestScore, minimumScore);
  }

  async deliverDue(now = new Date()): Promise<{
    watchesProcessed: number;
    matchesProcessed: number;
    notificationsSent: number;
  }> {
    if (
      !this.dispatcher ||
      this.config?.get<boolean>("watcher.digestEnabled", true) === false
    ) {
      return { watchesProcessed: 0, matchesProcessed: 0, notificationsSent: 0 };
    }
    const digestHour = this.config?.get<number>("watcher.digestHour", 8) ?? 8;
    const digestMinute =
      this.config?.get<number>("watcher.digestMinute", 0) ?? 0;
    let watchesProcessed = 0;
    let matchesProcessed = 0;
    let notificationsSent = 0;

    for (const watch of await this.repo.listWatches()) {
      if (!watch.enabled || !watch.initializedAt) continue;
      const local = localClock(now, watch.timezone);
      if (local.hour * 60 + local.minute < digestHour * 60 + digestMinute)
        continue;
      if (this.completedLocalDates.get(watch.id) === local.date) continue;

      const matches = (
        await this.selectDigestMatches(
          watch.id,
          watch.digestScore,
          watch.minimumScore,
        )
      ).slice(0, 25);
      watchesProcessed += 1;
      matchesProcessed += matches.length;
      for (const match of matches) {
        const job = await this.repo.getObservedJob(match.observedJobId);
        if (!job) continue;
        notificationsSent += await this.dispatcher.dispatch({
          idempotencyKey: "",
          type: "digest",
          watch,
          job,
          match: {
            ...match,
            scoreBreakdown: {
              ...match.scoreBreakdown,
              reasons: [
                `Daily digest: ${matches.length} matching internship${matches.length === 1 ? "" : "s"}`,
                ...match.scoreBreakdown.reasons,
              ],
            },
          },
          detectedAt: now,
        });
      }
      // The database idempotency key remains the cross-restart guard. This
      // map avoids querying the same digest every 15 seconds in one process.
      this.completedLocalDates.set(watch.id, local.date);
    }

    return { watchesProcessed, matchesProcessed, notificationsSent };
  }
}

function localClock(
  date: Date,
  timezone: string,
): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
