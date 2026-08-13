export type HealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  | "unavailable"
  | "unknown"
  | "configured"
  | "unconfigured";
export type WatchMatchStatus =
  | "new"
  | "reviewed"
  | "applied"
  | "dismissed"
  | "interview"
  | "rejected"
  | "offer";
export type NotificationStatus = "pending" | "sent" | "failed" | "suppressed";
export type NotificationType = "urgent" | "standard" | "digest";
export type WatchRunStatus = "running" | "completed" | "failed" | "partial";

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface NotificationDestination {
  type: "discord" | "telegram" | "webhook";
  destinationRef: string;
}

export interface NotificationRouteConditions {
  sourceTiers?: Array<1 | 2 | 3>;
  notificationTypes?: NotificationType[];
  minimumScore?: number;
  maximumScore?: number;
}

export interface NotificationRoute {
  id: string;
  name: string;
  enabled: boolean;
  provider: "discord" | "telegram" | "webhook";
  destinationRef: string;
  conditions?: NotificationRouteConditions;
}

export interface WatchSearchScope {
  countryCodes: string[];
  locations: string[];
  strictLocations?: boolean;
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}

export interface WatchSourceTarget {
  site: string;
  tier: 1 | 2 | 3;
  intervalMinutes: number;
  resultsWanted?: number;
  companySlug?: string;
  companyName?: string;
  companyUrl?: string;
  mode?: "board" | "board-search" | "query";
  searchScope?: WatchSearchScope;
  enabled: boolean;
  initializedAt?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

export interface WatchTargetHealth {
  targetKey: string;
  tier: 1 | 2 | 3;
  successCount: number;
  hardFailureCount: number;
  emptyRunCount: number;
  partialRunCount: number;
  consecutiveHardFailures: number;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastNonEmptyAt?: string | null;
  degradedAt?: string | null;
}

export interface JobWatch {
  id: string;
  name: string;
  enabled: boolean;
  description?: string | null;
  schedule?: string | null;
  intervalMinutes: number;
  timezone: string;
  sources: string[];
  sourceTiers: Record<string, number>;
  sourceTargets: WatchSourceTarget[];
  targetHealth?: Record<string, WatchTargetHealth>;
  companySlugs: string[];
  companies: string[];
  searchTerms: string[];
  roleFamilies: InternshipRoleFamily[];
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
  notificationRoutes: NotificationRoute[];
  initializationMode: "baseline" | "recent-only" | "notify-all";
  recentWindowMinutes?: number;
  weights?: Record<string, number>;
  initializedAt?: string | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InternshipRoleFamily =
  | "software-engineering"
  | "data-ai"
  | "cybersecurity"
  | "cloud-platform-infrastructure"
  | "qa-automation"
  | "technical-product"
  | "ux-product-design"
  | "systems-business-analysis"
  | "technology-risk-it-audit";

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
  sourceTargetKey?: string;
  matchedCountry?: "CA" | "US";
  locationConfidence?: "high" | "medium" | "low" | "unknown";
  geographyDecision?: string;
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
  firstMatchedAt: string;
  lastMatchedAt: string;
  notificationState: NotificationStatus;
  notificationSuppressionReason?: "baseline" | "eligibility" | "routing" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObservedJob {
  id: string;
  fingerprint: string;
  source: string;
  sourceTargetKey?: string | null;
  sourceType?: string | null;
  externalJobId?: string | null;
  company?: string | null;
  title: string;
  location?: string | null;
  locations?: JobLocation[];
  canonicalEpisodeKey?: string | null;
  workplaceType?: string | null;
  employmentType?: string | null;
  description?: string | null;
  jobUrl?: string | null;
  applicationUrl?: string | null;
  sourcePublishedAt?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchRun {
  id: string;
  watchId: string;
  startedAt: string;
  completedAt?: string | null;
  status: WatchRunStatus;
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: string[];
  targetResults?: Array<{
    targetKey: string;
    tier: 1 | 2 | 3;
    status: "succeeded" | "partial" | "failed";
    jobsFetched: number;
    durationMs: number;
    degraded: boolean;
  }>;
  coverageDegraded?: boolean;
  jobsFetched: number;
  jobsNormalized: number;
  newJobsDetected: number;
  matchesCreated: number;
  notificationsSent: number;
  durationMs?: number;
  errorSummary?: string | null;
}

export interface NotificationDelivery {
  id: string;
  watchMatchId: string;
  notificationType: NotificationType;
  channel: string;
  provider: string;
  destinationRef: string;
  status: NotificationStatus;
  attemptCount: number;
  lastAttemptAt?: string | null;
  nextAttemptAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchMetrics {
  watchId: string;
  generatedAt: string;
  scope: {
    runs: number;
    matches: number;
    deliveries: number;
    truncated: boolean;
  };
  jobsDiscoveredToday: number;
  matchesByScore: Record<string, number>;
  matchesByStatus: Record<string, number>;
  applicationsSubmitted: number;
  notificationsSent: number;
  notificationFailures: number;
  tier1CoverageDegraded: boolean;
  recentRuns: WatchRun[];
}

export interface CoverageReport {
  watchId: string;
  summary: {
    configured: number;
    active: number;
    disabled: number;
    uncovered: number;
    initialized: number;
    degraded: number;
  };
  companies: Array<{
    company: string;
    status: "active" | "disabled" | "uncovered";
    targetKeys: string[];
    initialized: boolean;
    degraded: boolean;
    consecutiveHardFailures: number;
    lastSuccessAt?: string | null;
  }>;
}

export interface SourceHealth {
  site: string;
  state: "closed" | "open" | "half-open";
  successRate: number;
  p95LatencyMs: number;
  windowMs: number;
}

export interface ApiHealth {
  status: string;
  uptime: number;
  version: string;
  environment: string;
  timestamp: string;
  memoryUsage?: { rss: string; heapUsed: string; heapTotal: string };
  watcherCoverage?: {
    status: HealthState;
    tier1Degraded: boolean | null;
    watches: Array<{
      watchId: string;
      tier1Degraded: boolean;
      targetHealth: WatchTargetHealth[];
    }>;
  };
}

export interface SchedulerHealth {
  enabled: boolean;
  started: boolean;
  databaseHealthy: boolean;
  lastPollAt?: string | null;
  lastError?: string | null;
}

export interface OperatorOverview {
  status?: HealthState;
  api: { status: HealthState; uptime?: number; version?: string };
  database: { status: HealthState };
  worker: { status: HealthState; lastSeenAt?: string | null };
  scheduler: {
    status: HealthState;
    enabled?: boolean;
    lastPollAt?: string | null;
  };
  notifications: { status: HealthState; discordConfigured?: boolean };
  sourceCoverage: {
    status: HealthState;
    configured?: number;
    degraded?: number;
    tier1Degraded?: boolean;
  };
  counts?: {
    watches?: number;
    activeWatches?: number;
    recentMatches?: number;
    failedDeliveries?: number;
  };
  generatedAt?: string;
}

export interface DestinationSummary {
  alias: string;
  provider: "discord";
  source: "environment" | "local" | "unconfigured";
  configured: boolean;
}

export interface WatchPresetSummary {
  id: string;
  version: number;
  name: string;
  description?: string;
}

export interface WatchPresetPreview {
  preset: WatchPresetSummary;
  watchId: string;
  dryRun: boolean;
  applied: boolean;
  targets: {
    unchanged: string[];
    added: string[];
    materiallyChanged: string[];
    disabled: string[];
    operatorOnly: string[];
  };
  fields: Record<string, unknown>;
  targetKeysRequiringInitialization: string[];
  watch?: JobWatch;
}

export interface WatchApplyResponse {
  watch: JobWatch;
  diff: Array<{
    field: string;
    classification: "metadata" | "schedule" | "routing" | "behavior";
    before: unknown;
    after: unknown;
  }>;
  systemChanges: Array<{
    field: string;
    classification: "metadata" | "schedule" | "routing" | "behavior";
    before: unknown;
    after: unknown;
  }>;
  changed: boolean;
  behaviorChanged: boolean;
  paused: boolean;
  pausedByApply: boolean;
  resumeRequired: boolean;
  targetKeysRequiringInitialization: string[];
}

export interface WatchPresetApplyResponse extends WatchPresetPreview {}

export interface JobLocation {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

export interface JobPost {
  id?: string | null;
  title: string;
  companyName?: string | null;
  jobUrl: string;
  applyUrl?: string | null;
  site?: string | null;
  location?: JobLocation | null;
  locations?: JobLocation[];
  description?: string | null;
  jobType?: string[] | null;
  employmentType?: string | null;
  compensation?: {
    minAmount?: number | null;
    maxAmount?: number | null;
    currency?: string | null;
    interval?: string | null;
  } | null;
  datePosted?: string | null;
  isRemote?: boolean | null;
  liveness?: {
    state: "active" | "expired" | "uncertain";
    checkedAt?: string;
  } | null;
  legitimacy?: {
    state: "verified" | "likely" | "uncertain";
    reasons?: string[];
  } | null;
}

export interface SearchInput {
  siteType?: string[];
  searchTerm?: string;
  googleSearchTerm?: string;
  location?: string;
  distance?: number;
  isRemote?: boolean;
  jobType?: string;
  easyApply?: boolean;
  resultsWanted?: number;
  offset?: number;
  hoursOld?: number;
  country?: string;
  descriptionFormat?: "markdown" | "html" | "plain";
  linkedinFetchDescription?: boolean;
  enforceAnnualSalary?: boolean;
  requestTimeout?: number;
  companySlug?: string;
}

export interface SearchResponse {
  count: number;
  jobs: JobPost[];
  cached: boolean;
  deduped: boolean;
  raw_count: number;
}

export interface JobAnalysis {
  summary: {
    totalJobs: number;
    remoteCount: number;
    remotePercentage: number;
    withSalaryCount: number;
    salaryStats?: {
      minSalary: number;
      maxSalary: number;
      avgSalary: number;
      currency: string;
    } | null;
    bySite: Record<string, number>;
    byJobType: Record<string, number>;
    byLocation: Record<string, number>;
  };
  companies: Array<{
    companyName: string;
    openPositions: number;
    locations: string[];
    roles: string[];
    emails: string[];
    companyUrl?: string | null;
  }>;
  siteComparison: SiteComparison[];
}

export interface SiteComparison {
  site: string;
  totalJobs: number;
  withSalary: number;
  remoteJobs: number;
  uniqueCompanies: number;
}

export interface CompareResponse {
  totalJobs: number;
  concurrency: number;
  sourcesRequested: string[];
  sourcesSucceeded: string[];
  sourcesFailed: Array<{ source: string; error: string; durationMs: number }>;
  comparisons: Array<SiteComparison & { durationMs: number }>;
  summary: JobAnalysis["summary"];
}
