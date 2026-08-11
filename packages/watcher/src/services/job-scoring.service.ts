import { Injectable } from "@nestjs/common";
import type { JobPostDto } from "@ever-jobs/models";
import type { JobWatch, ScoreBreakdown } from "../interfaces/watch.types";
import { GeographyClassificationService } from "./geography-classification.service";
import type { WatchSourceJob } from "./jobs-service-watch.executor";

const EXPLICIT_ROLE_TITLE =
  /\b(?:software (?:engineer(?:ing)?|developer|development)|back[- ]?end (?:engineer(?:ing)?|developer|development)|front[- ]?end (?:engineer(?:ing)?|developer|development)|full[- ]?stack (?:engineer(?:ing)?|developer|development)|mobile (?:software )?(?:engineer(?:ing)?|developer|development)|(?:ios|android) (?:software )?(?:engineer(?:ing)?|developer|development)|developer (?:experience|productivity)|dx (?:engineer(?:ing)?|developer)|platform (?:engineer(?:ing)?|developer)|cloud (?:engineer(?:ing)?|developer)|infrastructure (?:engineer(?:ing)?|developer)|site reliability (?:engineer(?:ing)?|developer)|sre|devops(?: engineer(?:ing)?)?|(?:application |app )?security (?:engineer(?:ing)?|developer)|cybersecurity(?: engineer(?:ing)?)?|data engineer(?:ing)?|machine learning (?:engineer(?:ing)?|developer)|ml (?:engineer(?:ing)?|developer)|artificial intelligence (?:engineer(?:ing)?|developer)|ai (?:engineer(?:ing)?|developer))\b/i;
const INTERNSHIP_SHORTHAND_ROLE =
  /\b(?:software|back[- ]?end|front[- ]?end|full[- ]?stack|mobile|ios|android|developer experience|dx|platform|cloud|infrastructure|site reliability|sre|devops|application security|appsec|cybersecurity|security|data engineer(?:ing)?|machine learning|ml|artificial intelligence|ai)\b/i;
const SOFTWARE_ROLE =
  /\bsoftware (?:engineering|engineer|development|developer)\b/i;
const SPECIALTY_ROLE =
  /\b(?:back[- ]?end|front[- ]?end|mobile|ios|android|developer experience|dx|platform|infrastructure|cloud|security|cybersecurity|devops|site reliability|sre)\b/i;
const INTERNSHIP_INDICATOR =
  /\b(?:intern(?:ship)?s?|co(?:[-\u2010-\u2015 ]?op)s?)\b/i;
