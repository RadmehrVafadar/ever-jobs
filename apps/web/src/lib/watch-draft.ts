import { JobWatch, NotificationRoute, WatchSourceTarget } from "../types";

export type EditableWatch = Omit<
  JobWatch,
  | "id"
  | "enabled"
  | "createdAt"
  | "updatedAt"
  | "targetHealth"
  | "initializedAt"
  | "lastRunAt"
  | "nextRunAt"
>;

export type CreatableWatch = EditableWatch & Pick<JobWatch, "enabled">;

const EDITABLE_FIELDS: Array<keyof EditableWatch> = [
  "name",
  "description",
  "schedule",
  "intervalMinutes",
  "timezone",
  "sources",
  "sourceTiers",
  "sourceTargets",
  "companySlugs",
  "companies",
  "searchTerms",
  "requiredTerms",
  "preferredTerms",
  "excludedTerms",
  "locations",
  "countryCodes",
  "allowedWorkplaceTypes",
  "allowedEmploymentTypes",
  "minimumScore",
  "urgentScore",
  "digestScore",
  "notificationChannels",
  "notificationRoutes",
  "initializationMode",
  "recentWindowMinutes",
  "weights",
];

export interface DraftDiff {
  path: string;
  before: unknown;
  after: unknown;
  behaviorChanging: boolean;
}

const BEHAVIOR_FIELDS = new Set([
  "sourceTargets",
  "sources",
  "sourceTiers",
  "companySlugs",
  "companies",
  "searchTerms",
  "requiredTerms",
  "preferredTerms",
  "excludedTerms",
  "locations",
  "countryCodes",
  "allowedWorkplaceTypes",
  "allowedEmploymentTypes",
  "minimumScore",
  "urgentScore",
  "digestScore",
  "weights",
]);

export function editableWatch(watch: JobWatch): EditableWatch {
  const draft: Partial<EditableWatch> = {};
  for (const field of EDITABLE_FIELDS) {
    (draft as Record<string, unknown>)[field] =
      field === "sourceTargets"
        ? watch.sourceTargets.map(editableSourceTarget)
        : structuredClone(watch[field]);
  }
  draft.notificationRoutes ??= [];
  return draft as EditableWatch;
}

export function diffWatch(
  original: EditableWatch,
  draft: EditableWatch,
): DraftDiff[] {
  return EDITABLE_FIELDS.flatMap((field) => {
    const before = original[field];
    const after = draft[field];
    if (stableStringify(before) === stableStringify(after)) return [];
    return [
      {
        path: String(field),
        before,
        after,
        behaviorChanging: BEHAVIOR_FIELDS.has(String(field)),
      },
    ];
  });
}

export function validateDraft(draft: EditableWatch): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Give this watch a name.");
  if (!draft.timezone.trim()) errors.push("Choose a timezone.");
  if (
    !Number.isInteger(draft.intervalMinutes) ||
    draft.intervalMinutes < 1 ||
    draft.intervalMinutes > 1_440
  ) {
    errors.push("Default interval must be between 1 and 1,440 minutes.");
  }
  if (
    draft.digestScore > draft.minimumScore ||
    draft.minimumScore > draft.urgentScore
  ) {
    errors.push("Scores must follow digest ≤ minimum ≤ urgent.");
  }
  if (draft.countryCodes.some((code) => code.trim().length !== 2)) {
    errors.push("Country codes must use two letters.");
  }
  for (const [index, target] of draft.sourceTargets.entries()) {
    if (!target.site.trim()) errors.push(`Source ${index + 1} needs a site.`);
    if (target.intervalMinutes < 1 || target.intervalMinutes > 1_440) {
      errors.push(
        `Source ${target.site || index + 1} has an invalid interval.`,
      );
    }
  }
  for (const [index, route] of draft.notificationRoutes.entries()) {
    if (!route.name.trim())
      errors.push(`Notification route ${index + 1} needs a name.`);
    if (!route.destinationRef.trim())
      errors.push(`Notification route ${index + 1} needs a destination.`);
    const minimum = route.conditions?.minimumScore;
    const maximum = route.conditions?.maximumScore;
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      errors.push(
        `Notification route “${route.name || index + 1}” has minimum score above maximum score.`,
      );
    }
  }
  return errors;
}

