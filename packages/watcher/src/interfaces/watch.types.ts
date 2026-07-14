import { JobPostDto } from '@ever-jobs/models';

export type WatchInitializationMode = 'baseline' | 'recent-only' | 'notify-all';
export type WatchMatchStatus = 'new' | 'reviewed' | 'applied' | 'dismissed' | 'interview' | 'rejected' | 'offer';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'suppressed';
export type NotificationType = 'urgent' | 'standard' | 'digest';

export interface JobWatch {
  id: string; name: string; enabled: boolean; description?: string; schedule?: string;
  intervalMinutes: number; timezone: string; sources: string[]; sourceTiers: Record<string, number>;
  companySlugs: string[]; companies: string[]; searchTerms: string[]; requiredTerms: string[];
  preferredTerms: string[]; excludedTerms: string[]; locations: string[]; countryCodes: string[];
  allowedWorkplaceTypes: string[]; allowedEmploymentTypes: string[]; minimumScore: number;
  urgentScore: number; digestScore: number; notificationChannels: NotificationDestination[];
  initializationMode: WatchInitializationMode; recentWindowMinutes?: number; weights?: Record<string, number>;
  initializedAt?: Date | null; lastRunAt?: Date | null; nextRunAt?: Date | null; createdAt: Date; updatedAt: Date;
}
export interface ObservedJob { id: string; fingerprint: string; source: string; sourceType?: string | null; externalJobId?: string | null; company?: string | null; normalizedCompany?: string | null; title: string; normalizedTitle: string; location?: string | null; normalizedLocation?: string | null; workplaceType?: string | null; employmentType?: string | null; description?: string | null; descriptionHash?: string | null; jobUrl?: string | null; applicationUrl?: string | null; sourcePublishedAt?: Date | null; firstSeenAt: Date; lastSeenAt: Date; closedAt?: Date | null; rawPayload?: unknown; createdAt: Date; updatedAt: Date; }
export interface WatchMatch { id: string; watchId: string; observedJobId: string; score: number; scoreBreakdown: ScoreBreakdown; matchedTerms: string[]; excludedReason?: string | null; status: WatchMatchStatus; firstMatchedAt: Date; lastMatchedAt: Date; notificationState: NotificationStatus; createdAt: Date; updatedAt: Date; }
export interface WatchRun { id: string; watchId: string; startedAt: Date; completedAt?: Date | null; status: 'running'|'completed'|'failed'|'partial'; sourcesRequested: string[]; sourcesSucceeded: string[]; sourcesFailed: string[]; jobsFetched: number; jobsNormalized: number; newJobsDetected: number; matchesCreated: number; notificationsSent: number; durationMs?: number; errorSummary?: string | null; createdAt: Date; }
export interface ScoreBreakdown { total: number; role: number; internship: number; location: number; company: number; source: number; skills: number; matchedKeywords: string[]; missingRequired: string[]; exclusionReason?: string; reasons: string[]; }
export interface NotificationDestination { type: 'telegram'|'discord'|'webhook'; destination: string; secretRef?: string; }
export interface JobNotificationMessage { idempotencyKey: string; type: NotificationType; watch: JobWatch; job: ObservedJob; match: WatchMatch; detectedAt: Date; }
export interface NotificationResult { status: NotificationStatus; providerResponse?: unknown; errorMessage?: string; }
export interface NotificationProvider { readonly type: string; send(message: JobNotificationMessage, destination: NotificationDestination): Promise<NotificationResult>; }
export interface WatchRepository { listWatches(): Promise<JobWatch[]>; getWatch(id: string): Promise<JobWatch | null>; createWatch(input: Partial<JobWatch>): Promise<JobWatch>; updateWatch(id: string, input: Partial<JobWatch>): Promise<JobWatch>; createRun(input: Partial<WatchRun> & { watchId: string }): Promise<WatchRun>; completeRun(id: string, patch: Partial<WatchRun>): Promise<WatchRun>; upsertObservedJob(job: Omit<ObservedJob,'id'|'createdAt'|'updatedAt'>): Promise<{ job: ObservedJob; isNew: boolean; descriptionChanged: boolean }>; upsertMatch(match: Omit<WatchMatch,'id'|'createdAt'|'updatedAt'>): Promise<{ match: WatchMatch; isNew: boolean }>; hasNotification(idempotencyKey: string): Promise<boolean>; recordNotification(input: { idempotencyKey: string; watchMatchId: string; channel: string; provider: string; status: NotificationStatus; providerResponse?: unknown; errorMessage?: string }): Promise<void>; listDigestMatches(watchId: string, min: number, max: number): Promise<WatchMatch[]>; }
export interface WatchSourceExecutor { search(input: { watch: JobWatch; searchTerm: string; sources: string[] }): Promise<JobPostDto[]>; }
