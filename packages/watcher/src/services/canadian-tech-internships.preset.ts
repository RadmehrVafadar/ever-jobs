import { Site } from "@ever-jobs/models";
import { normalizeCompany } from "@ever-jobs/common";
import {
  JobWatch,
  WatchSearchScope,
  WatchSourceTarget,
} from "../interfaces/watch.types";

export const CANADIAN_TECH_INTERNSHIPS_ID = "canadian-tech-internships";
export const CANADIAN_TECH_INTERNSHIPS_VERSION = 1;
export const CANADIAN_TECH_INTERNSHIPS_NAME = "Canadian Tech Internships";

export interface WatchPresetDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  applyPolicy?: {
    locations?: "merge" | "replace";
    countryCodes?: "merge" | "replace";
    roleFamilies?: "merge" | "replace";
  };
  createWatch(): Partial<JobWatch>;
}

export type WatchPresetApplyPolicy = NonNullable<
  WatchPresetDefinition["applyPolicy"]
>;

export const CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS = [
  "summer 2027 software engineer intern",
  "summer 2027 software developer intern",
  "summer 2027 software engineering internship",
  "summer 2027 software engineering co-op",
  "summer 2027 software developer co-op",
  "summer 2027 backend engineer intern",
  "summer 2027 frontend engineer intern",
  "summer 2027 full stack engineer intern",
  "summer 2027 mobile engineer intern",
  "summer 2027 developer experience intern",
  "summer 2027 platform engineer intern",
  "summer 2027 cloud engineer intern",
  "summer 2027 infrastructure engineer intern",
  "summer 2027 site reliability engineer intern",
  "summer 2027 devops engineer intern",
  "summer 2027 security engineer intern",
  "summer 2027 data engineer intern",
  "summer 2027 machine learning engineer intern",
  "summer 2027 AI engineer intern",
] as const;

export const CANADIAN_TECH_INTERNSHIP_LOCATIONS = [
  "Toronto, Ontario",
  "Greater Toronto Area",
  "Mississauga, Ontario",
  "Brampton, Ontario",
  "Vaughan, Ontario",
  "Richmond Hill, Ontario",
  "Markham, Ontario",
  "Oakville, Ontario",
  "Burlington, Ontario",
  "Pickering, Ontario",
  "Ajax, Ontario",
] as const;

export const CANADIAN_TECH_INTERNSHIP_COMPANIES = [
  "Google",
  "Amazon",
  "Meta",
  "Shopify",
  "Wealthsimple",
  "Microsoft",
  "Apple",
  "Nvidia",
  "Uber",
  "Stripe",
  "OpenAI",
  "Datadog",
  "DoorDash",
  "Coinbase",
  "Notion",
  "Figma",
  "Ramp",
  "Plaid",
  "Vercel",
  "Netflix",
  "IBM",
  "RBC",
  "TD",
  "Scotiabank",
  "BMO",
  "CIBC",
] as const;

export const CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES = [
  "RBC",
  "TD",
  "Scotiabank",
  "BMO",
  "CIBC",
] as const;

const PREFERRED_TERMS = [
  "Python",
  "Java",
  "Go",
  "C",
  "C++",
  "JavaScript",
  "TypeScript",
  "SQL",
  "Bash",
  "React",
  "Next.js",
  "Flask",
  "Docker",
  "Docker Compose",
  "Kubernetes",
  "Terraform",
  "GitHub Actions",
  "Google Cloud Platform",
  "Apache Kafka",
  "PostgreSQL",
  "Linux",
  "Auth0",
  "Identity and Access Management",
  "IAM",
  "RBAC",
  "Distributed Systems",
  "Backend",
  "Frontend",
  "Full Stack",
  "Mobile",
  "Developer Experience",
  "Platform",
  "Cloud",
  "Infrastructure",
  "SRE",
  "DevOps",
  "Security",
  "Data Engineering",
  "Machine Learning",
  "Artificial Intelligence",
  "API",
  "Authentication",
  "Authorization",
] as const;

const EXCLUDED_TERMS = [
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "architect",
  "5+ years",
  "7+ years",
  "10+ years",
  "phd",
  "ph.d",
  "ph.d.",
  "doctoral",
  "doctorate",
  "united states only",
  "us only",
  "usa only",
  "must reside in the united states",
] as const;