/** Parse an imported document without allowing runtime or unknown fields into the draft. */
export function parseImportedWatchDraft(
  value: unknown,
  current: EditableWatch,
): EditableWatch {
  if (!isRecord(value)) throw new Error("Watch JSON must be an object.");
  const currentRecord = current as unknown as Record<string, unknown>;
  const imported = Object.fromEntries(
    EDITABLE_FIELDS.map((field) => [
      field,
      field in value ? value[field] : currentRecord[field],
    ]),
  );
  assertDraftStructure(imported);
  const errors = validateDraft(imported);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return imported;
}

export function blankTarget(site = ""): WatchSourceTarget {
  return {
    site,
    tier: 2,
    intervalMinutes: 30,
    resultsWanted: 50,
    enabled: true,
  };
}

export function blankRoute(): NotificationRoute {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `route-${Date.now()}`,
    name: "New route",
    enabled: true,
    provider: "discord",
    destinationRef: "default",
    conditions: {},
  };
}

/** Explicit null resets a target; only an absent target timestamp inherits the legacy watch baseline. */
export function isTargetInitialized(
  target: Pick<WatchSourceTarget, "initializedAt">,
  watchInitializedAt?: string | null,
): boolean {
  const initializedAt =
    target.initializedAt === undefined
      ? watchInitializedAt
      : target.initializedAt;
  return initializedAt != null;
}

export function cloneWatchPayload(watch: JobWatch): CreatableWatch {
  return {
    ...editableWatch(watch),
    name: `${watch.name} copy`,
    enabled: false,
  };
}

function editableSourceTarget(target: WatchSourceTarget): WatchSourceTarget {
  return {
    site: target.site,
    tier: target.tier,
    intervalMinutes: target.intervalMinutes,
    ...(target.resultsWanted === undefined
      ? {}
      : { resultsWanted: target.resultsWanted }),
    ...(target.companySlug === undefined
      ? {}
      : { companySlug: target.companySlug }),
    ...(target.companyName === undefined
      ? {}
      : { companyName: target.companyName }),
    ...(target.searchScope
      ? {
          searchScope: {
            countryCodes: [...target.searchScope.countryCodes],
            locations: [...target.searchScope.locations],
            ...(target.searchScope.strictLocations === undefined
              ? {}
              : { strictLocations: target.searchScope.strictLocations }),
            ...(target.searchScope.searchTerms
              ? { searchTerms: [...target.searchScope.searchTerms] }
              : {}),
            ...(target.searchScope.maxRequestsPerRun === undefined
              ? {}
              : { maxRequestsPerRun: target.searchScope.maxRequestsPerRun }),
          },
        }
      : {}),
    enabled: target.enabled,
  };
}

