import { JobPostDto, LocationDto, Site } from "@ever-jobs/models";

export const WATCH_REPOSITORY = Symbol.for(
  "@ever-jobs/watcher/WatchRepository",
);

export type WatchInitializationMode = "baseline" | "recent-only" | "notify-all";
export type WatchMatchStatus =
  | "new"
  | "reviewed"
  | "applied"
  | "dismissed"
  | "interview"
  | "rejected"
  | "offer";
export type NotificationStatus = "pending" | "sent" | "failed" | "suppressed";
export type NotificationSuppressionReason = "baseline" | "eligibility";
export type NotificationType = "urgent" | "standard" | "digest";
export type WatchRunStatus = "running" | "completed" | "failed" | "partial";

export interface WatchSearchScope {
  countryCodes: string[];
  locations: string[];
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}

export interface WatchSourceTarget {
  site: Site | string;
  tier: 1 | 2 | 3;
  intervalMinutes: number;
  companySlug?: string;
  companyName?: string;
  searchScope?: WatchSearchScope;
  enabled: boolean;
  initializedAt?: Date | null;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
}

export interface WatchTargetHealth {
  targetKey: string;
  tier: 1 | 2 | 3;
  successCount: number;
  hardFailureCount: number;
  emptyRunCount: number;
  partialRunCount: number;
  consecutiveHardFailures: number;
  lastAttemptAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastNonEmptyAt?: Date | null;
  degradedAt?: Date | null;
}

export type WatchTargetRunOutcome =
  | "success"
  | "empty"
  | "partial"
  | "hard_failure";

export interface WatchTargetRunResult {
  targetKey: string;
  tier: 1 | 2 | 3;
  status: "succeeded" | "partial" | "failed";
  outcome: WatchTargetRunOutcome;
  requests: number;
  requestsSucceeded: number;
  requestsFailed: number;
  jobsFetched: number;
  durationMs: number;
  empty: boolean;
  hardFailure: boolean;
  consecutiveHardFailures: number;
  degraded: boolean;
  lastSuccessAt?: Date | null;
  lastNonEmptyAt?: Date | null;
}