const LEGACY_DIRECT_TARGETS: ReadonlyArray<{
  site: Site;
  companyName: string;
}> = [
  { site: Site.AMAZON, companyName: "Amazon" },
  { site: Site.MICROSOFT, companyName: "Microsoft" },
  { site: Site.APPLE, companyName: "Apple" },
  { site: Site.NVIDIA, companyName: "Nvidia" },
  { site: Site.STRIPE, companyName: "Stripe" },
  { site: Site.OPENAI, companyName: "OpenAI" },
  { site: Site.DATADOG, companyName: "Datadog" },
  { site: Site.DOORDASH, companyName: "DoorDash" },
  { site: Site.COINBASE, companyName: "Coinbase" },
  { site: Site.FIGMA, companyName: "Figma" },
  { site: Site.VERCEL, companyName: "Vercel" },
  { site: Site.META, companyName: "Meta" },
  { site: Site.WELLFOUND, companyName: "Wellfound" },
];

const PHASE_13_DIRECT_TARGETS: ReadonlyArray<{
  site: Site;
  companyName: string;
}> = [
  { site: Site.UBER, companyName: "Uber" },
  { site: Site.NOTION, companyName: "Notion" },
  { site: Site.RAMP, companyName: "Ramp" },
  { site: Site.NETFLIX, companyName: "Netflix" },
  { site: Site.IBM, companyName: "IBM" },
];

const GENERIC_DISCOVERY_SITES = new Set<Site>([
  Site.CANADAJOBBANK,
  Site.GOOGLE,
  Site.LINKEDIN,
]);

function scope(
  countryCodes: readonly string[],
  locations: readonly string[],
  options: {
    searchTerms?: readonly string[];
    maxRequestsPerRun?: number;
  } = {},
): WatchSearchScope {
  return {
    countryCodes: [...countryCodes],
    locations: [...locations],
    strictLocations: true,
    ...(options.searchTerms ? { searchTerms: [...options.searchTerms] } : {}),
    ...(options.maxRequestsPerRun === undefined
      ? {}
      : { maxRequestsPerRun: options.maxRequestsPerRun }),
  };
}

export const createCanadianInternshipSearchScope = scope;

function inheritedScope(
  options: {
    searchTerms?: readonly string[];
    maxRequestsPerRun?: number;
  } = {},
): WatchSearchScope {
  return {
    strictLocations: true,
    ...(options.searchTerms ? { searchTerms: [...options.searchTerms] } : {}),
    ...(options.maxRequestsPerRun === undefined
      ? {}
      : { maxRequestsPerRun: options.maxRequestsPerRun }),
  };
}

function target(
  input: Omit<WatchSourceTarget, "initializedAt" | "lastRunAt" | "nextRunAt">,
): WatchSourceTarget {
  return {
    ...input,
    searchScope: input.searchScope
      ? {
          ...(input.searchScope.countryCodes
            ? { countryCodes: [...input.searchScope.countryCodes] }
            : {}),
          ...(input.searchScope.locations
            ? { locations: [...input.searchScope.locations] }
            : {}),
          ...(input.searchScope.strictLocations === undefined
            ? {}
            : { strictLocations: input.searchScope.strictLocations }),
          ...(input.searchScope.searchTerms
            ? { searchTerms: [...input.searchScope.searchTerms] }
            : {}),
          ...(input.searchScope.maxRequestsPerRun === undefined
            ? {}
            : { maxRequestsPerRun: input.searchScope.maxRequestsPerRun }),
        }
      : undefined,
    initializedAt: null,
    lastRunAt: null,
    nextRunAt: null,
  };
}

export const createCanadianInternshipSourceTarget = target;

