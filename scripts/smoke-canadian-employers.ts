/**
 * Opt-in live smoke for the first Spec 6004 Canadian-employer cohort.
 *
 * The command invokes the same source services used by the application. It is
 * intentionally excluded from normal CI because every request reaches an
 * employer-owned public career system. Run it explicitly with:
 *
 *   npm run smoke:canadian-employers
 *
 * Use `--json` for machine-readable output and `--company <name-or-id>` to
 * restrict the run. An empty board is reported separately from a parser or
 * transport failure. `officialResultCount` is null when the normalized source
 * contract does not expose an upstream-advertised total; the command never
 * substitutes the capped parsed count for that value.
 */
import {
  Country,
  IScraper,
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
} from '@ever-jobs/models';

export type CanadianEmployerAdapter =
  | 'workday'
  | 'icims'
  | 'successfactors'
  | 'yello'
  | 'accenture';

export interface CanadianEmployerSmokeTarget {
  id: string;
  employer: string;
  adapter: CanadianEmployerAdapter;
  companySlug?: string;
  companyUrl?: string;
  allowedDirectHosts: string[];
  searchTerm?: string;
}

export interface CanadianEmployerSmokeReport {
  id: string;
  employer: string;
  adapter: CanadianEmployerAdapter;
  status: 'pass' | 'empty' | 'fail';
  officialResultCount: number | null;
  parsedCount: number;
  gtaCount: number;
  summer2027Count: number;
  roleMatchCount: number;
  gtaSummer2027Count: number;
  gtaSummer2027RoleMatchCount: number;
  directUrlCount: number;
  invalidDirectUrlCount: number;
  durationMs: number;
  error?: string;
}

/**
 * Twenty employer groups map to 22 endpoints because Loblaw uses three
 * independently deployed Workday career sites.
 */
export const CANADIAN_EMPLOYER_SMOKE_TARGETS: readonly CanadianEmployerSmokeTarget[] = [
  workday('rbc', 'RBC', 'rbc:3:RBCEARLYTALENT1'),
  workday('td', 'TD', 'td:3:TD_Bank_Careers'),
  successFactors(
    'scotiabank',
    'Scotiabank',
    'scotiabank',
    'https://jobs.scotiabank.com/go/Student-%26-New-Grad-Jobs/2298417/',
  ),
  workday('bmo', 'BMO', 'bmo:3:Campus'),
  workday('cibc', 'CIBC', 'cibc:3:campus'),
  {
    id: 'kpmg',
    employer: 'KPMG',
    adapter: 'icims',
    companySlug: 'students-kpmgca',
    companyUrl: 'https://careers.kpmg.ca/students/jobs',
    allowedDirectHosts: ['students-kpmgca.icims.com', 'careers.kpmg.ca'],
    searchTerm: 'intern',
  },
  workday('pwc', 'PwC', 'pwc:3:Global_Campus_Careers'),
  successFactors(
    'deloitte-canada',
    'Deloitte Canada',
    'deloitte-ca',
    'https://careers.deloitte.ca/search/',
  ),
  {
    id: 'ey-canada',
    employer: 'EY Canada',
    adapter: 'yello',
    companySlug: 'c1riT--B2O-KySgYWsZO1Q',
    companyUrl: 'https://eyglobal.yello.co',
    allowedDirectHosts: ['eyglobal.yello.co'],
    searchTerm: 'intern',
  },
  {
    id: 'accenture-canada',
    employer: 'Accenture Canada',
    adapter: 'accenture',
    allowedDirectHosts: [
      'accenture.com',
      'accenture.wd*.myworkdayjobs.com',
      // Accenture Infrastructure & Capital Projects (formerly Comtech Group)
      // remains on its branded Deltek tenant while appearing in Accenture's
      // official Canadian careers feed.
      'teamcomtech.hua.hrsmart.com',
    ],
    searchTerm: 'intern',
  },
  workday('aritzia', 'Aritzia', 'aritzia:3:Calling_New_Graduates'),
  workday('loblaw', 'Loblaw', 'myview:3:loblaw_careers'),
  workday('loblaw-pc-financial', 'Loblaw', 'myview:3:pc_financial'),
  workday('loblaw-shoppers', 'Loblaw', 'myview:3:sdm_careers'),
  workday(
    'canadian-tire',
    'Canadian Tire',
    'canadiantirecorporation:3:Enterprise_External_Careers_Site',
  ),
  workday(
    'canada-goose',
    'Canada Goose',
    'canadagoose:3:CanadaGooseCareers',
  ),
  workday('manulife', 'Manulife', 'manulife:3:MFCJH_Jobs'),
  workday('sun-life', 'Sun Life', 'sunlife:3:Campus'),
  workday('intact', 'Intact', 'intactfc:3:intactfc'),
  successFactors(
    'bell',
    'Bell',
    'bell-ca',
    'https://jobs.bell.ca/ca/en/search-results',
  ),
  successFactors(
    'rogers',
    'Rogers',
    'rogers-ca',
    'https://jobs.rogers.com/search/',
  ),
  successFactors(
    'telus',
    'TELUS',
    'telus-ca',
    'https://careers.telus.com/search/',
  ),
] as const;

