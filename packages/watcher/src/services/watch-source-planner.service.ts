import { Injectable } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import { JobWatch } from "../interfaces/watch.types";

export type WatchSourceTier = 1 | 2 | 3;
export type WatchSourceKind = "direct" | "ats" | "structured" | "fragile";
export type WatchSourceMode = "board" | "query";

export const WATCH_SOURCE_TIER_INTERVAL_MINUTES: Readonly<
  Record<WatchSourceTier, number>
> = Object.freeze({
  1: 3,
  2: 15,
  3: 60,
});

export interface WatchSourceTarget {
  /** Stable, human-readable key used in run history. */
  key: string;
  configuredSource: string;
  site: Site;
  tier: WatchSourceTier;
  kind: WatchSourceKind;
  mode: WatchSourceMode;
  companySlug?: string;
}

export interface WatchSourceRequest {
  id: string;
  target: WatchSourceTarget;
  searchTerm?: string;
}

export type WatchSourcePlanIssueCode =
  | "unknown-source"
  | "missing-company-slug"
  | "ambiguous-company-slug"
  | "invalid-company-slug"
  | "unused-company-slug"
  | "invalid-tier"
  | "missing-search-terms";

export interface WatchSourcePlanIssue {
  code: WatchSourcePlanIssueCode;
  source: string;
  message: string;
  severity: "error" | "warning";
}

export interface WatchSourcePlan {
  dueTiers: WatchSourceTier[];
  skippedTiers: WatchSourceTier[];
  targets: WatchSourceTarget[];
  skippedTargets: WatchSourceTarget[];
  requests: WatchSourceRequest[];
  issues: WatchSourcePlanIssue[];
}

export interface WatchSourcePlanOptions {
  now?: Date;
  lastRunAt?: Date | null;
  force?: boolean;
  maxQueryTermsPerSource?: number;
  tierIntervalsMinutes?: Partial<Record<WatchSourceTier, number>>;
}

interface ParsedSource {
  configuredSource: string;
  site: Site;
  kind: WatchSourceKind;
  inlineCompanySlug?: string;
}

interface ParsedCompanySlugs {
  bySite: Map<Site, string[]>;
  bare: string[];
  issues: WatchSourcePlanIssue[];
}

const DEFAULT_MAX_QUERY_TERMS_PER_SOURCE = 4;

const ATS_SITES = new Set<Site>([
  Site.ASHBY,
  Site.GREENHOUSE,
  Site.LEVER,
  Site.WORKABLE,
  Site.SMARTRECRUITERS,
  Site.RIPPLING,
  Site.WORKDAY,
  Site.RECRUITEE,
  Site.TEAMTAILOR,
  Site.BAMBOOHR,
  Site.PERSONIO,
  Site.JAZZHR,
  Site.ICIMS,
  Site.TALEO,
  Site.SUCCESSFACTORS,
  Site.JOBVITE,
  Site.ADP,
  Site.UKG,
  Site.BREEZYHR,
  Site.COMEET,
  Site.PINPOINT,
  Site.MANATAL,
  Site.PAYLOCITY,
  Site.FRESHTEAM,
  Site.BULLHORN,
  Site.TRAKSTAR,
  Site.HIRINGTHING,
  Site.LOXO,
  Site.FOUNTAIN,
  Site.DEEL,
  Site.PHENOM,
  Site.EIGHTFOLD,
  Site.ZOHORECRUIT,
  Site.JOBYLON,
  Site.HOMERUN,
  Site.JOBSCORE,
  Site.TALENTLYFT,
  Site.CRELATE,
  Site.ISMARTRECRUIT,
  Site.RECRUITERFLOW,
  Site.AVATURE,
  Site.GEM,
  Site.JOIN_COM,
  Site.ORACLE,
  Site.MERCOR,
]);

