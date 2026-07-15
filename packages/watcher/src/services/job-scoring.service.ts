import { Injectable } from "@nestjs/common";
import { JobPostDto } from "@ever-jobs/models";
import { JobWatch, ScoreBreakdown } from "../interfaces/watch.types";

const TARGET_ROLE_TITLE =
  /\b(?:software (?:engineer|developer|engineering|development)|backend (?:engineer|developer)|platform engineer|infrastructure engineer|cloud engineer|security engineer|application security|devops|site reliability|sre|full[- ]?stack (?:engineer|developer)|machine learning engineer|data engineer)\b/i;
const SOFTWARE_ROLE =
  /\bsoftware (?:engineering|engineer|development|developer)\b/i;
const SPECIALTY_ROLE =
  /\b(?:backend|platform|infrastructure|cloud|security|devops|site reliability|sre)\b/i;
const INTERNSHIP_INDICATOR =
  /\b(?:internship|intern|co-?op|coop|student|university|campus|early career)\b/i;
const CANADIAN_LOCATION =
  /\b(?:canada|canadian|toronto|ontario|greater toronto|gta)\b|(?:^|,\s*)ON(?:\s*,|$)/i;
const DIRECT_OR_ATS_SOURCE =
  /^(?:google_careers|amazon|meta|microsoft|apple|nvidia|uber|stripe|openai|netflix|ibm|coinbase|doordash|plaid|figma|datadog|vercel|anthropic|databricks|greenhouse|lever|ashby|workday|smartrecruiters)$/i;

@Injectable()
export class JobScoringService {
  score(job: JobPostDto, watch: JobWatch): ScoreBreakdown {
    const title = asText(job.title).toLowerCase();
    const description = asText(job.description).toLowerCase();
    const company = asText(job.companyName).toLowerCase();
    const locationText = this.locationText(job).toLowerCase();
    const employmentEvidence = [
      title,
      asText(job.employmentType),
      Array.isArray(job.jobType) ? job.jobType.join(" ") : asText(job.jobType),
      asText(job.department),
    ].join(" ");
    const searchableText = `${title} ${description} ${company} ${locationText}`;
    const reasons: string[] = [];
    const matched = new Set<string>();
    const missingRequired: string[] = [];

    const hardExclusion = this.exclusionReason(
      title,
      description,
      locationText,
      watch.excludedTerms,
    );
    if (hardExclusion) {
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
        exclusionReason: hardExclusion,
        reasons: [],
      };
    }

    const hasTargetRoleTitle = TARGET_ROLE_TITLE.test(title);
    if (!hasTargetRoleTitle) missingRequired.push("target role in title");

    const hasInternshipIndicator =
      INTERNSHIP_INDICATOR.test(employmentEvidence) ||
      watch.requiredTerms.some((term) =>
        containsTerm(employmentEvidence, term),
      );
    if (!hasInternshipIndicator) {
      missingRequired.push("internship or co-op indicator");
    }

    const requiresCanada = watch.countryCodes.some((code) =>
      ["CA", "CAN"].includes(code.trim().toUpperCase()),
    );
    const hasCanadianLocation = CANADIAN_LOCATION.test(locationText);
    if (requiresCanada && !hasCanadianLocation) {
      missingRequired.push("Canadian location");
    }

    let role = 0;
    if (
      hasTargetRoleTitle &&
      INTERNSHIP_INDICATOR.test(title) &&
      /\b(?:software|backend|platform|infrastructure|cloud|security|devops|sre|full[- ]?stack|machine learning|data)\b/i.test(
        title,
      )
    ) {
      role += weight(watch, "exactInternshipTitle", 30);
      reasons.push("Exact target internship title");
      matched.add("software internship");
    }
    if (SOFTWARE_ROLE.test(searchableText)) {
      role += weight(watch, "softwareEngineering", 20);
      matched.add("software engineering");
    }
    if (SPECIALTY_ROLE.test(searchableText)) {
      role += weight(watch, "engineeringSpecialty", 15);
      matched.add("target engineering specialty");
    }
    if (/\bfull[- ]?stack\b/i.test(searchableText)) {
      role += weight(watch, "fullStack", 10);
      matched.add("full-stack");
    }
    if (
      /\b(?:machine learning|data engineer(?:ing)?)\b/i.test(searchableText)
    ) {
      role += weight(watch, "machineLearningData", 8);
      matched.add("machine learning or data engineering");
    }

    let internship = 0;
    if (hasInternshipIndicator) {
      internship += weight(watch, "internshipIndicator", 25);
      matched.add("internship indicator");
      reasons.push("Internship/co-op evidence");
    }

    let location = 0;
    if (/\btoronto\b/i.test(locationText)) {
      location += weight(watch, "toronto", 25);
      matched.add("Toronto");
    } else if (/\b(?:gta|greater toronto)\b/i.test(locationText)) {
      location += weight(watch, "greaterTorontoArea", 25);
      matched.add("Greater Toronto Area");
    } else if (/\bontario\b|(?:^|,\s*)ON(?:\s*,|$)/i.test(locationText)) {
      location += weight(watch, "ontario", 18);
      matched.add("Ontario");
    } else if (/remote.*canada|canada.*remote/i.test(locationText)) {
      location += weight(watch, "remoteCanada", 20);
      matched.add("Remote Canada");
    } else if (/\bcanada\b/i.test(locationText)) {
      location += weight(watch, "canada", 12);
      matched.add("Canada");
    }
    if (
      /hybrid.*toronto|toronto.*hybrid|on-site.*toronto|toronto.*on-site/i.test(
        locationText,
      )
    ) {
      location += weight(watch, "torontoWorkplaceBonus", 5);
    }

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
        company.includes(configured.toLowerCase()),
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

    const total = role + internship + location + companyScore + source + skills;
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
      reasons,
    };
  }

  private locationText(job: JobPostDto): string {
    if (typeof job.location === "string") {
      return [job.location, asText(job.workFromHomeType)]
        .filter(Boolean)
        .join(" ");
    }
    return [
      job.location?.city,
      job.location?.state,
      job.location?.country,
      job.workFromHomeType,
    ]
      .map(asText)
      .filter(Boolean)
      .join(" ");
  }

  private exclusionReason(
    title: string,
    description: string,
    location: string,
    terms: string[],
  ): string | undefined {
    if (
      /\b(?:senior|staff|principal|manager|director|architect)\b/i.test(title)
    ) {
      return "Excluded seniority in title";
    }
    if (
      /\blead\s+(?:software|backend|platform|infrastructure|cloud|security|devops|site reliability|engineering)\b|\b(?:software|backend|platform|infrastructure|cloud|security|devops|site reliability|engineering)\s+lead\b/i.test(
        title,
      )
    ) {
      return "Excluded lead role in title";
    }
    if (/\b(?:5\+|7\+|10\+) years\b/i.test(`${title} ${description}`)) {
      return "Excluded experience requirement";
    }
    if (
      /united states only|us only|usa only|must reside in the united states|no canadian applicants/i.test(
        `${location} ${description}`,
      )
    ) {
      return "Excluded location restriction";
    }
    for (const term of terms) {
      // "lead" is only a seniority exclusion in role-title context. It must
      // not exclude descriptions that say an intern will lead a small task.
      if (term.trim().toLowerCase() === "lead") continue;
      if (term && containsTerm(`${title} ${location}`, term)) {
        return `Excluded term: ${term}`;
      }
    }
    return undefined;
  }
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
