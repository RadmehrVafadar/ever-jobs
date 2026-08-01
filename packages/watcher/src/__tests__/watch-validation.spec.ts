import { BadRequestException } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import { WatchValidationService } from "../services/watch-validation.service";

describe("WatchValidationService", () => {
  const service = new WatchValidationService();

  it("accepts a validated source target and secret-free Discord reference", () => {
    const result = service.parseCreate({
      name: "Canada internships",
      timezone: "America/Toronto",
      sourceTargets: [
        {
          site: Site.GOOGLE_CAREERS,
          tier: 1,
          intervalMinutes: 3,
          enabled: true,
        },
      ],
      searchTerms: ["software engineer intern"],
      digestScore: 40,
      minimumScore: 60,
      urgentScore: 80,
      notificationChannels: [{ type: "discord", destinationRef: "default" }],
    });

    expect((result as any).sourceTargets[0].site).toBe(Site.GOOGLE_CAREERS);
    expect(result.notificationChannels).toEqual([
      { type: "discord", destinationRef: "default" },
    ]);
  });

  it("validates nested target scope while keeping legacy target fields optional", () => {
    const result = service.parseCreate({
      name: "Scoped internships",
      sourceTargets: [
        {
          site: Site.ASHBY,
          tier: 1,
          intervalMinutes: 3,
          resultsWanted: 500,
          companySlug: "wealthsimple",
          companyName: "Wealthsimple",
          initializedAt: null,
          searchScope: {
            countryCodes: ["ca", "us"],
            locations: ["Canada", "United States"],
            searchTerms: ["software intern"],
            maxRequestsPerRun: 8,
          },
          enabled: true,
        },
        {
          site: Site.GOOGLE_CAREERS,
          tier: 1,
          intervalMinutes: 3,
          enabled: true,
        },
      ],
    });

    expect(result.sourceTargets).toEqual([
      expect.objectContaining({
        companyName: "Wealthsimple",
        resultsWanted: 500,
        initializedAt: null,
        searchScope: expect.objectContaining({
          countryCodes: ["CA", "US"],
          maxRequestsPerRun: 8,
        }),
      }),
      expect.not.objectContaining({
        companyName: expect.anything(),
        searchScope: expect.anything(),
        initializedAt: expect.anything(),
      }),
    ]);
  });

  it("rejects empty or unbounded nested target scopes", () => {
    expect(() =>
      service.parseCreate({
        name: "empty scope",
        sourceTargets: [
          {
            site: Site.GOOGLE,
            tier: 2,
            intervalMinutes: 15,
            enabled: true,
            searchScope: {
              countryCodes: [],
              locations: [],
              maxRequestsPerRun: 1_001,
            },
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects per-target result ceilings outside 1 through 1000", () => {
    for (const resultsWanted of [0, 1_001, 1.5]) {
      expect(() =>
        service.parseCreate({
          name: "bad result ceiling",
          sourceTargets: [
            {
              site: Site.UBER,
              tier: 1,
              intervalMinutes: 10,
              resultsWanted,
              enabled: true,
            },
          ],
        }),
      ).toThrow(BadRequestException);
    }
  });

  it("rejects package IDs masquerading as Site values", () => {
    expect(() =>
      service.parseCreate({
        name: "bad",
        sourceTargets: [
          {
            site: "source-company-google",
            tier: 1,
            intervalMinutes: 3,
            enabled: true,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("rejects invalid threshold ordering and timezones", () => {
    expect(() =>
      service.parseCreate({
        name: "bad thresholds",
        digestScore: 80,
        minimumScore: 60,
      }),
    ).toThrow("digestScore must be less than or equal to minimumScore");

    expect(() =>
      service.parseCreate({
        name: "bad timezone",
        timezone: "Toronto-ish",
      }),
    ).toThrow("Invalid IANA timezone");
  });

  it("rejects raw Discord destinations and other unknown fields", () => {
    expect(() =>
      service.parseCreate({
        name: "secret leak",
        notificationChannels: [
          {
            type: "discord",
            destination: "https://discord.com/api/webhooks/secret",
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
