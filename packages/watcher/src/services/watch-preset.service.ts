import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  JobWatch,
  WATCH_REPOSITORY,
  WatchRepository,
  WatchSearchScope,
  WatchSourceTarget,
} from "../interfaces/watch.types";
import {
  PRESTIGE_INTERNSHIPS_V2_PRESET,
  WatchPresetDefinition,
} from "./prestige-internships-v2.preset";

const PRESETS = new Map<string, WatchPresetDefinition>([
  [PRESTIGE_INTERNSHIPS_V2_PRESET.id, PRESTIGE_INTERNSHIPS_V2_PRESET],
]);

const LEGACY_BROAD_REQUIRED_TERMS = new Set([
  "student",
  "university",
  "campus",
  "early career",
]);

const LEGACY_CANADA_ONLY_EXCLUSIONS = new Set([
  "united states only",
  "us only",
  "usa only",
  "must reside in the united states",
]);

export interface WatchPresetTargetDiff {
  unchanged: string[];
  added: string[];
  materiallyChanged: string[];
  disabled: string[];
  operatorOnly: string[];
}

export interface WatchPresetFieldDiff {
  intervalMinutes: { from: number; to: number } | null;
  sourcesAdded: string[];
  searchTermsAdded: string[];
  locationsAdded: string[];
  countryCodesAdded: string[];
  removedLegacyRequiredTerms: string[];
  removedLegacyExcludedTerms: string[];
}

export interface WatchPresetApplyResult {
  preset: {
    id: string;
    version: number;
    name: string;
  };
  watchId: string;
  dryRun: boolean;
  applied: boolean;
  targets: WatchPresetTargetDiff;
  fields: WatchPresetFieldDiff;
  targetKeysRequiringInitialization: string[];
  watch?: JobWatch;
}

export interface ApplyWatchPresetOptions {
  /** Preview only unless explicitly true. */
  apply?: boolean;
}

/** Canonical persisted/configured key used by preset and initialize workflows. */
export function watchSourceTargetKey(target: WatchSourceTarget): string {
  const site = String(target.site).trim();
  const slug = target.companySlug?.trim();
  return slug ? `${site}:${slug}` : site;
}

/**
 * Validate explicit initialization targets before executing external sources.
 * An omitted or empty list intentionally preserves initialize-all behavior.
 */
