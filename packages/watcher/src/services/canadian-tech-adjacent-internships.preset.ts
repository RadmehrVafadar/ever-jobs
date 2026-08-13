import { normalizeCompany } from "@ever-jobs/common";
import { Site } from "@ever-jobs/models";
import {
  InternshipRoleFamily,
  JobWatch,
  WatchSourceTarget,
} from "../interfaces/watch.types";
import {
  canadianTechInternshipsWatch,
  canadianTechInternshipSourceTargets,
  CANADIAN_TECH_INTERNSHIP_COMPANIES,
  CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES,
  createCanadianInternshipSearchScope,
  createCanadianInternshipSourceTarget,
  WatchPresetDefinition,
} from "./canadian-tech-internships.preset";

export const CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID =
  "canadian-tech-adjacent-internships";
export const CANADIAN_TECH_ADJACENT_INTERNSHIPS_VERSION = 1;
export const CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME =
  "Canadian Tech + Adjacent Internships";

export const CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES = [
  "software-engineering",
  "data-ai",
  "cybersecurity",
  "cloud-platform-infrastructure",
  "qa-automation",
  "technical-product",
  "ux-product-design",
  "systems-business-analysis",
  "technology-risk-it-audit",
] as const satisfies readonly InternshipRoleFamily[];

export const CANADIAN_TECH_ADJACENT_INTERNSHIP_BOARD_SEARCH_TERMS = [
  "Summer 2027",
  "May 2027",
  "intern",
  "co-op",
] as const;

export const CANADIAN_TECH_ADJACENT_INTERNSHIP_SEARCH_TERMS = [
  "summer 2027 software engineering intern",
  "summer 2027 data AI intern",
  "summer 2027 cybersecurity intern",
  "summer 2027 cloud platform intern",
  "summer 2027 QA automation intern",
  "summer 2027 technical product intern",
  "summer 2027 UX product design intern",
  "summer 2027 systems business analyst intern",
  "summer 2027 technology risk IT audit intern",
  "May 2027 technology co-op",
] as const;

export const CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS = [
  "Greater Toronto Area",
  "Toronto, Ontario",
  "North York, Ontario",
  "Scarborough, Ontario",
  "Etobicoke, Ontario",
  "York, Ontario",
  "East York, Ontario",
  "Mississauga, Ontario",
  "Brampton, Ontario",
  "Caledon, Ontario",
  "Vaughan, Ontario",
  "Markham, Ontario",
  "Richmond Hill, Ontario",
  "Aurora, Ontario",
  "Newmarket, Ontario",
  "Whitchurch-Stouffville, Ontario",
  "East Gwillimbury, Ontario",
  "Georgina, Ontario",
  "King, Ontario",
  "King City, Ontario",
  "Pickering, Ontario",
  "Ajax, Ontario",
  "Whitby, Ontario",
  "Oshawa, Ontario",
  "Clarington, Ontario",
  "Uxbridge, Ontario",
  "Scugog, Ontario",
  "Brock, Ontario",
  "Oakville, Ontario",
  "Burlington, Ontario",
  "Milton, Ontario",
  "Halton Hills, Ontario",
] as const;

const EXISTING_TECH_COMPANIES = CANADIAN_TECH_INTERNSHIP_COMPANIES.filter(
  (company) =>
    !CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES.includes(
      company as (typeof CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES)[number],
    ),
);

export const CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES = [
  ...EXISTING_TECH_COMPANIES,
  "RBC",
  "TD",
  "Scotiabank",
  "BMO",
  "CIBC",
  "KPMG",
  "PwC",
  "Deloitte Canada",
  "EY Canada",
  "Accenture Canada",
  "Aritzia",
  "Loblaw",
  "Canadian Tire",
  "Canada Goose",
  "Manulife",
  "Sun Life",
  "Intact",
  "Bell",
  "Rogers",
  "TELUS",
] as const;

const GENERIC_DISCOVERY_SITES = new Set<Site>([
  Site.CANADAJOBBANK,
  Site.GOOGLE,
  Site.LINKEDIN,
]);

interface EmployerTarget {
  site: Site;
  companyName: string;
  companySlug?: string;
  companyUrl?: string;
}