/** Direct integrations used by the default internship watch. */
const DIRECT_SITES = new Set<Site>([
  Site.GOOGLE_CAREERS,
  Site.AMAZON,
  Site.META,
  Site.MICROSOFT,
  Site.APPLE,
  Site.NVIDIA,
  Site.UBER,
  Site.STRIPE,
  Site.OPENAI,
  Site.NETFLIX,
  Site.IBM,
  Site.COINBASE,
  Site.DOORDASH,
  Site.PLAID,
  Site.FIGMA,
  Site.DATADOG,
  Site.VERCEL,
  Site.ANTHROPIC,
  Site.DATABRICKS,
]);

const STRUCTURED_SITES = new Set<Site>([
  Site.GOOGLE,
  Site.CANADAJOBBANK,
  Site.WELLFOUND,
  Site.JOBICY,
  Site.HIMALAYAS,
  Site.REMOTEOK,
  Site.REMOTIVE,
  Site.ARBEITNOW,
  Site.WEWORKREMOTELY,
  Site.THEMUSE,
  Site.WORKINGNOMADS,
  Site.FOURDAYWEEK,
  Site.STARTUPJOBS,
  Site.NODESK,
]);

const FRAGILE_SITES = new Set<Site>([
  Site.LINKEDIN,
  Site.INDEED,
  Site.GLASSDOOR,
  Site.ZIP_RECRUITER,
  Site.SIMPLYHIRED,
  Site.TESLA_PLAYWRIGHT,
]);

const SPECIAL_SOURCE_ALIASES = new Map<string, Site>([
  ["source-company-google", Site.GOOGLE_CAREERS],
  ["source-company-google-careers", Site.GOOGLE_CAREERS],
  ["google-careers", Site.GOOGLE_CAREERS],
]);

const SITE_BY_NORMALIZED_KEY = new Map<string, Site>();
for (const site of Object.values(Site)) {
  SITE_BY_NORMALIZED_KEY.set(normalizeLookupKey(site), site);
}

/**
 * Converts watch configuration into concrete, due source requests.
 *
 * Company and ATS sources are board-shaped: each board is fetched once and
 * all title/location filtering happens after normalization. Search sources are
 * query-shaped and receive a bounded, deterministic subset of search terms.
 */
@Injectable()
export class WatchSourcePlanner {
  plan(watch: JobWatch, options: WatchSourcePlanOptions = {}): WatchSourcePlan {
    const now = options.now ?? new Date();
    const lastRunAt = options.lastRunAt ?? watch.lastRunAt ?? null;
    const intervals = {
      ...WATCH_SOURCE_TIER_INTERVAL_MINUTES,
      ...options.tierIntervalsMinutes,
    };
    const legacyDueTiers = ([1, 2, 3] as WatchSourceTier[]).filter((tier) =>
      this.isTierDue(tier, lastRunAt, now, Boolean(options.force), intervals),
    );
    const issues: WatchSourcePlanIssue[] = [];
    const hasExplicitTargets = (watch.sourceTargets?.length ?? 0) > 0;
    const explicit = hasExplicitTargets
      ? this.buildExplicitTargets(watch, now, Boolean(options.force), issues)
      : null;
    const deduplicatedTargets = deduplicateTargets(
      explicit?.targets ?? this.buildLegacyTargets(watch, issues),
    );
    const targets = deduplicatedTargets.filter((target) =>
      explicit
        ? explicit.dueTargetKeys.has(target.key)
        : legacyDueTiers.includes(target.tier),
    );
    const skippedTargets = deduplicatedTargets.filter(
      (target) => !targets.some((dueTarget) => dueTarget.key === target.key),
    );
    const dueTiers = hasExplicitTargets
      ? uniqueTiers(targets.map((target) => target.tier))
      : legacyDueTiers;
    const skippedTiers = ([1, 2, 3] as WatchSourceTier[]).filter(
      (tier) => !dueTiers.includes(tier),
    );
    const requests = this.buildRequests(
      targets,
      watch.searchTerms,
      options.maxQueryTermsPerSource ?? DEFAULT_MAX_QUERY_TERMS_PER_SOURCE,
      issues,
    );

    return {
      dueTiers,
      skippedTiers,
      targets,
      skippedTargets,
      requests,
      issues,
    };
  }

