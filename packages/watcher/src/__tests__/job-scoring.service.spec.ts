import { JobPostDto } from "@ever-jobs/models";
import type { JobWatch } from "../interfaces/watch.types";
import type { WatchSourceJob } from "../services/jobs-service-watch.executor";
import { defaultInternshipWatch } from "../services/default-watch";
import { JobScoringService } from "../services/job-scoring.service";
import { prestigeInternshipsV2Watch } from "../services/prestige-internships-v2.preset";

describe("JobScoringService internship eligibility", () => {
  const scorer = new JobScoringService();
  const watch = defaultInternshipWatch() as JobWatch;

  it.each([
    "Software Engineering Intern",
    "Software Engineering Interns",
    "Backend Developer Co-op",
    "Frontend Engineer Intern",
    "Full Stack Developer Internship",
    "Mobile Software Engineer Intern",
    "iOS Developer Intern",
    "Android Engineering Co-op",
    "Developer Experience Intern",
    "Platform Engineering Intern",
    "Cloud Engineer Intern",
    "Infrastructure Developer Co-op",
    "Site Reliability Engineer Intern",
    "DevOps Intern",
    "Application Security Intern",
    "Cybersecurity Engineer Internship",
    "Data Engineering Intern",
    "Machine Learning Intern",
    "AI Research Intern",
  ])("accepts the requested role family: %s", (title) => {
    const score = scorer.score(canadianJob({ title }), watch);

    expect(score.missingRequired).toEqual([]);
    expect(score.exclusionReason).toBeUndefined();
  });

  it("accepts structured internship employment data without title internship wording", () => {
    const score = scorer.score(
      canadianJob({
        title: "Software Engineer",
        employmentType: "internship",
      }),
      watch,
    );

    expect(score.missingRequired).toEqual([]);
    expect(score.exclusionReason).toBeUndefined();
  });

  it("does not infer internship eligibility from descriptions or campus language", () => {
    const score = scorer.score(
      canadianJob({
        title: "Software Engineer",
        employmentType: "full-time",
        department: "University and Campus Recruiting",
        description: "Mentor interns in our student program.",
      }),
      watch,
    );

    expect(score.missingRequired).toContain("internship or co-op indicator");
    expect(score.exclusionReason).toBe("not-internship-or-co-op");
  });

  it.each([
    ["New Grad Software Engineer", "Excluded new-graduate role in title"],
    ["Early Career Software Developer", "Excluded new-graduate role in title"],
    [
      "Experienced Software Engineer Intern",
      "Excluded experienced role in title",
    ],
  ])("hard-excludes experienced-family title %s", (title, reason) => {
    expect(scorer.score(canadianJob({ title }), watch).exclusionReason).toBe(
      reason,
    );
  });

  it("applies target-tier geography rather than a global Canada-only gate", () => {
    const job = new JobPostDto({
      site: "google",
      title: "Software Engineer Intern",
      companyName: "Google",
      employmentType: "internship",
      description: "Summer 2027 internship opportunity.",
      location: { city: "Austin", state: "TX", country: "US" } as any,
    });

    const tier1 = scorer.score(sourceJob(job, 1, "direct:google-us"), watch);
    const tier2 = scorer.score(sourceJob(job, 2, "google-jobs:us"), watch);
    const tier3 = scorer.score(sourceJob(job, 3, "linkedin:us"), watch);

    expect(tier1.geographyDecision).toBe("outside-target-scope");
    expect(tier1.exclusionReason).toBe("outside-target-scope");
    expect(tier2.exclusionReason).toBeUndefined();
    expect(tier2.geographyDecision).toBe("eligible-united-states");
    expect(tier3.exclusionReason).toBeUndefined();
    expect(tier3.geographyDecision).toBe("eligible-united-states");
  });

  it("suppresses unresolved geography with a deterministic explanation", () => {
    const score = scorer.score(
      sourceJob(
        new JobPostDto({
          site: "google",
          title: "Software Engineer Intern",
          companyName: "Google",
          employmentType: "internship",
          description: "Summer 2027 internship opportunity.",
          location: { city: "Springfield" } as any,
        }),
        2,
        "google-jobs:unknown",
      ),
      watch,
    );

    expect(score.exclusionReason).toBe("geography-unknown");
    expect(score.sourceTargetKey).toBe("google-jobs:unknown");
    expect(score.locationConfidence).toBe("low");
    expect(score.geographyDecision).toBe("geography-unknown");
  });

  it("keeps eligibility separate from Toronto/Waterloo preference points", () => {
    const toronto = scorer.score(
      canadianJob({
        title: "Software Engineer Intern",
        location: { city: "Toronto", state: "ON", country: "Canada" } as any,
      }),
      watch,
    );
    const vancouver = scorer.score(
      canadianJob({
        title: "Software Engineer Intern",
        location: { city: "Vancouver", state: "BC", country: "Canada" } as any,
      }),
      watch,
    );

    expect(vancouver.exclusionReason).toBeUndefined();
    expect(vancouver.location).toBe(0);
    expect(toronto.location).toBeGreaterThan(vancouver.location);
  });

  it("records target, country, confidence, and geography decision", () => {
    const score = scorer.score(
      sourceJob(
        new JobPostDto({
          site: "linkedin",
          title: "Backend Engineer Intern",
          companyName: "Example",
          employmentType: "internship",
          description: "Summer 2027 internship opportunity.",
          location: { city: "Seattle", state: "WA", country: "USA" } as any,
        }),
        3,
        "linkedin:internships-us",
      ),
      watch,
    );

    expect(score).toEqual(
      expect.objectContaining({
        sourceTargetKey: "linkedin:internships-us",
        matchedCountry: "US",
        locationConfidence: "high",
        geographyDecision: "eligible-united-states",
      }),
    );
    expect(score.reasons).toEqual(
      expect.arrayContaining([
        "Source target: linkedin:internships-us",
        expect.stringContaining("Geography: eligible-united-states"),
      ]),
    );
  });

  it.each([
    "Software Engineer Intern, Summer 2027",
    "Software Engineer Intern, Summer of 2027",
    "Software Engineer Intern — Summer '27",
    "Software Engineer Intern - Summer 27",
    "Software Engineer Intern - 2027 Summer",
  ])("accepts a supported Summer 2027 title spelling: %s", (title) => {
    const score = scorer.score(
      canadianJob({ title, description: "Software internship." }),
      watch,
    );

    expect(score.missingRequired).not.toContain("Summer 2027 term");
    expect(score.exclusionReason).toBeUndefined();
    expect(score.matchedKeywords).toContain("Summer 2027");
  });

  it("accepts Summer 2027 evidence in the description", () => {
    const score = scorer.score(
      canadianJob({
        title: "Software Engineer Intern",
        description: "This internship runs during Summer 2027.",
      }),
      watch,
    );

    expect(score.exclusionReason).toBeUndefined();
  });

  it("keeps legacy watches without the Summer 2027 requirement compatible", () => {
    const legacyWatch = {
      ...watch,
      requiredTerms: ["intern", "internship", "co-op", "coop"],
    };
    const score = scorer.score(
      canadianJob({
        title: "Software Engineer Intern",
        description: "Season to be announced.",
      }),
      legacyWatch,
    );

    expect(score.missingRequired).not.toContain("Summer 2027 term");
    expect(score.exclusionReason).toBeUndefined();
  });

  it.each(["Fall 2027", "Summer 2026", "term to be announced"])(
    "suppresses internships outside the Summer 2027 focus: %s",
    (term) => {
      const score = scorer.score(
        canadianJob({
          title: `Software Engineer Intern - ${term}`,
          description: "Software internship opportunity.",
        }),
        watch,
      );

      expect(score.missingRequired).toContain("Summer 2027 term");
      expect(score.exclusionReason).toBe("not-summer-2027");
    },
  );

  it.each([
    "Software Engineering Intern, PhD, Summer 2027",
    "Software Engineering Intern, Ph.D., Summer 2027",
    "Doctoral Software Engineering Intern, Summer 2027",
  ])("suppresses PhD/doctoral internship titles: %s", (title) => {
    const score = scorer.score(canadianJob({ title }), watch);

    expect(score.total).toBe(0);
    expect(score.exclusionReason).toBe("Excluded PhD/doctoral internship");
  });

  it("suppresses a generic title with explicit PhD enrollment eligibility", () => {
    const score = scorer.score(
      canadianJob({
        description:
          "Summer 2027 applicants must be currently enrolled in a Ph.D. program.",
      }),
      watch,
    );

    expect(score.exclusionReason).toBe("Excluded PhD/doctoral internship");
  });

  it("does not suppress an incidental mention of PhD colleagues", () => {
    const score = scorer.score(
      canadianJob({
        description:
          "PhD researchers and software engineers mentor this Summer 2027 internship program.",
      }),
      watch,
    );

    expect(score.exclusionReason).toBeUndefined();
  });

  it("caps a prestige-listed but non-Tier-1 LinkedIn company below urgent", () => {
    const score = scorer.score(
      sourceJob(
        new JobPostDto({
          site: "linkedin",
          title: "Full Stack Software Engineer Intern, Summer 2027",
          companyName: "RBC",
          employmentType: "internship",
          description:
            "Summer 2027. Python Java Go TypeScript Docker Kubernetes Terraform Kafka SQL distributed systems security React.",
          location: { city: "Toronto", state: "ON", country: "Canada" } as any,
        }),
        3,
        "linkedin",
      ),
      watch,
    );

    expect(score.total).toBe(watch.urgentScore - 1);
    expect(
      score.role + score.internship + score.location + score.skills,
    ).toBeGreaterThan(score.total);
    expect(score.reasons).toContain(
      `LinkedIn non-Tier-1 company score capped below urgent threshold (${watch.urgentScore - 1})`,
    );
  });

  it("does not cap a LinkedIn result for a configured Tier 1 company", () => {
    const score = scorer.score(
      sourceJob(
        new JobPostDto({
          site: "linkedin",
          title: "Software Engineer Intern, Summer 2027",
          companyName: "Google LLC",
          employmentType: "internship",
          description:
            "Summer 2027. Python Java Go Docker Kubernetes distributed systems.",
          location: { city: "Toronto", state: "ON", country: "Canada" } as any,
        }),
        3,
        "linkedin",
      ),
      watch,
    );

    expect(score.total).toBeGreaterThanOrEqual(watch.urgentScore);
    expect(score.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining("score capped")]),
    );
  });

  it.each(["Uber", "Notion", "Ramp", "Netflix", "IBM"])(
    "derives LinkedIn urgent eligibility for the new Tier 1 target %s",
    (companyName) => {
      const prestigeWatch = prestigeInternshipsV2Watch() as JobWatch;
      const score = scorer.score(
        sourceJob(
          new JobPostDto({
            site: "linkedin",
            title: "Software Engineer Intern, Summer 2027",
            companyName,
            employmentType: "internship",
            description:
              "Summer 2027. Python Java Go Docker Kubernetes distributed systems.",
            location: {
              city: "Toronto",
              state: "ON",
              country: "Canada",
            } as any,
          }),
          3,
          "linkedin",
        ),
        prestigeWatch,
      );

      expect(score.total).toBeGreaterThanOrEqual(prestigeWatch.urgentScore);
      expect(score.reasons).not.toEqual(
        expect.arrayContaining([expect.stringContaining("score capped")]),
      );
    },
  );

  it("does not apply the LinkedIn cap to direct/ATS observations", () => {
    const score = scorer.score(
      canadianJob({
        companyName: "Example Labs",
        description:
          "Summer 2027. Python Java Go Docker Kubernetes distributed systems.",
      }),
      watch,
    );

    expect(score.total).toBeGreaterThanOrEqual(watch.urgentScore);
  });
});

function canadianJob(
  overrides: Partial<ConstructorParameters<typeof JobPostDto>[0]> = {},
): JobPostDto {
  return new JobPostDto({
    site: "greenhouse",
    title: "Software Engineer Intern",
    companyName: "Example",
    employmentType: "internship",
    description: "Summer 2027 internship opportunity.",
    location: { city: "Toronto", state: "ON", country: "Canada" } as any,
    ...overrides,
  });
}

function sourceJob(
  job: JobPostDto,
  tier: 1 | 2 | 3,
  key: string,
): WatchSourceJob {
  return {
    job,
    target: {
      key,
      configuredSource: key,
      site: job.site,
      tier,
      kind: "aggregate",
      mode: "search",
      intervalMinutes: 60,
      searchScope: { countryCodes: [], locations: [] },
    } as unknown as WatchSourceJob["target"],
    requestId: `${key}:1`,
    countryCodes: [],
    matrixIndex: 0,
  };
}