const EMPLOYER_TARGETS: readonly EmployerTarget[] = [
  {
    site: Site.WORKDAY,
    companyName: "RBC",
    companySlug: "rbc:3:RBCEARLYTALENT1",
    companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
  },
  {
    site: Site.WORKDAY,
    companyName: "TD",
    companySlug: "td:3:TD_Bank_Careers",
    companyUrl: "https://td.wd3.myworkdayjobs.com/TD_Bank_Careers",
  },
  {
    site: Site.WORKDAY,
    companyName: "BMO",
    companySlug: "bmo:3:Campus",
    companyUrl: "https://bmo.wd3.myworkdayjobs.com/Campus",
  },
  {
    site: Site.WORKDAY,
    companyName: "CIBC",
    companySlug: "cibc:3:campus",
    companyUrl: "https://cibc.wd3.myworkdayjobs.com/campus",
  },
  {
    site: Site.SUCCESSFACTORS,
    companyName: "Scotiabank",
    companySlug: "scotiabank",
    companyUrl:
      "https://jobs.scotiabank.com/go/Student-%26-New-Grad-Jobs/2298417/",
  },
  {
    site: Site.ICIMS,
    companyName: "KPMG",
    companySlug: "students-kpmgca",
    companyUrl: "https://careers.kpmg.ca/students/jobs",
  },
  {
    site: Site.WORKDAY,
    companyName: "PwC",
    companySlug: "pwc:3:Global_Campus_Careers",
    companyUrl: "https://pwc.wd3.myworkdayjobs.com/Global_Campus_Careers",
  },
  {
    site: Site.SUCCESSFACTORS,
    companyName: "Deloitte Canada",
    companySlug: "deloitte-ca",
    companyUrl: "https://careers.deloitte.ca/search/",
  },
  {
    site: Site.YELLO,
    companyName: "EY Canada",
    companySlug: "c1riT--B2O-KySgYWsZO1Q",
    companyUrl: "https://eyglobal.yello.co",
  },
  { site: Site.ACCENTURE, companyName: "Accenture Canada" },
  {
    site: Site.WORKDAY,
    companyName: "Aritzia",
    companySlug: "aritzia:3:Calling_New_Graduates",
    companyUrl: "https://aritzia.wd3.myworkdayjobs.com/Calling_New_Graduates",
  },
  {
    site: Site.WORKDAY,
    companyName: "Loblaw",
    companySlug: "myview:3:loblaw_careers",
    companyUrl: "https://myview.wd3.myworkdayjobs.com/loblaw_careers",
  },
  {
    site: Site.WORKDAY,
    companyName: "Loblaw",
    companySlug: "myview:3:pc_financial",
    companyUrl: "https://myview.wd3.myworkdayjobs.com/pc_financial",
  },
  {
    site: Site.WORKDAY,
    companyName: "Loblaw",
    companySlug: "myview:3:sdm_careers",
    companyUrl: "https://myview.wd3.myworkdayjobs.com/sdm_careers",
  },
  {
    site: Site.WORKDAY,
    companyName: "Canadian Tire",
    companySlug: "canadiantirecorporation:3:Enterprise_External_Careers_Site",
    companyUrl:
      "https://canadiantirecorporation.wd3.myworkdayjobs.com/Enterprise_External_Careers_Site",
  },
  {
    site: Site.WORKDAY,
    companyName: "Canada Goose",
    companySlug: "canadagoose:3:CanadaGooseCareers",
    companyUrl: "https://canadagoose.wd3.myworkdayjobs.com/CanadaGooseCareers",
  },
  {
    site: Site.WORKDAY,
    companyName: "Manulife",
    companySlug: "manulife:3:MFCJH_Jobs",
    companyUrl: "https://manulife.wd3.myworkdayjobs.com/MFCJH_Jobs",
  },
  {
    site: Site.WORKDAY,
    companyName: "Sun Life",
    companySlug: "sunlife:3:Campus",
    companyUrl: "https://sunlife.wd3.myworkdayjobs.com/Campus",
  },
  {
    site: Site.WORKDAY,
    companyName: "Intact",
    companySlug: "intactfc:3:intactfc",
    companyUrl: "https://intactfc.wd3.myworkdayjobs.com/intactfc",
  },
  {
    site: Site.SUCCESSFACTORS,
    companyName: "Bell",
    companySlug: "bell-ca",
    companyUrl: "https://jobs.bell.ca/ca/en/search-results",
  },
  {
    site: Site.SUCCESSFACTORS,
    companyName: "Rogers",
    companySlug: "rogers-ca",
    companyUrl: "https://jobs.rogers.com/search/",
  },
  {
    site: Site.SUCCESSFACTORS,
    companyName: "TELUS",
    companySlug: "telus-ca",
    companyUrl: "https://careers.telus.com/search/",
  },
];