  isTierDue(
    tier: WatchSourceTier,
    lastRunAt: Date | null | undefined,
    now: Date,
    force = false,
    intervals: Readonly<
      Record<WatchSourceTier, number>
    > = WATCH_SOURCE_TIER_INTERVAL_MINUTES,
  ): boolean {
    if (force || !lastRunAt || Number.isNaN(lastRunAt.getTime())) return true;
    if (Number.isNaN(now.getTime()) || now.getTime() <= lastRunAt.getTime())
      return false;

    const intervalMs = intervals[tier] * 60_000;
    return (
      Math.floor(now.getTime() / intervalMs) >
      Math.floor(lastRunAt.getTime() / intervalMs)
    );
  }

  private buildExplicitTargets(
    watch: JobWatch,
    now: Date,
    force: boolean,
    issues: WatchSourcePlanIssue[],
  ): { targets: WatchSourceTarget[]; dueTargetKeys: Set<string> } {
    const targets: WatchSourceTarget[] = [];
    const dueTargetKeys = new Set<string>();

    for (const configuredTarget of watch.sourceTargets ?? []) {
      if (!configuredTarget.enabled) continue;
      const configuredSource = String(configuredTarget.site);
      const parsed = this.parseSource(configuredSource);
      if (!parsed) {
        issues.push({
          code: "unknown-source",
          source: configuredSource,
          message: `Unknown source "${configuredSource}" in sourceTargets`,
          severity: "error",
        });
        continue;
      }
      const tier = configuredTarget.tier;
      if (tier !== 1 && tier !== 2 && tier !== 3) {
        issues.push({
          code: "invalid-tier",
          source: configuredSource,
          message: `Source tier must be 1, 2, or 3; received ${String(tier)}`,
          severity: "error",
        });
        continue;
      }
      if (parsed.kind === "ats" && !configuredTarget.companySlug?.trim()) {
        issues.push({
          code: "missing-company-slug",
          source: configuredSource,
          message: `ATS source "${parsed.site}" requires companySlug in sourceTargets`,
          severity: "error",
        });
        continue;
      }

      const target = this.toTarget(
        parsed,
        tier,
        configuredTarget.companySlug?.trim(),
      );
      targets.push(target);

      const nextRunAt = validDate(configuredTarget.nextRunAt);
      const targetLastRunAt = validDate(configuredTarget.lastRunAt);
      const intervalMinutes = positiveNumber(configuredTarget.intervalMinutes)
        ? configuredTarget.intervalMinutes
        : WATCH_SOURCE_TIER_INTERVAL_MINUTES[tier];
      const due =
        force ||
        (nextRunAt
          ? nextRunAt.getTime() <= now.getTime()
          : !targetLastRunAt ||
            targetLastRunAt.getTime() + intervalMinutes * 60_000 <=
              now.getTime());
      if (due) dueTargetKeys.add(target.key);
    }

    return { targets, dueTargetKeys };
  }

