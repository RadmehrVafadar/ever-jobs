import { JobPostDto } from "@ever-jobs/models";
import type { JobWatch } from "../interfaces/watch.types";
import type { WatchSourceJob } from "../services/jobs-service-watch.executor";
import { defaultInternshipWatch } from "../services/default-watch";
import { JobScoringService } from "../services/job-scoring.service";

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
});

function canadianJob(
  overrides: Partial<ConstructorParameters<typeof JobPostDto>[0]> = {},
): JobPostDto {
  return new JobPostDto({
    site: "greenhouse",
    title: "Software Engineer Intern",
    companyName: "Example",
    employmentType: "internship",
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