function expandedExistingTargets(): WatchSourceTarget[] {
  return canadianTechInternshipSourceTargets().map((target) => ({
    ...target,
    searchScope: target.searchScope
      ? createCanadianInternshipSearchScope(
          target.searchScope.countryCodes,
          CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS,
          {
            ...(target.searchScope.searchTerms
              ? { searchTerms: CANADIAN_TECH_ADJACENT_INTERNSHIP_SEARCH_TERMS }
              : {}),
            ...(target.searchScope.maxRequestsPerRun === undefined
              ? {}
              : {
                  maxRequestsPerRun: target.searchScope.maxRequestsPerRun,
                }),
          },
        )
      : undefined,
  }));
}

function employerTargets(): WatchSourceTarget[] {
  return EMPLOYER_TARGETS.map((employer) =>
    createCanadianInternshipSourceTarget({
      ...employer,
      tier: 1,
      intervalMinutes: 10,
      // Enterprise boards can advertise hundreds or thousands of keyword
      // hits. Keep each rotating search inside the watcher source deadline
      // and avoid enriching a large irrelevant tail before the next term.
      resultsWanted: 25,
      mode: "board-search",
      enabled: true,
      searchScope: createCanadianInternshipSearchScope(
        ["CA"],
        CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS,
        {
          searchTerms: CANADIAN_TECH_ADJACENT_INTERNSHIP_BOARD_SEARCH_TERMS,
          maxRequestsPerRun: 2,
        },
      ),
    }),
  );
}

export function canadianTechAdjacentInternshipSourceTargets(): WatchSourceTarget[] {
  return [...expandedExistingTargets(), ...employerTargets()];
}

export function assertCanadianTechAdjacentInternshipCompanyCoverage(
  targets: readonly WatchSourceTarget[],
): void {
  const covered = new Set(
    targets
      .filter(
        (candidate) => !GENERIC_DISCOVERY_SITES.has(candidate.site as Site),
      )
      .filter((candidate) => candidate.enabled)
      .map((candidate) => candidate.companyName?.trim())
      .filter((name): name is string => Boolean(name))
      .map(normalizeCompany),
  );
  const uncovered = CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES.filter(
    (company) => !covered.has(normalizeCompany(company)),
  );
  if (uncovered.length > 0) {
    throw new Error(
      `Canadian Tech + Adjacent Internships companies require an enabled branded target: ${uncovered.join(", ")}`,
    );
  }
}

export function canadianTechAdjacentInternshipsWatch(): Partial<JobWatch> {
  const base = canadianTechInternshipsWatch();
  const targets = canadianTechAdjacentInternshipSourceTargets();
  assertCanadianTechAdjacentInternshipCompanyCoverage(targets);
  return {
    ...base,
    name: CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME,
    description:
      "Strict GTA monitoring for Summer 2027 technology and technology-adjacent internships and co-ops.",
    enabled: false,
    sources: [...new Set(targets.map(({ site }) => String(site)))],
    sourceTargets: targets,
    sourceTiers: Object.fromEntries(
      targets.map(({ site, tier }) => [String(site), tier]),
    ),
    companySlugs: targets.flatMap((target) =>
      target.companySlug
        ? [`${String(target.site)}:${target.companySlug}`]
        : [],
    ),
    companies: [...CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES],
    searchTerms: [...CANADIAN_TECH_ADJACENT_INTERNSHIP_SEARCH_TERMS],
    roleFamilies: [...CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES],
    locations: [...CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS],
    countryCodes: ["CA"],
    initializationMode: "baseline",
  };
}

export const CANADIAN_TECH_ADJACENT_INTERNSHIPS_PRESET =
  Object.freeze<WatchPresetDefinition>({
    id: CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
    version: CANADIAN_TECH_ADJACENT_INTERNSHIPS_VERSION,
    name: CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME,
    description:
      "Summer 2027 technology and technology-adjacent internships and co-ops in the Greater Toronto Area.",
    applyPolicy: {
      locations: "replace",
      countryCodes: "replace",
      roleFamilies: "replace",
    },
    createWatch: canadianTechAdjacentInternshipsWatch,
  });