function workday(
  id: string,
  employer: string,
  companySlug: string,
): CanadianEmployerSmokeTarget {
  const company = companySlug.split(':')[0];
  const wdNumber = companySlug.split(':')[1];
  return {
    id,
    employer,
    adapter: 'workday',
    companySlug,
    allowedDirectHosts: [`${company}.wd${wdNumber}.myworkdayjobs.com`],
    searchTerm: 'intern',
  };
}

function successFactors(
  id: string,
  employer: string,
  companySlug: string,
  companyUrl: string,
): CanadianEmployerSmokeTarget {
  return {
    id,
    employer,
    adapter: 'successfactors',
    companySlug,
    companyUrl,
    allowedDirectHosts: [new URL(companyUrl).hostname],
    searchTerm: 'intern',
  };
}

export function employerGroupCount(
  targets: readonly CanadianEmployerSmokeTarget[] = CANADIAN_EMPLOYER_SMOKE_TARGETS,
): number {
  return new Set(targets.map(({ employer }) => employer)).size;
}

export function isGtaJob(job: JobPostDto): boolean {
  const locationText = [job.location, ...(job.locations ?? [])]
    .flatMap((location) => [
      location?.city,
      location?.state,
      location?.country,
    ])
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  return GTA_PATTERN.test(locationText);
}

export function isSummer2027Job(job: JobPostDto): boolean {
  const evidence = [job.title, job.description, job.employmentType]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return SUMMER_2027_PATTERN.test(evidence) || MAY_AUGUST_2027_PATTERN.test(evidence);
}

export type CanadianInternshipRoleFamily =
  | 'software-engineering'
  | 'data-ai'
  | 'cybersecurity'
  | 'cloud-platform-infrastructure'
  | 'qa-automation'
  | 'technical-product'
  | 'ux-product-design'
  | 'systems-business-analysis'
  | 'technology-risk-it-audit';

/** Pure nine-family diagnostic matcher used only by this live-smoke report. */
export function matchedRoleFamilies(
  job: JobPostDto,
): CanadianInternshipRoleFamily[] {
  const title = text(job.title);
  const structuredRole = [job.jobFunction, job.department, job.team]
    .map(text)
    .join(' ');
  const roleEvidence = `${title} ${structuredRole}`;
  const technicalEvidence = `${roleEvidence} ${text(job.description)}`;

  if (NON_JOB_PROGRAM_TITLE.test(title)) return [];
  if (
    NON_TECHNICAL_PLACEMENT_TITLE.test(title) &&
    !TECHNOLOGY_RISK_IT_AUDIT_PATTERN.test(roleEvidence)
  ) {
    return [];
  }

  const matched: CanadianInternshipRoleFamily[] = [];
  for (const [family, pattern] of ROLE_FAMILY_PATTERNS) {
    if (!pattern.test(roleEvidence)) continue;
    if (
      family === 'technical-product' &&
      GENERIC_PRODUCT_ROLE.test(roleEvidence) &&
      !EXPLICIT_TECHNICAL_PRODUCT.test(roleEvidence) &&
      !TECHNICAL_CONTEXT.test(technicalEvidence)
    ) {
      continue;
    }
    if (
      family === 'systems-business-analysis' &&
      GENERIC_BUSINESS_ANALYST.test(roleEvidence) &&
      !EXPLICIT_TECHNICAL_ANALYST.test(roleEvidence) &&
      !TECHNICAL_CONTEXT.test(technicalEvidence)
    ) {
      continue;
    }
    matched.push(family);
  }
  return matched;
}