  private buildLegacyTargets(
    watch: JobWatch,
    issues: WatchSourcePlanIssue[],
  ): WatchSourceTarget[] {
    const parsedSources: ParsedSource[] = [];
    for (const configuredSource of uniqueNonEmpty(watch.sources)) {
      const parsed = this.parseSource(configuredSource);
      if (!parsed) {
        issues.push({
          code: "unknown-source",
          source: configuredSource,
          message: `Unknown source "${configuredSource}"; use a Site value or a registered source package id`,
          severity: "error",
        });
        continue;
      }
      parsedSources.push(parsed);
    }

    const configuredAtsSites = new Set(
      parsedSources
        .filter((source) => source.kind === "ats")
        .map((source) => source.site),
    );
    const slugConfig = this.parseCompanySlugs(watch.companySlugs ?? []);
    issues.push(...slugConfig.issues);

    const targets: WatchSourceTarget[] = [];
    for (const parsed of parsedSources) {
      const tier = this.resolveTier(watch, parsed, issues);
      if (parsed.kind !== "ats") {
        targets.push(this.toTarget(parsed, tier));
        continue;
      }

      const companySlugs = parsed.inlineCompanySlug
        ? [parsed.inlineCompanySlug]
        : (slugConfig.bySite.get(parsed.site) ??
          (configuredAtsSites.size === 1 ? slugConfig.bare : []));
      if (companySlugs.length === 0) {
        issues.push({
          code: "missing-company-slug",
          source: parsed.configuredSource,
          message: `ATS source "${parsed.site}" requires an explicit company slug target`,
          severity: "error",
        });
        continue;
      }
      for (const companySlug of uniqueNonEmpty(companySlugs)) {
        targets.push(this.toTarget(parsed, tier, companySlug));
      }
    }

    if (configuredAtsSites.size > 1 && slugConfig.bare.length > 0) {
      for (const companySlug of slugConfig.bare) {
        issues.push({
          code: "ambiguous-company-slug",
          source: companySlug,
          message: `Company slug "${companySlug}" is ambiguous; configure it as "<ats-site>:${companySlug}"`,
          severity: "error",
        });
      }
    }
    for (const [site, slugs] of slugConfig.bySite.entries()) {
      if (!configuredAtsSites.has(site)) {
        for (const companySlug of slugs) {
          issues.push({
            code: "unused-company-slug",
            source: `${site}:${companySlug}`,
            message: `Company slug targets ATS source "${site}", but that source is not enabled`,
            severity: "warning",
          });
        }
      }
    }
    return targets;
  }