const SUMMER_2027_INDICATOR =
  /\b(?:summer(?:\s+of)?\s+(?:2027|['\u2019]?\s*27)|2027\s+summer)\b/i;
const PHD_DEGREE_PATTERN = "(?:ph\\.?\\s*d|doctoral|doctorate)";
const PHD_INTERNSHIP_TITLE = new RegExp(`\\b${PHD_DEGREE_PATTERN}\\b`, "i");
const PHD_INTERNSHIP_ELIGIBILITY = new RegExp(
  [
    `\\b${PHD_DEGREE_PATTERN}\\b(?:[-\\s]+level)?[-\\s,:/()]*(?:students?|candidates?|interns?|internships?|programs?|programmes?)\\b`,
    `\\b(?:currently\\s+)?(?:enrolled|pursuing|working\\s+towards?|studying\\s+towards?|candidate\\s+for)\\b.{0,80}\\b${PHD_DEGREE_PATTERN}\\b`,
    `\\b(?:students?|candidates?)\\b.{0,40}\\b${PHD_DEGREE_PATTERN}\\b`,
    `\\bapplicants?\\b.{0,40}\\b(?:must|should|required|eligible)\\b.{0,40}\\b${PHD_DEGREE_PATTERN}\\b`,
  ].join("|"),
  "i",
);
const DIRECT_OR_ATS_SOURCE =
  /^(?:google_careers|source-company-google|amazon|meta|microsoft|apple|nvidia|uber|stripe|openai|netflix|ibm|coinbase|doordash|plaid|figma|datadog|vercel|anthropic|databricks|greenhouse|lever|ashby|workday|smartrecruiters)$/i;

interface ResolvedScoringInput {
  job: JobPostDto;
  target: {
    key: string;
    tier: 1 | 2 | 3;
    countryCodes?: readonly string[];
    locations?: readonly string[];
    strictLocations?: boolean;
  };
}

/**
 * Scores only jobs that first satisfy the role, internship, and target-tier
 * eligibility gates. Ranking preferences remain independent from eligibility:
 * a Vancouver or eligible US job is not rejected merely for scoring zero
 * Toronto/Waterloo preference points.
 */
@Injectable()
export class JobScoringService {
  constructor(
    private readonly geographyClassifier: GeographyClassificationService = new GeographyClassificationService(),
  ) {}

  score(job: JobPostDto, watch: JobWatch): ScoreBreakdown;
  score(sourceJob: WatchSourceJob, watch: JobWatch): ScoreBreakdown;
  score(input: JobPostDto | WatchSourceJob, watch: JobWatch): ScoreBreakdown {
    const { job, target } = this.resolveInput(input, watch);
    const title = asText(job.title).toLowerCase();
    const description = asText(job.description).toLowerCase();
    const company = asText(job.companyName).toLowerCase();
    const locationText = this.locationText(job).toLowerCase();
    const structuredEmploymentEvidence = [
      asText(job.employmentType),
      Array.isArray(job.jobType) ? job.jobType.join(" ") : asText(job.jobType),
    ].join(" ");
    const searchableText = `${title} ${description} ${company} ${locationText}`;
    const reasons: string[] = [`Source target: ${target.key}`];
    const matched = new Set<string>();
    const missingRequired: string[] = [];
    const geography = this.geographyClassifier.classify(job, target);
    reasons.push(
      `Geography: ${geography.geographyDecision}; country=${geography.matchedCountry ?? "unresolved"}; confidence=${geography.locationConfidence}`,
    );

    const hardExclusion = this.exclusionReason(
      title,
      description,
      locationText,
      watch.excludedTerms,
    );
    if (hardExclusion) {
      return this.breakdown({
        targetKey: target.key,
        geography,
        reasons,
        exclusionReason: hardExclusion,
      });
    }

    const titleHasInternship = INTERNSHIP_INDICATOR.test(title);
    const hasTargetRoleTitle =
      EXPLICIT_ROLE_TITLE.test(title) ||
      (titleHasInternship && INTERNSHIP_SHORTHAND_ROLE.test(title));
    if (!hasTargetRoleTitle) missingRequired.push("target role in title");

    // Internship eligibility intentionally ignores descriptions, departments,
    // configured search terms, and generic student/campus language.
    const hasInternshipIndicator =
      titleHasInternship ||
      INTERNSHIP_INDICATOR.test(structuredEmploymentEvidence);
    if (!hasInternshipIndicator) {
      missingRequired.push("internship or co-op indicator");
    }
    const requiresSummer2027 = watch.requiredTerms.some(
      (term) => normalizeRequiredTerm(term) === "summer 2027",
    );
    const hasSummer2027 = SUMMER_2027_INDICATOR.test(`${title} ${description}`);
    if (requiresSummer2027 && !hasSummer2027) {
      missingRequired.push("Summer 2027 term");
    } else if (requiresSummer2027) {
      matched.add("Summer 2027");
      reasons.push("Summer 2027 evidence in title or description");
    }
    if (!geography.eligible && target.tier === 1) {
      // Retained for persisted watches and clients that predate the explicit
      // geographyDecision explanation fields.
      missingRequired.push("Canadian location");
    }

    let role = 0;
    if (hasTargetRoleTitle && titleHasInternship) {
      role += weight(watch, "exactInternshipTitle", 30);
      reasons.push("Exact target internship title");
      matched.add("software internship");
    }
    if (hasTargetRoleTitle && SOFTWARE_ROLE.test(title)) {
      role += weight(watch, "softwareEngineering", 20);
      matched.add("software engineering");
    }
    if (hasTargetRoleTitle && SPECIALTY_ROLE.test(title)) {
      role += weight(watch, "engineeringSpecialty", 15);
      matched.add("target engineering specialty");
    }
    if (hasTargetRoleTitle && /\bfull[- ]?stack\b/i.test(title)) {
      role += weight(watch, "fullStack", 10);
      matched.add("full-stack");
    }
    if (
      hasTargetRoleTitle &&
      /\b(?:machine learning|\bml\b|artificial intelligence|\bai\b|data engineer(?:ing)?)\b/i.test(
        title,
      )
    ) {
      role += weight(watch, "machineLearningData", 8);
      matched.add("machine learning, AI, or data engineering");
    }

    let internship = 0;
    if (hasInternshipIndicator) {
      internship += weight(watch, "internshipIndicator", 25);
      matched.add("internship indicator");
      reasons.push(
        "Internship/co-op evidence in title or structured employment data",
      );
    }

    const location = this.locationPreferenceScore(
      geography.preferences,
      watch,
      matched,
      reasons,
    );

    let companyScore = 0;
    if (/\b(?:google|amazon|meta)\b/i.test(company)) {
      companyScore += weight(watch, "topCompany", 25);
      matched.add("priority company");
    } else if (
      /\b(?:shopify|wealthsimple|microsoft|apple|nvidia|stripe|openai)\b/i.test(
        company,
      )
    ) {
      companyScore += weight(watch, "priorityCompany", 20);
      matched.add("priority company");
    } else if (
      watch.companies.some((configured) =>
        companyMatchesConfiguredName(company, configured),
      )
    ) {
      companyScore += weight(watch, "targetCompany", 10);
      matched.add("configured target company");
    }

    const source = DIRECT_OR_ATS_SOURCE.test(asText(job.site))
      ? weight(watch, "directSource", 10)
      : 0;
    if (source > 0) matched.add("direct or ATS source");

    const skillPatterns: Array<[RegExp, string, number, string]> = [
      [/\bpython\b/i, "skillPython", 8, "Python"],
      [/\bjava\b/i, "skillJava", 8, "Java"],
      [/\bgo(?:lang)?\b/i, "skillGo", 8, "Go"],
      [/\btypescript\b/i, "skillTypeScript", 6, "TypeScript"],
      [/\bc\+\+\b|\bc\b/i, "skillCpp", 5, "C/C++"],
      [/\bdocker\b/i, "skillDocker", 7, "Docker"],
      [/\bkubernetes\b/i, "skillKubernetes", 7, "Kubernetes"],
      [/\bterraform\b/i, "skillTerraform", 7, "Terraform"],
      [/\bgcp\b|google cloud|\bcloud\b/i, "skillCloud", 7, "Cloud"],
      [/\bkafka\b/i, "skillKafka", 8, "Kafka"],
      [/\bpostgresql\b|\bsql\b/i, "skillSql", 5, "SQL"],
      [
        /distributed systems/i,
        "skillDistributedSystems",
        10,
        "Distributed systems",
      ],
      [
        /\biam\b|auth0|authorization|\brbac\b|identity/i,
        "skillIdentity",
        10,
        "Identity",
      ],
      [/\bsecurity\b/i, "skillSecurity", 8, "Security"],
      [/\breact\b|next\.js/i, "skillReact", 4, "React/Next.js"],
    ];
    let skills = 0;
    for (const [pattern, key, points, label] of skillPatterns) {
      if (!pattern.test(searchableText)) continue;
      skills += weight(watch, key, points);
      matched.add(label);
    }
    skills = Math.min(skills, weight(watch, "skillsCap", 45));

    const uncappedTotal =
      role + internship + location + companyScore + source + skills;
    const tierOneCompanies = tierOneTargetCompanyNames(watch);
    const linkedInNonTierOneCompany =
      tierOneCompanies.length > 0 &&
      isLinkedInTarget(target.key, job.site) &&
      !tierOneCompanies.some((configured) =>
        companyMatchesConfiguredName(company, configured),
      );
    const linkedInCap = Math.max(0, watch.urgentScore - 1);
    const total = linkedInNonTierOneCompany
      ? Math.min(uncappedTotal, linkedInCap)
      : uncappedTotal;
    if (linkedInNonTierOneCompany && total < uncappedTotal) {
      reasons.push(
        `LinkedIn non-Tier-1 company score capped below urgent threshold (${linkedInCap})`,
      );
    }
    const gateExclusion = !hasTargetRoleTitle
      ? "not-software-engineering-role"
      : !hasInternshipIndicator
        ? "not-internship-or-co-op"
        : requiresSummer2027 && !hasSummer2027
          ? "not-summer-2027"
          : geography.suppressionReason;

    return {
      total,
      role,
      internship,
      location,
      company: companyScore,
      source,
      skills,
      matchedKeywords: [...matched],
      missingRequired,
      ...(gateExclusion ? { exclusionReason: gateExclusion } : {}),
      reasons,
      sourceTargetKey: target.key,
      ...(geography.matchedCountry
        ? { matchedCountry: geography.matchedCountry }
        : {}),
      locationConfidence: geography.locationConfidence,
      geographyDecision: geography.geographyDecision,
    };
  }

  private breakdown(input: {
    targetKey: string;
    geography: ReturnType<GeographyClassificationService["classify"]>;
    reasons: string[];
    exclusionReason: string;
  }): ScoreBreakdown {
    return {
      total: 0,
      role: 0,
      internship: 0,
      location: 0,
      company: 0,
      source: 0,
      skills: 0,
      matchedKeywords: [],
      missingRequired: [],
      exclusionReason: input.exclusionReason,
      reasons: input.reasons,
      sourceTargetKey: input.targetKey,
      ...(input.geography.matchedCountry
        ? { matchedCountry: input.geography.matchedCountry }
        : {}),
      locationConfidence: input.geography.locationConfidence,
      geographyDecision: input.geography.geographyDecision,
    };
  }

  private locationPreferenceScore(
    preferences: ReturnType<
      GeographyClassificationService["classify"]
    >["preferences"],
    watch: JobWatch,
    matched: Set<string>,
    reasons: string[],
  ): number {
    const candidates: Array<{ score: number; label: string }> = [];
    if (preferences.includes("greater-toronto-area")) {
      candidates.push({
        score: weight(watch, "greaterTorontoArea", 25),
        label: "Greater Toronto Area",
      });
    }
    if (preferences.includes("toronto")) {
      candidates.push({
        score: weight(watch, "toronto", 25),
        label: "Toronto",
      });
    }
    if (preferences.includes("waterloo")) {
      candidates.push({
        score: weight(watch, "waterloo", 20),
        label: "Waterloo",
      });
    }
    if (preferences.includes("remote-canada")) {
      candidates.push({
        score: weight(watch, "remoteCanada", 12),
        label: "Remote Canada",
      });
    }
    const preferred = candidates.sort(
      (left, right) => right.score - left.score,
    )[0];
    if (!preferred) return 0;
    matched.add(preferred.label);
    reasons.push(`Location preference: ${preferred.label}`);
    return preferred.score;
  }

  private resolveInput(
    input: JobPostDto | WatchSourceJob,
    watch: JobWatch,
  ): ResolvedScoringInput {
    if (isWatchSourceJob(input)) {
      return {
        job: input.job,
        target: {
          key: input.target.key,
          tier: input.target.tier,
          countryCodes:
            input.countryCodes.length > 0
              ? input.countryCodes
              : input.target.searchScope?.countryCodes,
          locations: input.target.searchScope?.locations,
          strictLocations: input.target.searchScope?.strictLocations,
        },
      };
    }

    const site = asText(input.site).trim();
    const normalizedSite = normalizeSource(site);
    const configuredTarget = watch.sourceTargets.find(
      (candidate) => normalizeSource(asText(candidate.site)) === normalizedSite,
    );
    const configuredTier = Object.entries(watch.sourceTiers).find(
      ([source]) => normalizeSource(source) === normalizedSite,
    )?.[1];
    const tier = normalizeTier(configuredTarget?.tier ?? configuredTier);
    const key = configuredTarget
      ? [asText(configuredTarget.site), configuredTarget.companySlug]
          .filter(Boolean)
          .join(":")
      : site || "legacy-watch-source";
    return {
      job: input,
      target: {
        key,
        tier,
        countryCodes: configuredTarget?.searchScope?.countryCodes,
        locations: configuredTarget?.searchScope?.locations,
        strictLocations: configuredTarget?.searchScope?.strictLocations,
      },
    };
  }

  private locationText(job: JobPostDto): string {
    const locations = Array.isArray(job.locations) ? job.locations : [];
    const parts: unknown[] = locations.flatMap((location) => [
      location?.city,
      location?.state,
      location?.country,
    ]);
    const legacyLocation = job.location as unknown;
    if (typeof legacyLocation === "string") {
      parts.push(legacyLocation);
    } else if (legacyLocation && typeof legacyLocation === "object") {
      const value = legacyLocation as {
        city?: unknown;
        state?: unknown;
        country?: unknown;
      };
      parts.push(value.city, value.state, value.country);
    }
    parts.push(job.workFromHomeType, job.isRemote ? "Remote" : "");
    return parts.map(asText).filter(Boolean).join(" ");
  }

  private exclusionReason(
    title: string,
    description: string,
    location: string,
    terms: string[],
  ): string | undefined {
    const phdExclusionConfigured = terms.some((term) =>
      PHD_INTERNSHIP_TITLE.test(term),
    );
    if (
      phdExclusionConfigured &&
      (PHD_INTERNSHIP_TITLE.test(title) ||
        PHD_INTERNSHIP_ELIGIBILITY.test(description))
    ) {
      return "Excluded PhD/doctoral internship";
    }
    if (
      /\b(?:senior|staff|principal|manager|director|architect)\b|\bsr\.?(?=\s|$)/i.test(
        title,
      )
    ) {
      return "Excluded seniority in title";
    }
    if (
      /\blead\s+(?:software|back[- ]?end|front[- ]?end|platform|infrastructure|cloud|security|devops|site reliability|engineering)\b|\b(?:software|back[- ]?end|front[- ]?end|platform|infrastructure|cloud|security|devops|site reliability|engineering)\s+lead\b/i.test(
        title,
      )
    ) {
      return "Excluded lead role in title";
    }
    if (
      /\b(?:new[- ]?grad(?:uate)?|early[- ]career|graduate (?:program|programme|role|position|software|engineering|developer))\b/i.test(
        title,
      )
    ) {
      return "Excluded new-graduate role in title";
    }
    if (/\b(?:experienced|mid[- ]?level)\b/i.test(title)) {
      return "Excluded experienced role in title";
    }
    const experienceText = `${title} ${description}`;
    if (
      /\b(?:3|[4-9]|\d{2,})\+\s*(?:years?|yrs?)\b|\b(?:at least|minimum(?: of)?)\s+(?:3|[4-9]|\d{2,})\s*(?:years?|yrs?)\b|\b(?:3|[4-9]|\d{2,})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional|industry|relevant|software|engineering|development|work)\s+experience\b/i.test(
        experienceText,
      )
    ) {
      return "Excluded experience requirement";
    }
    for (const term of terms) {
      // "lead" is only a seniority exclusion in role-title context. It must
      // not exclude descriptions that say an intern will lead a scoped task.
      if (term.trim().toLowerCase() === "lead") continue;
      if (term && containsTerm(`${title} ${location}`, term)) {
        return `Excluded term: ${term}`;
      }
    }
    return undefined;
  }
}

function isWatchSourceJob(
  input: JobPostDto | WatchSourceJob,
): input is WatchSourceJob {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<WatchSourceJob>;
  return Boolean(
    candidate.job &&
    candidate.target &&
    typeof candidate.target.key === "string" &&
    [1, 2, 3].includes(candidate.target.tier),
  );
}

function normalizeSource(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isLinkedInTarget(targetKey: string, site: unknown): boolean {
  return (
    normalizeSource(targetKey).startsWith("linkedin") ||
    normalizeSource(asText(site)) === "linkedin"
  );
}

function tierOneTargetCompanyNames(watch: JobWatch): string[] {
  return watch.sourceTargets
    .filter((target) => target.tier === 1 && target.companyName)
    .map((target) => asText(target.companyName));
}

function companyMatchesConfiguredName(
  company: string,
  configured: string,
): boolean {
  const candidate = normalizeCompanyName(company);
  const target = normalizeCompanyName(configured);
  if (!candidate || !target) return false;
  return candidate === target || candidate.startsWith(`${target} `);
}

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeRequiredTerm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTier(value: unknown): 1 | 2 | 3 {
  return value === 2 || value === 3 ? value : 1;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function containsTerm(text: string, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundaryStart = /^[a-z0-9]/i.test(term) ? "\\b" : "";
  const boundaryEnd = /[a-z0-9]$/i.test(term) ? "\\b" : "";
  return new RegExp(`${boundaryStart}${escaped}${boundaryEnd}`, "i").test(text);
}

function weight(watch: JobWatch, key: string, fallback: number): number {
  const configured = watch.weights?.[key];
  return typeof configured === "number" && Number.isFinite(configured)
    ? Math.max(0, configured)
    : fallback;
}
