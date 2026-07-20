import { JobPostDto } from "@ever-jobs/models";
import { JobFingerprintService } from "../services/job-fingerprint.service";
import { JobScoringService } from "../services/job-scoring.service";
import { defaultInternshipWatch } from "../services/default-watch";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { DailyDigestService } from "../services/daily-digest.service";

describe("watcher primitives", () => {
  const fp = new JobFingerprintService();
  it("canonicalizes tracking URLs and keeps fingerprint stable", () => {
    const a = new JobPostDto({
      site: "greenhouse",
      id: "123",
      title: "Software Developer Intern",
      companyName: "Google",
      jobUrl: "https://boards.greenhouse.io/x/jobs/123?utm_source=li",
    });
    const b = new JobPostDto({
      site: " GREENHOUSE ",
      id: "123",
      title: "Other",
      companyName: "Other",
      jobUrl: "https://boards.greenhouse.io/x/jobs/123",
    });
    expect(fp.fingerprint(a)).toBe(fp.fingerprint(b));
    expect(fp.canonicalizeUrl(a.jobUrl)).toBe(
      "https://boards.greenhouse.io/x/jobs/123",
    );
  });
  it("distinguishes distinct canonical jobs without external ids", () => {
    const a = new JobPostDto({
      site: "lever",
      title: "Backend Engineer Intern",
      companyName: "Stripe",
      jobUrl: "https://jobs.lever.co/stripe/a",
    });
    const b = new JobPostDto({
      site: "lever",
      title: "Backend Engineer Intern",
      companyName: "Stripe",
      jobUrl: "https://jobs.lever.co/stripe/b",
    });
    expect(fp.fingerprint(a)).not.toBe(fp.fingerprint(b));
  });
  it("hashes normalized descriptions", () => {
    expect(fp.descriptionHash("Hello   World")).toBe(
      fp.descriptionHash(" hello world "),
    );
  });
  it("normalizes schema-drifted primitive values without throwing", () => {
    expect(fp.normalizeText(12345)).toBe("12345");
    expect(
      fp.canonicalizeUrl({
        toString: () => "https://example.com/job/1?utm_source=x",
      }),
    ).toBe("https://example.com/job/1");
  });
  it("sorts meaningful URL parameters and removes case-insensitive tracking parameters", () => {
    expect(
      fp.canonicalizeUrl(
        "HTTPS://Example.COM:443/jobs/1/?b=2&UTM_Source=x&a=1#top",
      ),
    ).toBe("https://example.com/jobs/1/?a=1&b=2");
  });
  it("groups the same canonical job across sources while preserving source fingerprints", () => {
    const direct = new JobPostDto({
      site: "google_careers",
      title: "Software Intern",
      companyName: "Google",
      jobUrl: "https://careers.google.com/jobs/1?utm_source=direct",
      location: { city: "Toronto", state: "ON", country: "Canada" } as any,
    });
    const aggregate = new JobPostDto({
      site: "google",
      title: " software intern ",
      companyName: "GOOGLE",
      jobUrl: "https://www.google.com/search?q=software+intern",
      applyUrl: "https://careers.google.com/jobs/1?utm_source=aggregate",
      location: { city: "Toronto", state: "Ontario", country: "Canada" } as any,
    });
    expect(fp.fingerprint(direct)).not.toBe(fp.fingerprint(aggregate));
    expect(
      fp.canonicalFingerprint(direct, { employerOwnedListing: true }),
    ).toBe(fp.canonicalFingerprint(aggregate));

    const aggregateListingOnly = new JobPostDto({
      ...aggregate,
      applyUrl: null,
      atsType: "greenhouse",
    });
    const otherAggregateListing = new JobPostDto({
      ...aggregateListingOnly,
      jobUrl: "https://www.linkedin.com/jobs/view/999",
    });
    expect(fp.canonicalFingerprint(aggregateListingOnly)).toBe(
      fp.canonicalFingerprint(otherAggregateListing),
    );
    expect(fp.usesObservationEpisodeAnchor(aggregateListingOnly)).toBe(true);
  });
  it("canonicalizes Canadian provinces and US states across name/code variants", () => {
    const base = {
      site: "google",
      title: "Software Intern",
      companyName: "Example",
      jobUrl: "https://aggregator.example/jobs/1",
    };
    const vancouverName = new JobPostDto({
      ...base,
      locations: [
        {
          city: "Vancouver",
          state: "British Columbia",
          country: "Canada",
        } as any,
      ],
    });
    const vancouverCode = new JobPostDto({
      ...base,
      locations: [{ city: "Vancouver", state: "BC", country: "CA" } as any],
    });
    const newYorkName = new JobPostDto({
      ...base,
      locations: [
        {
          city: "New York",
          state: "New York",
          country: "United States",
        } as any,
      ],
    });
    const newYorkCode = new JobPostDto({
      ...base,
      locations: [{ city: "New York", state: "NY", country: "US" } as any],
    });

    expect(fp.canonicalFingerprint(vancouverName)).toBe(
      fp.canonicalFingerprint(vancouverCode),
    );
    expect(fp.canonicalFingerprint(newYorkName)).toBe(
      fp.canonicalFingerprint(newYorkCode),
    );
  });
  it("scores a Toronto software internship as urgent with explainable buckets", () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(
      new JobPostDto({
        site: "source-company-google",
        title: "Software Developer Intern",
        companyName: "Google",
        description:
          "Python distributed systems on Google Cloud Platform with Kubernetes and SQL",
        location: {
          city: "Toronto",
          state: "Ontario",
          country: "Canada",
        } as any,
        workFromHomeType: "Hybrid",
      }),
      watch,
    );
    expect(score.total).toBeGreaterThanOrEqual(80);
    expect(score.matchedKeywords).toContain("software internship");
    expect(score.location).toBeGreaterThan(0);
  });
  it("contextually excludes senior title matches", () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(
      new JobPostDto({
        title: "Senior Software Engineer",
        companyName: "Meta",
        description: "mentor interns",
        location: { city: "Toronto" } as any,
      }),
      watch,
    );
    expect(score.exclusionReason).toBe("Excluded seniority in title");
  });
  it("only treats lead as seniority when it appears in the role title", () => {
    const watch = defaultInternshipWatch() as any;
    const scorer = new JobScoringService();
    const intern = scorer.score(
      new JobPostDto({
        site: "ashby",
        title: "Software Engineer Intern",
        companyName: "Plaid",
        description:
          "Summer 2027. You will lead a scoped project with your mentor.",
        location: {
          city: "Toronto",
          state: "Ontario",
          country: "Canada",
        } as any,
        employmentType: "internship",
      }),
      watch,
    );
    const lead = scorer.score(
      new JobPostDto({
        site: "ashby",
        title: "Lead Software Engineer",
        companyName: "Plaid",
        location: {
          city: "Toronto",
          state: "Ontario",
          country: "Canada",
        } as any,
      }),
      watch,
    );
    expect(intern.exclusionReason).toBeUndefined();
    expect(lead.exclusionReason).toBe("Excluded lead role in title");
  });
  it("does not make a US full-time role alert-eligible from description mentions", () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(
      new JobPostDto({
        site: "amazon",
        title: "Embedded Software Engineer, Ring",
        companyName: "Amazon",
        description:
          "This engineer may mentor interns and work with university partners.",
        location: { city: "Cambridge", state: "MA", country: "US" } as any,
        employmentType: "full-time",
      }),
      watch,
    );
    expect(score.missingRequired).toEqual(
      expect.arrayContaining([
        "internship or co-op indicator",
        "Canadian location",
      ]),
    );
  });
  it("requires a target engineering title even for a Canadian internship", () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(
      new JobPostDto({
        site: "microsoft",
        title: "Critical Environment Operations Intern",
        companyName: "Microsoft",
        location: {
          city: "Toronto",
          state: "Ontario",
          country: "Canada",
        } as any,
        employmentType: "internship",
      }),
      watch,
    );
    expect(score.missingRequired).toContain("target role in title");
  });
  it("applies per-watch configurable scoring weights", () => {
    const watch = {
      ...defaultInternshipWatch(),
      weights: { internshipIndicator: 3, directSource: 2 },
    } as any;
    const score = new JobScoringService().score(
      new JobPostDto({
        site: "stripe",
        title: "Software Engineer Intern",
        companyName: "Stripe",
        description: "Summer 2027 internship opportunity.",
        location: {
          city: "Toronto",
          state: "Ontario",
          country: "Canada",
        } as any,
        employmentType: "internship",
      }),
      watch,
    );
    expect(score.internship).toBe(3);
    expect(score.source).toBe(2);
    expect(score.missingRequired).toEqual([]);
  });
  it("selects digest matches between digest and immediate thresholds", async () => {
    const repo = new InMemoryWatchRepository();
    const watch = await repo.createWatch(defaultInternshipWatch());
    const job = (
      await repo.upsertObservedJob({
        fingerprint: "f",
        source: "fake",
        title: "t",
        normalizedTitle: "t",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
    ).job;
    await repo.upsertMatch({
      watchId: watch.id,
      observedJobId: job.id,
      score: 50,
      scoreBreakdown: {
        total: 50,
        role: 0,
        internship: 0,
        location: 0,
        company: 0,
        source: 0,
        skills: 0,
        matchedKeywords: [],
        missingRequired: [],
        reasons: [],
      },
      matchedTerms: [],
      status: "new",
      firstMatchedAt: new Date(),
      lastMatchedAt: new Date(),
      notificationState: "pending",
    });
    await expect(
      new DailyDigestService(repo).selectDigestMatches(watch.id, 40, 60),
    ).resolves.toHaveLength(1);
  });
});