export function isTechnologyAdjacentRole(job: JobPostDto): boolean {
  return matchedRoleFamilies(job).length > 0;
}

export function directUrlFor(job: JobPostDto): string | null {
  const candidate = job.applyUrl ?? job.jobUrlDirect ?? job.jobUrl;
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

export function isAllowedDirectUrl(
  candidate: string | null,
  allowedHosts: readonly string[],
): boolean {
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    return allowedHosts.some((allowed) => {
      const normalized = allowed.toLowerCase();
      if (normalized.includes('*')) {
        const wildcard = normalized
          .split('*')
          .map(escapeRegExp)
          .join('[a-z0-9-]*');
        return new RegExp(`^${wildcard}$`, 'i').test(hostname);
      }
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

export function summarizeSmokeResponse(
  target: CanadianEmployerSmokeTarget,
  response: JobResponseDto,
  durationMs: number,
): CanadianEmployerSmokeReport {
  const jobs = response.jobs ?? [];
  const gtaCount = jobs.filter(isGtaJob).length;
  const summer2027Count = jobs.filter(isSummer2027Job).length;
  const roleMatchCount = jobs.filter(isTechnologyAdjacentRole).length;
  const gtaSummer2027Count = jobs.filter(
    (job) => isGtaJob(job) && isSummer2027Job(job),
  ).length;
  const gtaSummer2027RoleMatchCount = jobs.filter(
    (job) =>
      isGtaJob(job) &&
      isSummer2027Job(job) &&
      isTechnologyAdjacentRole(job),
  ).length;
  const directUrls = jobs.map(directUrlFor);
  const directUrlCount = directUrls.filter((url) => url !== null).length;
  const invalidDirectUrlCount = directUrls.filter(
    (url) => !isAllowedDirectUrl(url, target.allowedDirectHosts),
  ).length;
  const officialResultCount = advertisedCount(response);
  const isUnverifiedEmpty = jobs.length === 0 && officialResultCount === null;

  return {
    id: target.id,
    employer: target.employer,
    adapter: target.adapter,
    status:
      isUnverifiedEmpty
        ? 'fail'
        : jobs.length === 0
        ? 'empty'
        : invalidDirectUrlCount === 0
          ? 'pass'
          : 'fail',
    officialResultCount,
    parsedCount: jobs.length,
    gtaCount,
    summer2027Count,
    roleMatchCount,
    gtaSummer2027Count,
    gtaSummer2027RoleMatchCount,
    directUrlCount,
    invalidDirectUrlCount,
    durationMs,
    error: isUnverifiedEmpty
      ? 'Source returned no jobs without an authoritative zero result count'
      : undefined,
  };
}

export function failedSmokeReport(
  target: CanadianEmployerSmokeTarget,
  error: unknown,
  durationMs: number,
): CanadianEmployerSmokeReport {
  return {
    id: target.id,
    employer: target.employer,
    adapter: target.adapter,
    status: 'fail',
    officialResultCount: null,
    parsedCount: 0,
    gtaCount: 0,
    summer2027Count: 0,
    roleMatchCount: 0,
    gtaSummer2027Count: 0,
    gtaSummer2027RoleMatchCount: 0,
    directUrlCount: 0,
    invalidDirectUrlCount: 0,
    durationMs,
    error: error instanceof Error ? error.message : String(error),
  };
}

export type SmokeScrape = (
  target: CanadianEmployerSmokeTarget,
) => Promise<JobResponseDto>;

export async function runCanadianEmployerSmoke(
  targets: readonly CanadianEmployerSmokeTarget[],
  scrape: SmokeScrape,
): Promise<CanadianEmployerSmokeReport[]> {
  const reports: CanadianEmployerSmokeReport[] = [];
  for (const target of targets) {
    const startedAt = Date.now();
    try {
      const response = await scrape(target);
      reports.push(summarizeSmokeResponse(target, response, Date.now() - startedAt));
    } catch (error) {
      reports.push(failedSmokeReport(target, error, Date.now() - startedAt));
    }
  }
  return reports;
}

function advertisedCount(response: JobResponseDto): number | null {
  const metadata = response as JobResponseDto & {
    advertisedCount?: unknown;
    totalResults?: unknown;
    total?: unknown;
  };
  for (const value of [
    metadata.advertisedCount,
    metadata.totalResults,
    metadata.total,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function createScraper(adapter: CanadianEmployerAdapter): IScraper {
  // Runtime requires keep deterministic unit tests network-free and let this
  // operator-only script load only the five adapters it actually needs.
  switch (adapter) {
    case 'workday': {
      const { WorkdayService } = require('@ever-jobs/source-ats-workday') as {
        WorkdayService: new () => IScraper;
      };
      return new WorkdayService();
    }
    case 'icims': {
      const { IcimsService } = require('@ever-jobs/source-ats-icims') as {
        IcimsService: new () => IScraper;
      };
      return new IcimsService();
    }
    case 'successfactors': {
      const { SuccessFactorsService } = require(
        '@ever-jobs/source-ats-successfactors'
      ) as { SuccessFactorsService: new () => IScraper };
      return new SuccessFactorsService();
    }
    case 'yello': {
      const { YelloService } = require('@ever-jobs/source-ats-yello') as {
        YelloService: new () => IScraper;
      };
      return new YelloService();
    }
    case 'accenture': {
      const { AccentureService } = require(
        '@ever-jobs/source-company-accenture'
      ) as { AccentureService: new () => IScraper };
      return new AccentureService();
    }
  }
}

async function liveScrape(
  target: CanadianEmployerSmokeTarget,
): Promise<JobResponseDto> {
  const scraper = createScraper(target.adapter);
  try {
    return await scraper.scrape(
      new ScraperInputDto({
        companySlug: target.companySlug,
        companyUrl: target.companyUrl,
        searchTerm: target.searchTerm,
        location: 'Greater Toronto Area',
        country: Country.CANADA,
        resultsWanted: 25,
        requestTimeout: 12,
        retries: 1,
      }),
    );
  } finally {
    const disposable = scraper as IScraper & {
      onModuleDestroy?: () => void | Promise<void>;
    };
    await disposable.onModuleDestroy?.();
  }
}

function selectedTargets(argv: readonly string[]): CanadianEmployerSmokeTarget[] {
  const companyIndex = argv.indexOf('--company');
  if (companyIndex < 0) return [...CANADIAN_EMPLOYER_SMOKE_TARGETS];
  const requested = argv[companyIndex + 1]?.trim().toLowerCase();
  if (!requested) throw new Error('--company requires an employer name or target id');
  const selected = CANADIAN_EMPLOYER_SMOKE_TARGETS.filter(
    ({ id, employer }) =>
      id.toLowerCase() === requested || employer.toLowerCase() === requested,
  );
  if (selected.length === 0) {
    throw new Error(`Unknown Canadian employer smoke target: ${requested}`);
  }
  return selected;
}

function printTable(reports: readonly CanadianEmployerSmokeReport[]): void {
  // eslint-disable-next-line no-console
  console.table(
    reports.map((report) => ({
      employer: report.employer,
      target: report.id,
      source: report.adapter,
      status: report.status,
      official: report.officialResultCount ?? 'n/a',
      parsed: report.parsedCount,
      gta: report.gtaCount,
      summer2027: report.summer2027Count,
      roleMatch: report.roleMatchCount,
      gtaSummer2027: report.gtaSummer2027Count,
      gtaSummer2027Role: report.gtaSummer2027RoleMatchCount,
      direct: report.directUrlCount,
      invalidDirect: report.invalidDirectUrlCount,
      ms: report.durationMs,
      error: report.error ?? '',
    })),
  );
}

async function main(): Promise<void> {
  const targets = selectedTargets(process.argv.slice(2));
  const reports = await runCanadianEmployerSmoke(targets, liveScrape);
  if (process.argv.includes('--json')) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(reports, null, 2));
  } else {
    printTable(reports);
  }
  if (reports.some(({ status }) => status === 'fail')) process.exitCode = 1;
}

const GTA_PATTERN =
  /\b(?:toronto|north york|scarborough|etobicoke|york|east york|mississauga|brampton|caledon|vaughan|richmond hill|markham|aurora|newmarket|whitchurch[- ]stouffville|king(?: city)?|georgina|pickering|ajax|whitby|oshawa|clarington|uxbridge|brock|oakville|burlington|milton|halton hills|greater toronto area|gta)\b/i;
const SUMMER_2027_PATTERN =
  /\b(?:summer(?:\s+of)?\s+(?:20)?27|(?:20)?27\s+summer)\b/i;
const MAY_AUGUST_2027_PATTERN =
  /\bmay\s+(?:20)?27\b[\s\S]{0,80}\baug(?:ust)?\s+(?:20)?27\b/i;
const NON_JOB_PROGRAM_TITLE =
  /\b(?:office tour|information session|recruit(?:ing|ment) event|career fair|talent community|talent network|join our community|campus ambassador|student ambassador)\b/i;
const NON_TECHNICAL_PLACEMENT_TITLE =
  /\b(?:general audit|external audit|financial audit|assurance|tax|accounting|finance|marketing|store|retail|pharmacy|manufacturing|merchandising)\s+(?:intern(?:ship)?|co[- ]?op|student|placement|analyst)\b/i;
const TECHNICAL_CONTEXT =
  /\b(?:software|digital|technology|technical|information technology|it|systems?|platform|application|data|analytics|artificial intelligence|ai|machine learning|cloud|cyber|security|automation|engineering|developer)\b/i;
const GENERIC_PRODUCT_ROLE =
  /\bproduct (?:manager|management|owner|analyst|operations|intern(?:ship)?|co[- ]?op)\b/i;
const EXPLICIT_TECHNICAL_PRODUCT =
  /\b(?:technical|digital|technology) product\b/i;
const GENERIC_BUSINESS_ANALYST = /\bbusiness analyst\b/i;
const EXPLICIT_TECHNICAL_ANALYST =
  /\b(?:business systems?|technology|technical|it|digital) analyst\b/i;
const TECHNOLOGY_RISK_IT_AUDIT_PATTERN =
  /\b(?:technology risk|technological risk|it (?:risk|audit)|information technology (?:risk|audit)|digital risk|cyber risk|systems? audit)\b/i;
const ROLE_FAMILY_PATTERNS: ReadonlyArray<
  readonly [CanadianInternshipRoleFamily, RegExp]
> = [
  [
    'software-engineering',
    /\b(?:software (?:engineer(?:ing)?|developer|development|intern(?:ship)?|co[- ]?op)|back[- ]?end (?:engineer(?:ing)?|developer|development)|front[- ]?end (?:engineer(?:ing)?|developer|development)|full[- ]?stack (?:engineer(?:ing)?|developer|development)|mobile (?:software )?(?:engineer(?:ing)?|developer|development)|(?:ios|android) (?:software )?(?:engineer(?:ing)?|developer|development)|developer (?:experience|productivity)|dx (?:engineer(?:ing)?|developer))\b/i,
  ],
  [
    'data-ai',
    /\b(?:data (?:engineer(?:ing)?|scientist|science|analyst|analytics|intern(?:ship)?|co[- ]?op)|machine learning (?:engineer(?:ing)?|scientist|developer|intern(?:ship)?)|ml (?:engineer(?:ing)?|scientist|developer|intern(?:ship)?)|artificial intelligence (?:engineer(?:ing)?|scientist|developer|analyst|intern(?:ship)?)|ai (?:engineer(?:ing)?|scientist|developer|analyst|intern(?:ship)?))\b/i,
  ],
  [
    'cybersecurity',
    /\b(?:cyber(?:security| security)?|information security|application security|appsec|security (?:engineer(?:ing)?|developer|analyst|specialist|operations)|soc analyst)\b/i,
  ],
  [
    'cloud-platform-infrastructure',
    /\b(?:cloud|platform|infrastructure|devops|site reliability|sre)(?:\s+(?:engineer(?:ing)?|developer|analyst|specialist|operations))?\b/i,
  ],
  [
    'qa-automation',
    /\b(?:quality assurance|qa|software (?:quality|test)|test (?:engineer(?:ing)?|developer|automation)|automation (?:engineer(?:ing)?|developer|analyst))\b/i,
  ],
  [
    'technical-product',
    /\b(?:technical product|digital product|technology product|product (?:manager|management|owner|analyst|operations|intern(?:ship)?|co[- ]?op))\b/i,
  ],
  [
    'ux-product-design',
    /\b(?:user experience|ux|ui|product design(?:er)?|interaction design(?:er)?|design systems?)\b/i,
  ],
  [
    'systems-business-analysis',
    /\b(?:systems? analyst|technology analyst|technical analyst|it analyst|information technology analyst|business systems? analyst|business analyst|digital transformation)\b/i,
  ],
  ['technology-risk-it-audit', TECHNOLOGY_RISK_IT_AUDIT_PATTERN],
];

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  void main();
}