  private parseSource(configuredSource: string): ParsedSource | null {
    const withoutScope = configuredSource.trim().replace(/^@ever-jobs\//i, "");
    const separator = withoutScope.indexOf(":");
    const sourceName =
      separator >= 0 ? withoutScope.slice(0, separator) : withoutScope;
    const inlineCompanySlug =
      separator >= 0 ? withoutScope.slice(separator + 1).trim() : undefined;
    const normalizedName = sourceName.toLowerCase();

    const specialSite = SPECIAL_SOURCE_ALIASES.get(normalizedName);
    const candidate = normalizedName
      .replace(/^source-company-/, "")
      .replace(/^source-ats-/, "")
      .replace(/^source-/, "");
    const site =
      specialSite ?? SITE_BY_NORMALIZED_KEY.get(normalizeLookupKey(candidate));
    if (!site) return null;

    let kind = this.kindForSite(site);
    if (normalizedName.startsWith("source-company-")) kind = "direct";
    if (normalizedName.startsWith("source-ats-")) kind = "ats";
    if (kind !== "ats" && inlineCompanySlug) return null;

    return {
      configuredSource,
      site,
      kind,
      inlineCompanySlug,
    };
  }

  private parseCompanySlugs(companySlugs: string[]): ParsedCompanySlugs {
    const bySite = new Map<Site, string[]>();
    const bare: string[] = [];
    const issues: WatchSourcePlanIssue[] = [];

    for (const rawValue of uniqueNonEmpty(companySlugs)) {
      if (/[:][/][/]|[\\\r\n]/.test(rawValue)) {
        issues.push({
          code: "invalid-company-slug",
          source: rawValue,
          message: `Invalid company slug target "${rawValue}"`,
          severity: "error",
        });
        continue;
      }

      const separator = rawValue.indexOf(":");
      if (separator < 0) {
        bare.push(rawValue);
        continue;
      }

      const prefix = rawValue.slice(0, separator);
      const possibleSite = this.parseSource(prefix)?.site;
      if (!possibleSite || !ATS_SITES.has(possibleSite)) {
        // A compound Workday slug can itself contain colons. If its prefix is
        // not an ATS name, preserve it as a bare slug for a single ATS target.
        bare.push(rawValue);
        continue;
      }

      const companySlug = rawValue.slice(separator + 1).trim();
      if (!companySlug) {
        issues.push({
          code: "invalid-company-slug",
          source: rawValue,
          message: `ATS target "${rawValue}" has an empty company slug`,
          severity: "error",
        });
        continue;
      }
      bySite.set(possibleSite, [
        ...(bySite.get(possibleSite) ?? []),
        companySlug,
      ]);
    }

    return { bySite, bare, issues };
  }

  private resolveTier(
    watch: JobWatch,
    source: ParsedSource,
    issues: WatchSourcePlanIssue[],
  ): WatchSourceTier {
    const categoryKey = source.kind === "fragile" ? "aggregator" : source.kind;
    const configuredTier =
      watch.sourceTiers?.[source.configuredSource] ??
      watch.sourceTiers?.[source.site] ??
      watch.sourceTiers?.[categoryKey];

    if (configuredTier !== undefined) {
      if (
        configuredTier === 1 ||
        configuredTier === 2 ||
        configuredTier === 3
      ) {
        return configuredTier;
      }
      issues.push({
        code: "invalid-tier",
        source: source.configuredSource,
        message: `Source tier must be 1, 2, or 3; received ${String(configuredTier)}`,
        severity: "warning",
      });
    }

    if (source.kind === "direct" || source.kind === "ats") return 1;
    if (source.kind === "fragile") return 3;
    return 2;
  }

  private kindForSite(site: Site): WatchSourceKind {
    if (ATS_SITES.has(site)) return "ats";
    if (DIRECT_SITES.has(site)) return "direct";
    if (FRAGILE_SITES.has(site)) return "fragile";
    if (STRUCTURED_SITES.has(site)) return "structured";
    // Unknown-but-real plugins are conservatively treated as structured.
    // Users can promote/demote them through sourceTiers without accidentally
    // polling a new integration every three minutes.
    return "structured";
  }

  private toTarget(
    source: ParsedSource,
    tier: WatchSourceTier,
    companySlug?: string,
  ): WatchSourceTarget {
    return {
      key: companySlug ? `${source.site}:${companySlug}` : source.site,
      configuredSource: source.configuredSource,
      site: source.site,
      tier,
      kind: source.kind,
      mode:
        source.kind === "direct" || source.kind === "ats" ? "board" : "query",
      companySlug,
    };
  }

  private buildRequests(
    targets: WatchSourceTarget[],
    configuredTerms: string[],
    maxQueryTermsPerSource: number,
    issues: WatchSourcePlanIssue[],
  ): WatchSourceRequest[] {
    const queryTargets = targets.filter((target) => target.mode === "query");
    const searchTerms = this.selectSearchTerms(
      configuredTerms,
      maxQueryTermsPerSource,
    );
    if (queryTargets.length > 0 && searchTerms.length === 0) {
      issues.push({
        code: "missing-search-terms",
        source: queryTargets.map((target) => target.key).join(","),
        message:
          "Query-style sources require at least one non-empty search term",
        severity: "error",
      });
    }

    const requests: WatchSourceRequest[] = [];
    for (const target of targets) {
      if (target.mode === "board") {
        requests.push({ id: target.key, target });
        continue;
      }
      for (const [index, searchTerm] of searchTerms.entries()) {
        requests.push({
          id: `${target.key}:query-${index + 1}`,
          target,
          searchTerm,
        });
      }
    }
    return requests;
  }

  private selectSearchTerms(
    configuredTerms: string[],
    maximum: number,
  ): string[] {
    const terms = uniqueNonEmpty(configuredTerms);
    const budget = Math.max(0, Math.floor(maximum));
    if (terms.length <= budget) return terms;
    if (budget === 0) return [];
    if (budget === 1) return [terms[0]];

    const selected = new Set<string>();
    for (let index = 0; index < budget; index++) {
      const sourceIndex = Math.round(
        (index * (terms.length - 1)) / (budget - 1),
      );
      selected.add(terms[sourceIndex]);
    }
    return [...selected];
  }
}

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function uniqueNonEmpty(values: string[] | null | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}

function deduplicateTargets(targets: WatchSourceTarget[]): WatchSourceTarget[] {
  const byKey = new Map<string, WatchSourceTarget>();
  for (const target of targets) byKey.set(target.key, target);
  return [...byKey.values()];
}

function uniqueTiers(tiers: WatchSourceTier[]): WatchSourceTier[] {
  return [...new Set(tiers)].sort((left, right) => left - right);
}

function validDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function positiveNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
