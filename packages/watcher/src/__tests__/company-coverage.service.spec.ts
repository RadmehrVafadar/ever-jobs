import { JobWatch } from "../interfaces/watch.types";
import {
  buildCompanyCoverageReport,
  CompanyCoverageService,
} from "../services/company-coverage.service";
import {
  PRESTIGE_DEFERRED_COMPANIES,
  prestigeInternshipsV2Watch,
} from "../services/prestige-internships-v2.preset";

describe("buildCompanyCoverageReport", () => {
  it("partitions configured companies using exact normalized branded targets", () => {
    const initializedAt = new Date("2026-07-20T10:00:00.000Z");
    const watch = watchFixture({
      companies: ["Acme, Inc.", "Beta", "Gamma", "Delta", "LinkedIn Co"],
      sourceTargets: [
        {
          site: "acme",
          companyName: "ACME Corporation",
          tier: 1,
          intervalMinutes: 10,
          enabled: true,
          initializedAt,
        },
        {
          site: "ashby",
          companySlug: "beta",
          companyName: " beta ",
          tier: 1,
          intervalMinutes: 10,
          enabled: false,
          initializedAt,
        },
        {
          site: "gamma",
          companyName: "Gamma",
          tier: 1,
          intervalMinutes: 10,
          enabled: true,
          initializedAt: null,
        },
        {
          site: "linkedin",
          companyName: "LinkedIn Co",
          tier: 2,
          intervalMinutes: 30,
          enabled: true,
          initializedAt,
        },
      ],
      targetHealth: {
        acme: targetHealth("acme", {
          consecutiveHardFailures: 2,
          lastAttemptAt: new Date("2026-07-20T12:00:00.000Z"),
          lastSuccessAt: new Date("2026-07-20T11:00:00.000Z"),
          lastNonEmptyAt: new Date("2026-07-20T10:30:00.000Z"),
        }),
        "ashby:beta": targetHealth("ashby:beta", {
          consecutiveHardFailures: 3,
          lastAttemptAt: new Date("2026-07-20T13:00:00.000Z"),
        }),
      },
    });

    const report = buildCompanyCoverageReport(watch);

    expect(report.summary).toEqual({
      configured: 5,
      active: 2,
      disabled: 1,
      uncovered: 2,
      initialized: 2,
      degraded: 1,
    });
    expect(report.companies.map(({ company, status }) => [company, status])).toEqual([
      ["Acme, Inc.", "active"],
      ["Beta", "disabled"],
      ["Gamma", "active"],
      ["Delta", "uncovered"],
      ["LinkedIn Co", "uncovered"],
    ]);
    expect(report.companies[0]).toMatchObject({
      targetKeys: ["acme"],
      initialized: true,
      consecutiveHardFailures: 2,
      degraded: false,
      lastAttemptAt: new Date("2026-07-20T12:00:00.000Z"),
      lastSuccessAt: new Date("2026-07-20T11:00:00.000Z"),
      lastNonEmptyAt: new Date("2026-07-20T10:30:00.000Z"),
    });
    expect(report.companies[1]).toMatchObject({
      targetKeys: ["ashby:beta"],
      initialized: true,
      consecutiveHardFailures: 3,
      degraded: true,
    });
    expect(report.companies[3]).toMatchObject({
      targetKeys: [],
      initialized: false,
      consecutiveHardFailures: 0,
      degraded: false,
      lastAttemptAt: null,
    });
  });

  it("aggregates multiple targets and requires every enabled target to be initialized", () => {
    const watch = watchFixture({
      companies: ["Acme"],
      initializedAt: new Date("2026-07-01T00:00:00.000Z"),
      sourceTargets: [
        {
          site: "greenhouse",
          companySlug: "acme",
          companyName: "Acme",
          tier: 1,
          intervalMinutes: 10,
          enabled: true,
        },
        {
          site: "acme",
          companyName: "Acme",
          tier: 1,
          intervalMinutes: 10,
          enabled: true,
          initializedAt: null,
        },
      ],
      targetHealth: {
        "greenhouse:acme": targetHealth("greenhouse:acme", {
          consecutiveHardFailures: 1,
          lastAttemptAt: new Date("2026-07-20T12:00:00.000Z"),
        }),
        acme: targetHealth("acme", {
          consecutiveHardFailures: 4,
          lastAttemptAt: new Date("2026-07-20T14:00:00.000Z"),
          lastSuccessAt: new Date("2026-07-20T13:00:00.000Z"),
        }),
      },
    });

    expect(buildCompanyCoverageReport(watch).companies[0]).toMatchObject({
      status: "active",
      targetKeys: ["greenhouse:acme", "acme"],
      initialized: false,
      consecutiveHardFailures: 4,
      degraded: true,
      lastAttemptAt: new Date("2026-07-20T14:00:00.000Z"),
      lastSuccessAt: new Date("2026-07-20T13:00:00.000Z"),
    });
  });

  it("does not infer company identity from an ATS slug without companyName", () => {
    const report = buildCompanyCoverageReport(
      watchFixture({
        companies: ["Legacy Co"],
        sourceTargets: [
          {
            site: "ashby",
            companySlug: "legacy-co",
            tier: 1,
            intervalMinutes: 10,
            enabled: true,
          },
        ],
      }),
    );

    expect(report.companies[0]).toMatchObject({
      company: "Legacy Co",
      status: "uncovered",
      targetKeys: [],
    });
  });

  it("publishes the same summary through the injectable service", () => {
    const metrics = { setCompanyCoverage: jest.fn() };
    const service = new CompanyCoverageService(metrics as never);
    const watch = watchFixture({ companies: ["Uncovered"] });

    const report = service.build(watch);

    expect(metrics.setCompanyCoverage).toHaveBeenCalledWith(
      watch.id,
      report.summary,
    );
  });

  it("keeps all five deferred banks visibly uncovered in prestige revision 3", () => {
    const report = buildCompanyCoverageReport(
      watchFixture(prestigeInternshipsV2Watch()),
    );

    expect(report.summary).toEqual({
      configured: 26,
      active: 21,
      disabled: 0,
      uncovered: 5,
      initialized: 0,
      degraded: 0,
    });
    expect(
      report.companies
        .filter(({ status }) => status === "uncovered")
        .map(({ company }) => company),
    ).toEqual(PRESTIGE_DEFERRED_COMPANIES);
  });
});

function watchFixture(patch: Partial<JobWatch> = {}): JobWatch {
  const now = new Date("2026-07-20T00:00:00.000Z");
  return {
    id: "watch-1",
    name: "Coverage watch",
    enabled: false,
    intervalMinutes: 10,
    timezone: "America/Toronto",
    sources: [],
    sourceTiers: {},
    sourceTargets: [],
    targetHealth: {},
    companySlugs: [],
    companies: [],
    searchTerms: [],
    requiredTerms: [],
    preferredTerms: [],
    excludedTerms: [],
    locations: [],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: [],
    allowedEmploymentTypes: [],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [],
    initializationMode: "baseline",
    initializedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function targetHealth(
  targetKey: string,
  patch: Partial<NonNullable<JobWatch["targetHealth"]>[string]> = {},
): NonNullable<JobWatch["targetHealth"]>[string] {
  return {
    targetKey,
    tier: 1,
    successCount: 0,
    hardFailureCount: 0,
    emptyRunCount: 0,
    partialRunCount: 0,
    consecutiveHardFailures: 0,
    ...patch,
  };
}
