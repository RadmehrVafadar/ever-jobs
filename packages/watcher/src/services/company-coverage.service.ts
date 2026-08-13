import { normalizeCompany } from "@ever-jobs/common";
import { Injectable } from "@nestjs/common";
import {
  JobWatch,
  WatchSourceTarget,
  WatchTargetHealth,
} from "../interfaces/watch.types";
import { watchSourceTargetKey } from "./watch-preset.service";
import { WatcherMetricsService } from "./watcher-metrics.service";

export type CompanyCoverageStatus = "active" | "disabled" | "uncovered";

export interface CompanyCoverageSummary {
  configured: number;
  active: number;
  disabled: number;
  uncovered: number;
  initialized: number;
  degraded: number;
}

export interface CompanyCoverageCompany {
  company: string;
  status: CompanyCoverageStatus;
  targetKeys: string[];
  initialized: boolean;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastNonEmptyAt: Date | null;
  consecutiveHardFailures: number;
  degraded: boolean;
}

export interface CompanyCoverageReport {
  watchId: string;
  summary: CompanyCoverageSummary;
  companies: CompanyCoverageCompany[];
}

/** Generic discovery sources are redundancy, not first-class company coverage. */
const GENERIC_DISCOVERY_SITES = new Set([
  "canadajobbank",
  "google",
  "linkedin",
]);

const DEGRADED_FAILURE_THRESHOLD = 3;

/**
 * Project a watch's configured companies onto its explicitly branded targets.
 * The function is intentionally pure so API, CLI, and metrics consumers share
 * exactly the same coverage semantics.
 */
export function buildCompanyCoverageReport(
  watch: JobWatch,
): CompanyCoverageReport {
  const companies = watch.companies.map((company) =>
    companyCoverage(watch, company),
  );

  return {
    watchId: watch.id,
    summary: {
      configured: companies.length,
      active: companies.filter(({ status }) => status === "active").length,
      disabled: companies.filter(({ status }) => status === "disabled").length,
      uncovered: companies.filter(({ status }) => status === "uncovered").length,
      initialized: companies.filter(({ initialized }) => initialized).length,
      degraded: companies.filter(({ degraded }) => degraded).length,
    },
    companies,
  };
}

@Injectable()
export class CompanyCoverageService {
  constructor(private readonly metrics: WatcherMetricsService) {}

  build(watch: JobWatch): CompanyCoverageReport {
    const report = buildCompanyCoverageReport(watch);
    this.metrics.setCompanyCoverage(watch.id, report.summary);
    return report;
  }
}

function companyCoverage(
  watch: JobWatch,
  company: string,
): CompanyCoverageCompany {
  const normalizedCompany = normalizeCompany(company);
  // companyName is the coverage contract. A slug-only target may execute, but
  // it remains uncovered until an operator supplies an explicit brand name.
  const targets = watch.sourceTargets.filter(
    (target) =>
      normalizedCompany.length > 0 &&
      !isGenericDiscoveryTarget(target) &&
      normalizeCompany(target.companyName) === normalizedCompany,
  );
  const enabledTargets = targets.filter(({ enabled }) => enabled);
  const status: CompanyCoverageStatus =
    targets.length === 0
      ? "uncovered"
      : enabledTargets.length > 0
        ? "active"
        : "disabled";
  const targetKeys = targets.map(watchSourceTargetKey);
  const relevantTargets = enabledTargets.length > 0 ? enabledTargets : targets;
  const health = relevantTargets
    .map(watchSourceTargetKey)
    .map((key) => watch.targetHealth?.[key])
    .filter((entry): entry is WatchTargetHealth => Boolean(entry));

  return {
    company,
    status,
    targetKeys,
    initialized: areTargetsInitialized(watch, targets, enabledTargets),
    lastAttemptAt: latestDate(health.map(({ lastAttemptAt }) => lastAttemptAt)),
    lastSuccessAt: latestDate(health.map(({ lastSuccessAt }) => lastSuccessAt)),
    lastNonEmptyAt: latestDate(
      health.map(({ lastNonEmptyAt }) => lastNonEmptyAt),
    ),
    consecutiveHardFailures: Math.max(
      0,
      ...health.map(({ consecutiveHardFailures }) => consecutiveHardFailures),
    ),
    degraded: health.some(
      ({ tier, consecutiveHardFailures }) =>
        tier === 1 &&
        consecutiveHardFailures >= DEGRADED_FAILURE_THRESHOLD,
    ),
  };
}

function areTargetsInitialized(
  watch: JobWatch,
  targets: readonly WatchSourceTarget[],
  enabledTargets: readonly WatchSourceTarget[],
): boolean {
  if (targets.length === 0) return false;
  const relevantTargets =
    enabledTargets.length > 0 ? enabledTargets : targets;
  return relevantTargets.every((target) =>
    target.initializedAt === undefined
      ? Boolean(watch.initializedAt)
      : Boolean(target.initializedAt),
  );
}

function latestDate(
  candidates: ReadonlyArray<Date | null | undefined>,
): Date | null {
  let latest: Date | null = null;
  for (const candidate of candidates) {
    if (
      candidate &&
      !Number.isNaN(candidate.getTime()) &&
      (!latest || candidate.getTime() > latest.getTime())
    ) {
      latest = candidate;
    }
  }
  return latest;
}

function isGenericDiscoveryTarget(target: WatchSourceTarget): boolean {
  return GENERIC_DISCOVERY_SITES.has(String(target.site).trim().toLowerCase());
}