export interface JobWatch {
  id: string;
  name: string;
  enabled: boolean;
  description?: string;
  schedule?: string;
  intervalMinutes: number;
  timezone: string;
  sources: string[];
  sourceTiers: Record<string, number>;
  sourceTargets: WatchSourceTarget[];
  targetHealth?: Record<string, WatchTargetHealth>;
  companySlugs: string[];
  companies: string[];
  searchTerms: string[];
  requiredTerms: string[];
  preferredTerms: string[];
  excludedTerms: string[];
  locations: string[];
  countryCodes: string[];
  allowedWorkplaceTypes: string[];
  allowedEmploymentTypes: string[];
  minimumScore: number;
  urgentScore: number;
  digestScore: number;
  notificationChannels: NotificationDestination[];
  initializationMode: WatchInitializationMode;
  recentWindowMinutes?: number;
  weights?: Record<string, number>;
  initializedAt?: Date | null;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
  leaseOwnerId?: string | null;
  leaseToken?: string | null;
  leaseExpiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ObservedJob {
  id: string;
  fingerprint: string;
  source: string;
  sourceTargetKey?: string | null;
  sourceType?: string | null;
  externalJobId?: string | null;
  company?: string | null;
  normalizedCompany?: string | null;
  title: string;
  normalizedTitle: string;
  location?: string | null;
  normalizedLocation?: string | null;
  locations?: LocationDto[];
  canonicalKey?: string | null;
  canonicalEpisodeKey?: string | null;
  canonicalEpisodeStartedAt?: Date | null;
  workplaceType?: string | null;
  employmentType?: string | null;
  description?: string | null;
  descriptionHash?: string | null;
  jobUrl?: string | null;
  applicationUrl?: string | null;
  sourcePublishedAt?: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closedAt?: Date | null;
  rawPayload?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchMatch {
  id: string;
  watchId: string;
  observedJobId: string;
  canonicalEpisodeKey?: string | null;
  sourceTargetKey?: string | null;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  matchedTerms: string[];
  excludedReason?: string | null;
  status: WatchMatchStatus;
  firstMatchedAt: Date;
  lastMatchedAt: Date;
  notificationState: NotificationStatus;
  /** Why an unsent match is suppressed. Baselines are permanent; eligibility may recover. */
  notificationSuppressionReason?: NotificationSuppressionReason | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDelivery {
  id: string;
  idempotencyKey: string;
  watchMatchId: string;
  notificationType: NotificationType;
  channel: string;
  provider: string;
  destinationRef: string;
  status: NotificationStatus;
  attemptCount: number;
  lastAttemptAt?: Date | null;
  nextAttemptAt?: Date | null;
  sentAt?: Date | null;
  failedAt?: Date | null;
  claimOwnerId?: string | null;
  claimToken?: string | null;
  claimExpiresAt?: Date | null;
  providerResponse?: unknown;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchRun {
  id: string;
  watchId: string;
  startedAt: Date;
  completedAt?: Date | null;
  status: WatchRunStatus;
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: string[];
  targetResults?: WatchTargetRunResult[];
  coverageDegraded?: boolean;
  jobsFetched: number;
  jobsNormalized: number;
  newJobsDetected: number;
  matchesCreated: number;
  notificationsSent: number;
  durationMs?: number;
  errorSummary?: string | null;
  createdAt: Date;
}

export interface ScoreBreakdown {
  total: number;
  role: number;
  internship: number;
  location: number;
  company: number;
  source: number;
  skills: number;
  matchedKeywords: string[];
  missingRequired: string[];
  exclusionReason?: string;
  reasons: string[];
  /** Optional for compatibility with score explanations persisted pre-6000. */
  sourceTargetKey?: string;
  /** Optional for compatibility with score explanations persisted pre-6000. */
  matchedCountry?: "CA" | "US";
  /** Optional for compatibility with score explanations persisted pre-6000. */
  locationConfidence?: LocationConfidence;
  /** Optional for compatibility with score explanations persisted pre-6000. */
  geographyDecision?: GeographyDecision;
}

export type GeographyDecision =
  | "eligible-canada"
  | "eligible-united-states"
  | "eligible-north-america"
  | "outside-target-scope"
  | "geography-unknown";

export type LocationConfidence = "high" | "medium" | "low" | "unknown";

export interface GeographyExplanation {
  sourceTargetKey: string;
  matchedCountry?: "CA" | "US";
  locationConfidence: LocationConfidence;
  geographyDecision: GeographyDecision;
}

export interface NotificationDestination {
  type: "telegram" | "discord" | "webhook";
  /** A non-secret configuration key such as `discord-primary`. */
  destinationRef?: string;
  /** @deprecated Use destinationRef. Retained for existing watch documents. */
  destination?: string;
  secretRef?: string;
}

export interface JobNotificationMessage {
  idempotencyKey: string;
  type: NotificationType;
  watch: JobWatch;
  job: ObservedJob;
  match: WatchMatch;
  detectedAt: Date;
}

export interface NotificationResult {
  status: NotificationStatus;
  providerResponse?: unknown;
  errorMessage?: string;
}

export interface NotificationProvider {
  readonly type: string;
  send(
    message: JobNotificationMessage,
    destination: NotificationDestination,
  ): Promise<NotificationResult>;
}

export interface PageRequest {
  offset?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface WatchRunQuery extends PageRequest {
  watchId?: string;
  status?: WatchRunStatus;
  startedAfter?: Date;
  startedBefore?: Date;
}

export interface WatchMatchQuery extends PageRequest {
  watchId?: string;
  status?: WatchMatchStatus;
  notificationState?: NotificationStatus;
  minimumScore?: number;
  maximumScore?: number;
  company?: string;
  source?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  matchedAfter?: Date;
  matchedBefore?: Date;
}

export interface ObservedJobQuery extends PageRequest {
  company?: string;
  source?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  firstSeenAfter?: Date;
  firstSeenBefore?: Date;
}

export interface NotificationDeliveryQuery extends PageRequest {
  watchId?: string;
  watchMatchId?: string;
  status?: NotificationStatus;
  channel?: string;
  notificationType?: NotificationType;
  readyAt?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface WatchLease {
  watchId: string;
  ownerId: string;
  token: string;
  expiresAt: Date;
}

export interface AcquireWatchLeaseInput {
  watchId: string;
  ownerId: string;
  token: string;
  now: Date;
  expiresAt: Date;
  nextRunAt: Date;
  requireDue?: boolean;
}

export interface RenewWatchLeaseInput {
  watchId: string;
  ownerId: string;
  token: string;
  now: Date;
  expiresAt: Date;
}

export interface ReleaseWatchLeaseInput {
  watchId: string;
  ownerId: string;
  token: string;
}

export type ObservedJobInput = Omit<
  ObservedJob,
  "id" | "createdAt" | "updatedAt"
>;
export type WatchMatchInput = Omit<
  WatchMatch,
  "id" | "createdAt" | "updatedAt"
>;

export interface PersistObservationAndMatchInput {
  observedJob: ObservedJobInput;
  match: Omit<WatchMatchInput, "observedJobId">;
  /** Resolve fallback-only episodes against the persisted observation anchor. */
  canonicalEpisodeAnchorWindowMs?: number;
}

export interface PersistObservationAndMatchResult {
  job: ObservedJob;
  match: WatchMatch;
  isNewJob: boolean;
  isNewMatch: boolean;
  descriptionChanged: boolean;
}

export interface CreateNotificationDeliveryInput {
  idempotencyKey: string;
  watchMatchId: string;
  notificationType: NotificationType;
  channel: string;
  provider: string;
  destinationRef: string;
  status?: NotificationStatus;
  nextAttemptAt?: Date | null;
  providerResponse?: unknown;
  errorMessage?: string | null;
}

export interface ClaimNotificationDeliveryInput {
  deliveryId: string;
  ownerId: string;
  token: string;
  now: Date;
  expiresAt: Date;
  maxAttempts: number;
}

export interface UpdateNotificationDeliveryInput {
  status?: NotificationStatus;
  providerResponse?: unknown;
  errorMessage?: string | null;
  sentAt?: Date | null;
  failedAt?: Date | null;
  nextAttemptAt?: Date | null;
  incrementAttempt?: boolean;
  clearClaim?: boolean;
}

export interface RecordNotificationInput {
  idempotencyKey: string;
  watchMatchId: string;
  notificationType?: NotificationType;
  channel: string;
  provider: string;
  destinationRef?: string;
  status: NotificationStatus;
  providerResponse?: unknown;
  errorMessage?: string;
}

export interface WatchRepository {
  healthCheck(): Promise<boolean>;
  listWatches(): Promise<JobWatch[]>;
  listDueWatches(now: Date, limit: number): Promise<JobWatch[]>;
  tryAcquireWatchLease(
    input: AcquireWatchLeaseInput,
  ): Promise<WatchLease | null>;
  renewWatchLease(input: RenewWatchLeaseInput): Promise<WatchLease | null>;
  releaseWatchLease(input: ReleaseWatchLeaseInput): Promise<boolean>;
  getWatch(id: string): Promise<JobWatch | null>;
  createWatch(input: Partial<JobWatch>): Promise<JobWatch>;
  updateWatch(id: string, input: Partial<JobWatch>): Promise<JobWatch>;
  deleteWatch(id: string): Promise<boolean>;
  createRun(input: Partial<WatchRun> & { watchId: string }): Promise<WatchRun>;
  getRun(id: string): Promise<WatchRun | null>;
  completeRun(id: string, patch: Partial<WatchRun>): Promise<WatchRun>;
  listRuns(query: WatchRunQuery): Promise<Page<WatchRun>>;
  getObservedJob(id: string): Promise<ObservedJob | null>;
  listObservedJobs(query: ObservedJobQuery): Promise<Page<ObservedJob>>;
  upsertObservedJob(job: ObservedJobInput): Promise<{
    job: ObservedJob;
    isNew: boolean;
    descriptionChanged: boolean;
  }>;
  upsertMatch(match: WatchMatchInput): Promise<{
    match: WatchMatch;
    isNew: boolean;
  }>;
  persistObservationAndMatch(
    input: PersistObservationAndMatchInput,
  ): Promise<PersistObservationAndMatchResult>;
  getMatch(id: string): Promise<WatchMatch | null>;
  updateMatch(id: string, patch: Partial<WatchMatch>): Promise<WatchMatch>;
  listMatches(query: WatchMatchQuery): Promise<Page<WatchMatch>>;
  hasNotification(idempotencyKey: string): Promise<boolean>;
  enqueueNotification(
    input: CreateNotificationDeliveryInput,
  ): Promise<{ delivery: NotificationDelivery; isNew: boolean }>;
  claimNotification(
    input: ClaimNotificationDeliveryInput,
  ): Promise<NotificationDelivery | null>;
  updateNotification(
    id: string,
    claimToken: string,
    patch: UpdateNotificationDeliveryInput,
  ): Promise<NotificationDelivery>;
  getNotification(id: string): Promise<NotificationDelivery | null>;
  listNotifications(
    query: NotificationDeliveryQuery,
  ): Promise<Page<NotificationDelivery>>;
  recordNotification(input: RecordNotificationInput): Promise<void>;
  listDigestMatches(
    watchId: string,
    min: number,
    max: number,
  ): Promise<WatchMatch[]>;
}

export interface WatchSourceExecutor {
  search(input: {
    watch: JobWatch;
    searchTerm: string;
    sources: string[];
  }): Promise<JobPostDto[]>;
}
