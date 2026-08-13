import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import {
  JobWatch,
  WATCH_REPOSITORY,
  WatchRepository,
  WatchValidationService,
  watchSourceTargetKey,
} from "@ever-jobs/watcher";
import { ApplyWatchDto } from "./watch.dto";
import { publicWatch } from "./watch-management.helpers";

export type WatchChangeClassification =
  | "metadata"
  | "schedule"
  | "routing"
  | "behavior";

export interface WatchFieldChange {
  field: string;
  classification: WatchChangeClassification;
  before: unknown;
  after: unknown;
}

export interface WatchApplyResult {
  watch: Record<string, unknown>;
  diff: WatchFieldChange[];
  systemChanges: WatchFieldChange[];
  changed: boolean;
  behaviorChanged: boolean;
  paused: boolean;
  pausedByApply: boolean;
  resumeRequired: boolean;
  targetKeysRequiringInitialization: string[];
}

const CHANGE_CLASSIFICATION: Partial<
  Record<keyof JobWatch, WatchChangeClassification>
> = {
  name: "metadata",
  description: "metadata",
  schedule: "schedule",
  intervalMinutes: "schedule",
  timezone: "schedule",
  notificationChannels: "routing",
  notificationRoutes: "routing",
};

/**
 * Validates and atomically applies a GUI watch draft. Search/scoring changes
 * deliberately invalidate every enabled target and leave the watch paused;
 * an operator must baseline and explicitly resume it.
 */
@Injectable()
export class WatchApplyService {
  constructor(
    @Inject(WATCH_REPOSITORY)
    private readonly repository: WatchRepository,
    private readonly validation: WatchValidationService,
  ) {}

  async apply(id: string, body: ApplyWatchDto): Promise<WatchApplyResult> {
    const current = await this.requireWatch(id);
    const expectedUpdatedAt = new Date(body.expectedUpdatedAt);
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      this.throwStale(current);
    }
    if (Object.prototype.hasOwnProperty.call(body.patch, "enabled")) {
      throw new BadRequestException({
        statusCode: 400,
        code: "WATCH_ENABLED_REQUIRES_EXPLICIT_ACTION",
        message:
          "Use the dedicated pause or resume endpoint to change watch execution state.",
      });
    }

    const requestedPatch = this.validation.parsePatch(body.patch, current);
    const requestedDiff = fieldChanges(current, requestedPatch);
    const behaviorChanged = requestedDiff.some(
      ({ classification }) => classification === "behavior",
    );
    const update = behaviorChanged
      ? safeBehaviorUpdate(current, requestedPatch)
      : requestedPatch;
    const systemChanges = behaviorChanged
      ? fieldChanges({ ...current, ...requestedPatch }, update)
      : [];
    const targetKeysRequiringInitialization = behaviorChanged
      ? initializationTargets({ ...current, ...update })
      : [];

    if (requestedDiff.length === 0) {
      return {
        watch: publicWatch(current),
        diff: [],
        systemChanges: [],
        changed: false,
        behaviorChanged: false,
        paused: !current.enabled,
        pausedByApply: false,
        resumeRequired: false,
        targetKeysRequiringInitialization: [],
      };
    }

    const updated = await this.repository.updateWatchIfCurrent(
      id,
      expectedUpdatedAt,
      update,
    );
    if (!updated) {
      const latest = await this.repository.getWatch(id);
      if (!latest) throw new NotFoundException(`Watch not found: ${id}`);
      this.throwStale(latest);
    }

    return {
      watch: publicWatch(updated),
      diff: publicFieldChanges(requestedDiff),
      systemChanges: publicFieldChanges(systemChanges),
      changed: true,
      behaviorChanged,
      paused: !updated.enabled,
      pausedByApply: behaviorChanged && current.enabled,
      resumeRequired: behaviorChanged,
      targetKeysRequiringInitialization,
    };
  }

  private async requireWatch(id: string): Promise<JobWatch> {
    const watch = await this.repository.getWatch(id);
    if (!watch) throw new NotFoundException(`Watch not found: ${id}`);
    return watch;
  }

  private throwStale(current: JobWatch): never {
    throw new ConflictException({
      statusCode: 409,
      code: "WATCH_STALE_UPDATE",
      message:
        "The watch changed after this draft was loaded. Refresh it and reapply the draft.",
      currentUpdatedAt: current.updatedAt.toISOString(),
    });
  }
}

function publicFieldChanges(changes: WatchFieldChange[]): WatchFieldChange[] {
  return changes.map((change) =>
    change.field === "notificationChannels" ||
    change.field === "notificationRoutes"
      ? {
          ...change,
          before: redactDestinationRefs(change.before),
          after: redactDestinationRefs(change.after),
        }
      : change,
  );
}

function redactDestinationRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDestinationRefs);
  if (typeof value === "string") {
    return /^(?:https?:\/\/|https?%3a)/i.test(value.trim())
      ? "[redacted-destination]"
      : value;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/^(?:destination|secretRef|webhookUrl)$/i.test(key))
      .map(([key, item]) => [key, redactDestinationRefs(item)]),
  );
}

function fieldChanges(
  current: Partial<JobWatch>,
  patch: Partial<JobWatch>,
): WatchFieldChange[] {
  const changes: WatchFieldChange[] = [];
  for (const field of Object.keys(patch) as Array<keyof JobWatch>) {
    const before = current[field];
    const after = patch[field];
    if (isDeepStrictEqual(before, after)) continue;
    changes.push({
      field: String(field),
      classification: CHANGE_CLASSIFICATION[field] ?? "behavior",
      before,
      after,
    });
  }
  return changes;
}

function safeBehaviorUpdate(
  current: JobWatch,
  requested: Partial<JobWatch>,
): Partial<JobWatch> {
  const next = { ...current, ...requested };
  assertUniqueTargetKeys(next);
  return {
    ...requested,
    enabled: false,
    initializedAt: null,
    nextRunAt: null,
    sourceTargets: next.sourceTargets.map((target) =>
      target.enabled
        ? { ...target, initializedAt: null, nextRunAt: null }
        : target,
    ),
  };
}

function initializationTargets(watch: JobWatch): string[] {
  assertUniqueTargetKeys(watch);
  return watch.sourceTargets
    .filter((target) => target.enabled)
    .map(watchSourceTargetKey);
}

function assertUniqueTargetKeys(watch: JobWatch): void {
  const keys = new Set<string>();
  for (const target of watch.sourceTargets) {
    const key = watchSourceTargetKey(target);
    if (keys.has(key)) {
      throw new BadRequestException(
        `WATCH_TARGET_DUPLICATE: watch has duplicate source target key: ${key}`,
      );
    }
    keys.add(key);
  }
}