export function canadianTechInternshipSourceTargets(): WatchSourceTarget[] {
  const gtaScope = () => inheritedScope();
  const targets: WatchSourceTarget[] = [
    target({
      site: Site.GOOGLE_CAREERS,
      companyName: "Google",
      tier: 1,
      enabled: true,
      searchScope: inheritedScope({
        searchTerms: CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS,
        maxRequestsPerRun: 1,
      }),
    }),
    target({
      site: Site.SHOPIFY,
      companyName: "Shopify",
      tier: 1,
      enabled: true,
      searchScope: gtaScope(),
    }),
    target({
      site: Site.ASHBY,
      companySlug: "wealthsimple",
      companyName: "Wealthsimple",
      tier: 1,
      enabled: true,
      searchScope: gtaScope(),
    }),
    target({
      site: Site.ASHBY,
      companySlug: "plaid",
      companyName: "Plaid",
      tier: 1,
      enabled: true,
      searchScope: gtaScope(),
    }),
    ...LEGACY_DIRECT_TARGETS.map(({ site, companyName }) =>
      target({
        site,
        companyName,
        tier: 1,
        enabled: true,
        searchScope: gtaScope(),
      }),
    ),
    ...PHASE_13_DIRECT_TARGETS.map(({ site, companyName }) =>
      target({
        site,
        companyName,
        tier: 1,
        resultsWanted: 500,
        enabled: true,
        searchScope: gtaScope(),
      }),
    ),
    target({
      site: Site.CANADAJOBBANK,
      companyName: "Canada Job Bank",
      tier: 2,
      enabled: true,
      searchScope: inheritedScope({
        searchTerms: CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS,
        maxRequestsPerRun: 12,
      }),
    }),
    target({
      site: Site.GOOGLE,
      companyName: "Google Jobs",
      tier: 2,
      enabled: false,
      searchScope: inheritedScope({
        searchTerms: CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS,
        maxRequestsPerRun: 12,
      }),
    }),
    target({
      site: Site.LINKEDIN,
      companyName: "LinkedIn public guest search",
      tier: 3,
      enabled: true,
      searchScope: inheritedScope({
        searchTerms: CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS,
        maxRequestsPerRun: 8,
      }),
    }),
  ];
  return targets;
}

export function canadianTechInternshipsWatch(): Partial<JobWatch> {
  const targets = canadianTechInternshipSourceTargets();
  assertCanadianTechInternshipCompanyCoverage(targets);
  const sources = [...new Set(targets.map(({ site }) => String(site)))];
  return {
    name: CANADIAN_TECH_INTERNSHIPS_NAME,
    description:
      "Toronto and Greater Toronto Area monitoring for Summer 2027 technology internships and co-ops.",
    enabled: false,
    intervalMinutes: 10,
    timezone: "America/Toronto",
    sources,
    sourceTargets: targets,
    sourceTiers: Object.fromEntries(
      targets.map(({ site, tier }) => [String(site), tier]),
    ),
    companySlugs: ["ashby:wealthsimple", "ashby:plaid"],
    companies: [...CANADIAN_TECH_INTERNSHIP_COMPANIES],
    searchTerms: [...CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS],
    requiredTerms: ["intern", "internship", "co-op", "coop", "summer 2027"],
    preferredTerms: [...PREFERRED_TERMS],
    excludedTerms: [...EXCLUDED_TERMS],
    locations: [...CANADIAN_TECH_INTERNSHIP_LOCATIONS],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship", "co-op"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [{ type: "discord", destinationRef: "default" }],
    initializationMode: "baseline",
    recentWindowMinutes: 180,
  };
}

/**
 * Prevents a ranking-only company from silently appearing covered. Every
 * target company must have a branded target or an explicit deferred entry.
 */
export function assertCanadianTechInternshipCompanyCoverage(
  targets: readonly WatchSourceTarget[],
): void {
  const covered = new Set(
    targets
      .filter(
        (candidate) => !GENERIC_DISCOVERY_SITES.has(candidate.site as Site),
      )
      .map((candidate) => candidate.companyName?.trim())
      .filter((name): name is string => Boolean(name))
      .map(normalizeCompany),
  );
  const deferred = new Set(
    CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES.map(normalizeCompany),
  );
  const unclassified = CANADIAN_TECH_INTERNSHIP_COMPANIES.filter((company) => {
    const key = normalizeCompany(company);
    return !covered.has(key) && !deferred.has(key);
  });
  if (unclassified.length > 0) {
    throw new Error(
      `Canadian Tech Internships companies require a branded target or explicit deferral: ${unclassified.join(", ")}`,
    );
  }
}

export const CANADIAN_TECH_INTERNSHIPS_PRESET: WatchPresetDefinition =
  Object.freeze<WatchPresetDefinition>({
    id: CANADIAN_TECH_INTERNSHIPS_ID,
    version: CANADIAN_TECH_INTERNSHIPS_VERSION,
    name: CANADIAN_TECH_INTERNSHIPS_NAME,
    description:
      "Summer 2027 technology internships and co-ops in Toronto and the Greater Toronto Area.",
    applyPolicy: {
      locations: "replace",
      countryCodes: "replace",
    },
    createWatch: canadianTechInternshipsWatch,
  });
