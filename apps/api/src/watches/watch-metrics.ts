import {
  JobWatch,
  ObservedJob,
  Page,
  WatchMatch,
  WatchRepository,
  WatchRun,
} from "@ever-jobs/watcher";

const PAGE_SIZE = 200;
const MAX_METRIC_ROWS = 10_000;
const MAX_JOB_SAMPLES = 2_000;
const JOB_FETCH_CONCURRENCY = 25;

interface LoadedPage<T> {
  items: T[];
  total: number;
  truncated: boolean;
}

export async function collectWatchMetrics(
  repository: WatchRepository,
  watch: JobWatch,
): Promise<Record<string, unknown>> {
  const [runData, matchData, deliveryData] = await Promise.all([
    collectPages((offset, limit) =>
      repository.listRuns({ watchId: watch.id, offset, limit }),
    ),
    collectPages((offset, limit) =>
      repository.listMatches({ watchId: watch.id, offset, limit }),
    ),
    collectPages((offset, limit) =>
      repository.listNotifications({ watchId: watch.id, offset, limit }),
    ),
  ]);

  const matchesForJobMetrics = matchData.items.slice(0, MAX_JOB_SAMPLES);
  const jobs = await loadObservedJobs(repository, matchesForJobMetrics);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const matchesById = new Map(
    matchData.items.map((match) => [match.id, match]),
  );

  const publicationToDetection: number[] = [];
  const detectionToMatch: number[] = [];
  for (const match of matchesForJobMetrics) {
    const job = jobsById.get(match.observedJobId);
    if (!job) continue;
    if (job.sourcePublishedAt) {
      pushNonNegativeDuration(
        publicationToDetection,
        job.firstSeenAt.getTime() - job.sourcePublishedAt.getTime(),
      );
    }
    pushNonNegativeDuration(
      detectionToMatch,
      match.firstMatchedAt.getTime() - job.firstSeenAt.getTime(),
    );
  }

  const detectionToNotification: number[] = [];
  const publicationToNotification: number[] = [];
  for (const delivery of deliveryData.items) {
    if (!delivery.sentAt) continue;
    const match = matchesById.get(delivery.watchMatchId);
    const job = match ? jobsById.get(match.observedJobId) : undefined;
    if (!job) continue;
    pushNonNegativeDuration(
      detectionToNotification,
      delivery.sentAt.getTime() - job.firstSeenAt.getTime(),
    );
    if (job.sourcePublishedAt) {
      pushNonNegativeDuration(
        publicationToNotification,
        delivery.sentAt.getTime() - job.sourcePublishedAt.getTime(),
      );
    }
  }

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);

  return {
    watchId: watch.id,
    generatedAt: new Date().toISOString(),
    scope: {
      runs: runData.total,
      matches: matchData.total,
      deliveries: deliveryData.total,
      observedJobSample: jobs.length,
      truncated:
        runData.truncated ||
        matchData.truncated ||
        deliveryData.truncated ||
        matchData.items.length > matchesForJobMetrics.length,
    },
    jobsDiscoveredToday: matchData.items.filter(
      (match) => match.firstMatchedAt >= startOfUtcDay,
    ).length,
    matchesByScore: scoreBands(matchData.items, watch),
    matchesByStatus: countBy(matchData.items, (match) => match.status),
    applicationsSubmitted: matchData.items.filter((match) =>
      ["applied", "interview", "rejected", "offer"].includes(match.status),
    ).length,
    medianDetectionLatencyMs: median(publicationToDetection),
    medianMatchLatencyMs: median(detectionToMatch),
    medianNotificationLatencyMs: median(detectionToNotification),
    medianPublicationToNotificationLatencyMs: median(publicationToNotification),
    latencySampleSizes: {
      publicationToDetection: publicationToDetection.length,
      detectionToMatch: detectionToMatch.length,
      detectionToNotification: detectionToNotification.length,
      publicationToNotification: publicationToNotification.length,
    },
    sourceSuccessRates: sourceSuccessRates(runData.items),
    jobsByCompany: countBy(jobs, (job) => job.company ?? "Unknown"),
    jobsBySource: countBy(jobs, (job) => job.source),
    jobsByLocation: countBy(jobs, (job) => job.location ?? "Unknown"),
    notificationsByStatus: countBy(
      deliveryData.items,
      (delivery) => delivery.status,
    ),
    notificationsSent: deliveryData.items.filter(
      (delivery) => delivery.status === "sent",
    ).length,
    notificationFailures: deliveryData.items.filter(
      (delivery) => delivery.status === "failed",
    ).length,
    runStatuses: countBy(runData.items, (run) => run.status),
    recentRuns: runData.items.slice(0, 10),
  };
}

async function collectPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
): Promise<LoadedPage<T>> {
  const items: T[] = [];
  let offset = 0;
  let total = 0;
  do {
    const page = await fetchPage(offset, PAGE_SIZE);
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0) break;
    offset += page.items.length;
  } while (items.length < total && items.length < MAX_METRIC_ROWS);
  return {
    items: items.slice(0, MAX_METRIC_ROWS),
    total,
    truncated: total > MAX_METRIC_ROWS,
  };
}

async function loadObservedJobs(
  repository: WatchRepository,
  matches: WatchMatch[],
): Promise<ObservedJob[]> {
  const ids = [...new Set(matches.map((match) => match.observedJobId))];
  const jobs: ObservedJob[] = [];
  for (let index = 0; index < ids.length; index += JOB_FETCH_CONCURRENCY) {
    const batch = ids.slice(index, index + JOB_FETCH_CONCURRENCY);
    const rows = await Promise.all(
      batch.map((id) => repository.getObservedJob(id)),
    );
    jobs.push(...rows.filter((row): row is ObservedJob => row !== null));
  }
  return jobs;
}

function scoreBands(
  matches: WatchMatch[],
  watch: JobWatch,
): Record<string, number> {
  const result = {
    urgent: 0,
    immediate: 0,
    digest: 0,
    silent: 0,
    excluded: 0,
  };
  for (const match of matches) {
    if (match.excludedReason) result.excluded += 1;
    else if (match.score >= watch.urgentScore) result.urgent += 1;
    else if (match.score >= watch.minimumScore) result.immediate += 1;
    else if (match.score >= watch.digestScore) result.digest += 1;
    else result.silent += 1;
  }
  return result;
}

function sourceSuccessRates(runs: WatchRun[]): Array<Record<string, unknown>> {
  const sources = new Map<
    string,
    { requested: number; succeeded: number; failed: number }
  >();
  for (const run of runs) {
    const succeeded = new Set(run.sourcesSucceeded);
    const failed = new Set(run.sourcesFailed);
    for (const source of new Set(run.sourcesRequested)) {
      const current = sources.get(source) ?? {
        requested: 0,
        succeeded: 0,
        failed: 0,
      };
      current.requested += 1;
      if (succeeded.has(source)) current.succeeded += 1;
      if (failed.has(source)) current.failed += 1;
      sources.set(source, current);
    }
  }
  return [...sources.entries()]
    .map(([source, counts]) => ({
      source,
      ...counts,
      successRate:
        counts.requested === 0 ? null : counts.succeeded / counts.requested,
    }))
    .sort((left, right) =>
      String(left.source).localeCompare(String(right.source)),
    );
}

function countBy<T>(
  values: T[],
  keyFor: (value: T) => string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function pushNonNegativeDuration(target: number[], value: number): void {
  if (Number.isFinite(value) && value >= 0) target.push(value);
}