export function validateWatchTargetKeys(
  watch: JobWatch,
  requested: readonly string[] | undefined,
): string[] {
  if (!requested || requested.length === 0) return [];

  const targetByKey = new Map<string, WatchSourceTarget>();
  for (const target of watch.sourceTargets) {
    const key = watchSourceTargetKey(target);
    if (targetByKey.has(key)) {
      throw new BadRequestException(
        `WATCH_TARGET_DUPLICATE: watch has duplicate source target key: ${key}`,
      );
    }
    targetByKey.set(key, target);
  }

  const normalized = requested.map((key) => key.trim());
  if (normalized.some((key) => key.length === 0)) {
    throw new BadRequestException(
      "WATCH_TARGET_UNKNOWN: target keys must not be empty",
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new BadRequestException(
      "WATCH_TARGET_DUPLICATE: target keys must be unique",
    );
  }
  for (const key of normalized) {
    const target = targetByKey.get(key);
    if (!target) {
      throw new BadRequestException(
        `WATCH_TARGET_UNKNOWN: unknown watch target key: ${key}`,
      );
    }
    if (!target.enabled) {
      throw new BadRequestException(
        `WATCH_TARGET_DISABLED: watch target is disabled: ${key}`,
      );
    }
  }
  return normalized;
}

@Injectable()
export class WatchPresetService {
  constructor(
    @Inject(WATCH_REPOSITORY) private readonly repository: WatchRepository,
  ) {}

  list(): Array<{ id: string; version: number; name: string }> {
    return [...PRESETS.values()].map(({ id, version, name }) => ({
      id,
      version,
      name,
    }));
  }

  get(id: string): WatchPresetDefinition {
    const preset = PRESETS.get(id.trim());
    if (!preset) throw new BadRequestException(`Unknown watch preset: ${id}`);
    return preset;
  }

  async apply(
    presetId: string,
    watchId: string,
    options: ApplyWatchPresetOptions = {},
  ): Promise<WatchPresetApplyResult> {
    const preset = this.get(presetId);
    const current = await this.repository.getWatch(watchId);
    if (!current) throw new NotFoundException(`Watch not found: ${watchId}`);

    const desired = preset.createWatch();
    const desiredTargets = desired.sourceTargets ?? [];
    const targetMerge = mergeTargets(current, desiredTargets);
    const patch = buildPresetPatch(current, desired, targetMerge.targets);
    const result: WatchPresetApplyResult = {
      preset: { id: preset.id, version: preset.version, name: preset.name },
      watchId,
      dryRun: options.apply !== true,
      applied: false,
      targets: targetMerge.diff,
      fields: fieldDiff(current, patch),
      targetKeysRequiringInitialization: initializationTargets(
        current,
        targetMerge.targets,
        new Set(desiredTargets.map(watchSourceTargetKey)),
      ),
    };

    if (options.apply !== true) return result;
    if (current.enabled) {
      throw new ConflictException(
        `WATCH_MUST_BE_PAUSED: pause watch before applying preset: ${watchId}`,
      );
    }

    const updated = await this.repository.updateWatch(watchId, patch);
    return { ...result, dryRun: false, applied: true, watch: updated };
  }
}

function mergeTargets(
  current: JobWatch,
  desiredTargets: WatchSourceTarget[],
): { targets: WatchSourceTarget[]; diff: WatchPresetTargetDiff } {
  const currentByKey = new Map(
    current.sourceTargets.map((target) => [
      watchSourceTargetKey(target),
      target,
    ]),
  );
  const desiredKeys = new Set(desiredTargets.map(watchSourceTargetKey));
  const diff: WatchPresetTargetDiff = {
    unchanged: [],
    added: [],
    materiallyChanged: [],
    disabled: [],
    operatorOnly: [],
  };

  const targets = desiredTargets.map((desired) => {
    const key = watchSourceTargetKey(desired);
    const existing = currentByKey.get(key);
    if (!existing) {
      diff.added.push(key);
      return resetTargetRuntime(desired);
    }

    const materialChanged = !sameMaterialTarget(existing, desired);
    if (existing.enabled && !desired.enabled) diff.disabled.push(key);
    else if (materialChanged || existing.enabled !== desired.enabled) {
      diff.materiallyChanged.push(key);
    } else diff.unchanged.push(key);

    const configuration = targetConfiguration(desired);
    return materialChanged
      ? resetTargetRuntime(desired)
      : { ...existing, ...configuration };
  });

  for (const target of current.sourceTargets) {
    const key = watchSourceTargetKey(target);
    if (desiredKeys.has(key)) continue;
    diff.operatorOnly.push(key);
    targets.push(target);
  }

  return { targets, diff };
}

function buildPresetPatch(
  current: JobWatch,
  desired: Partial<JobWatch>,
  targets: WatchSourceTarget[],
): Partial<JobWatch> {
  const desiredSources = desired.sources ?? [];
  const desiredRequired = desired.requiredTerms ?? [];
  const desiredExcluded = desired.excludedTerms ?? [];
  const retainedRequired = current.requiredTerms.filter(
    (term) => !LEGACY_BROAD_REQUIRED_TERMS.has(normalizeValue(term)),
  );
  const retainedExcluded = current.excludedTerms.filter(
    (term) => !LEGACY_CANADA_ONLY_EXCLUSIONS.has(normalizeValue(term)),
  );
  const sourceTiers = { ...current.sourceTiers };
  for (const target of desired.sourceTargets ?? []) {
    sourceTiers[String(target.site)] = target.tier;
  }

  return {
    // The top-level scheduler interval cannot be slower than Tier 1. Preserve
    // a deliberately faster operator interval.
    intervalMinutes: Math.min(
      current.intervalMinutes,
      desired.intervalMinutes ?? current.intervalMinutes,
    ),
    sourceTargets: targets,
    sources: mergeValues(current.sources, desiredSources),
    sourceTiers,
    companySlugs: mergeValues(current.companySlugs, desired.companySlugs ?? []),
    companies: mergeValues(current.companies, desired.companies ?? []),
    searchTerms: mergeValues(current.searchTerms, desired.searchTerms ?? []),
    // Broad legacy values such as "student" are removed because they are not
    // internship evidence. Unrelated operator-authored requirements survive.
    requiredTerms: mergeValues(retainedRequired, desiredRequired),
    preferredTerms: mergeValues(
      current.preferredTerms,
      desired.preferredTerms ?? [],
    ),
    excludedTerms: mergeValues(retainedExcluded, desiredExcluded),
    locations: mergeValues(current.locations, desired.locations ?? []),
    countryCodes: mergeValues(
      current.countryCodes.map((code) => code.toUpperCase()),
      (desired.countryCodes ?? []).map((code) => code.toUpperCase()),
    ),
    allowedWorkplaceTypes: mergeValues(
      current.allowedWorkplaceTypes,
      desired.allowedWorkplaceTypes ?? [],
    ),
    allowedEmploymentTypes: mergeValues(
      current.allowedEmploymentTypes,
      desired.allowedEmploymentTypes ?? [],
    ),
  };
}

function initializationTargets(
  watch: JobWatch,
  targets: WatchSourceTarget[],
  presetKeys: Set<string>,
): string[] {
  return targets
    .filter((target) => presetKeys.has(watchSourceTargetKey(target)))
    .filter((target) => target.enabled)
    .filter(
      (target) =>
        (target.initializedAt === undefined
          ? watch.initializedAt
          : target.initializedAt) == null,
    )
    .map(watchSourceTargetKey);
}

function fieldDiff(
  current: JobWatch,
  patch: Partial<JobWatch>,
): WatchPresetFieldDiff {
  const nextInterval = patch.intervalMinutes ?? current.intervalMinutes;
  return {
    intervalMinutes:
      nextInterval === current.intervalMinutes
        ? null
        : { from: current.intervalMinutes, to: nextInterval },
    sourcesAdded: addedValues(current.sources, patch.sources ?? []),
    searchTermsAdded: addedValues(current.searchTerms, patch.searchTerms ?? []),
    locationsAdded: addedValues(current.locations, patch.locations ?? []),
    countryCodesAdded: addedValues(
      current.countryCodes,
      patch.countryCodes ?? [],
    ),
    removedLegacyRequiredTerms: current.requiredTerms.filter((term) =>
      LEGACY_BROAD_REQUIRED_TERMS.has(normalizeValue(term)),
    ),
    removedLegacyExcludedTerms: current.excludedTerms.filter((term) =>
      LEGACY_CANADA_ONLY_EXCLUSIONS.has(normalizeValue(term)),
    ),
  };
}

function sameMaterialTarget(
  left: WatchSourceTarget,
  right: WatchSourceTarget,
): boolean {
  return (
    JSON.stringify(materialTarget(left)) ===
    JSON.stringify(materialTarget(right))
  );
}

function materialTarget(target: WatchSourceTarget): Record<string, unknown> {
  return {
    site: String(target.site).trim(),
    companySlug: target.companySlug?.trim() ?? null,
    companyName: target.companyName?.trim() ?? null,
    tier: target.tier,
    intervalMinutes: target.intervalMinutes,
    searchScope: normalizedScope(target.searchScope),
  };
}

function normalizedScope(
  value: WatchSearchScope | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  return {
    countryCodes: value.countryCodes.map((code) => code.trim().toUpperCase()),
    locations: value.locations.map((location) => location.trim()),
    searchTerms: value.searchTerms?.map((term) => term.trim()) ?? null,
    maxRequestsPerRun: value.maxRequestsPerRun ?? null,
  };
}

function targetConfiguration(
  target: WatchSourceTarget,
): Omit<WatchSourceTarget, "initializedAt" | "lastRunAt" | "nextRunAt"> {
  const { initializedAt, lastRunAt, nextRunAt, ...configuration } = target;
  void initializedAt;
  void lastRunAt;
  void nextRunAt;
  return configuration;
}

function resetTargetRuntime(target: WatchSourceTarget): WatchSourceTarget {
  return {
    ...targetConfiguration(target),
    initializedAt: null,
    lastRunAt: null,
    nextRunAt: null,
  };
}

function mergeValues(
  left: readonly string[],
  right: readonly string[],
): string[] {
  return uniqueValues([...left, ...right]);
}

function uniqueValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeValue(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function addedValues(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const existing = new Set(before.map(normalizeValue));
  return after.filter((value) => !existing.has(normalizeValue(value)));
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-CA");
}