function assertDraftStructure(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> & EditableWatch {
  for (const field of ["name", "timezone"] as const) {
    if (typeof value[field] !== "string")
      invalidImport(`${field} must be a string.`);
  }
  for (const field of ["description", "schedule"] as const) {
    if (
      value[field] !== undefined &&
      value[field] !== null &&
      typeof value[field] !== "string"
    ) {
      invalidImport(`${field} must be a string or null.`);
    }
  }
  for (const field of [
    "intervalMinutes",
    "minimumScore",
    "urgentScore",
    "digestScore",
  ] as const) {
    if (!isFiniteNumber(value[field]))
      invalidImport(`${field} must be a number.`);
  }
  if (
    value.recentWindowMinutes !== undefined &&
    !isFiniteNumber(value.recentWindowMinutes)
  ) {
    invalidImport("recentWindowMinutes must be a number.");
  }
  for (const field of [
    "sources",
    "companySlugs",
    "companies",
    "searchTerms",
    "requiredTerms",
    "preferredTerms",
    "excludedTerms",
    "locations",
    "countryCodes",
    "allowedWorkplaceTypes",
    "allowedEmploymentTypes",
  ] as const) {
    if (!isStringArray(value[field]))
      invalidImport(`${field} must be an array of strings.`);
  }
  if (
    !isRecord(value.sourceTiers) ||
    !Object.values(value.sourceTiers).every(isTier)
  ) {
    invalidImport("sourceTiers must map source names to tiers 1, 2, or 3.");
  }
  if (
    !Array.isArray(value.sourceTargets) ||
    !value.sourceTargets.every(isSourceTarget)
  ) {
    invalidImport("sourceTargets contains an invalid source configuration.");
  }
  if (
    !Array.isArray(value.notificationChannels) ||
    !value.notificationChannels.every(isDestination)
  ) {
    invalidImport("notificationChannels contains an invalid destination.");
  }
  if (
    !Array.isArray(value.notificationRoutes) ||
    !value.notificationRoutes.every(isRoute)
  ) {
    invalidImport("notificationRoutes contains an invalid routing rule.");
  }
  if (
    !["baseline", "recent-only", "notify-all"].includes(
      String(value.initializationMode),
    )
  ) {
    invalidImport("initializationMode is invalid.");
  }
  if (
    value.weights !== undefined &&
    (!isRecord(value.weights) ||
      !Object.values(value.weights).every(isFiniteNumber))
  ) {
    invalidImport("weights must map names to numeric values.");
  }
}

function isSourceTarget(value: unknown): value is WatchSourceTarget {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "site",
      "tier",
      "intervalMinutes",
      "resultsWanted",
      "companySlug",
      "companyName",
      "searchScope",
      "enabled",
    ])
  )
    return false;
  if (
    typeof value.site !== "string" ||
    !isTier(value.tier) ||
    !isFiniteNumber(value.intervalMinutes) ||
    typeof value.enabled !== "boolean"
  )
    return false;
  if (value.resultsWanted !== undefined && !isFiniteNumber(value.resultsWanted))
    return false;
  if (value.companySlug !== undefined && typeof value.companySlug !== "string")
    return false;
  if (value.companyName !== undefined && typeof value.companyName !== "string")
    return false;
  if (value.searchScope === undefined) return true;
  return (
    isRecord(value.searchScope) &&
    hasOnlyKeys(value.searchScope, [
      "countryCodes",
      "locations",
      "strictLocations",
      "searchTerms",
      "maxRequestsPerRun",
    ]) &&
    isStringArray(value.searchScope.countryCodes) &&
    isStringArray(value.searchScope.locations) &&
    (value.searchScope.strictLocations === undefined ||
      typeof value.searchScope.strictLocations === "boolean") &&
    (value.searchScope.searchTerms === undefined ||
      isStringArray(value.searchScope.searchTerms)) &&
    (value.searchScope.maxRequestsPerRun === undefined ||
      isFiniteNumber(value.searchScope.maxRequestsPerRun))
  );
}

function isDestination(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["type", "destinationRef"]) &&
    ["discord", "telegram", "webhook"].includes(String(value.type)) &&
    typeof value.destinationRef === "string"
  );
}

function isRoute(value: unknown): value is NotificationRoute {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, [
      "id",
      "name",
      "enabled",
      "provider",
      "destinationRef",
      "conditions",
    ])
  )
    return false;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.enabled !== "boolean" ||
    !["discord", "telegram", "webhook"].includes(String(value.provider)) ||
    typeof value.destinationRef !== "string"
  )
    return false;
  if (value.conditions === undefined) return true;
  if (!isRecord(value.conditions)) return false;
  if (
    !hasOnlyKeys(value.conditions, [
      "sourceTiers",
      "notificationTypes",
      "minimumScore",
      "maximumScore",
    ])
  )
    return false;
  return (
    (value.conditions.sourceTiers === undefined ||
      (Array.isArray(value.conditions.sourceTiers) &&
        value.conditions.sourceTiers.every(isTier))) &&
    (value.conditions.notificationTypes === undefined ||
      (Array.isArray(value.conditions.notificationTypes) &&
        value.conditions.notificationTypes.every((item) =>
          ["urgent", "standard", "digest"].includes(String(item)),
        ))) &&
    (value.conditions.minimumScore === undefined ||
      isFiniteNumber(value.conditions.minimumScore)) &&
    (value.conditions.maximumScore === undefined ||
      isFiniteNumber(value.conditions.maximumScore))
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isTier(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function invalidImport(message: string): never {
  throw new Error(`Invalid watch JSON: ${message}`);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
