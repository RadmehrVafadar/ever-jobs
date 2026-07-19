import { JobPostDto, LocationDto } from "@ever-jobs/models";
import {
  GeographyClassificationService,
  GeographyTargetContext,
} from "../services/geography-classification.service";

describe("GeographyClassificationService", () => {
  const service = new GeographyClassificationService();

  it.each([
    ["Vancouver", "BC"],
    ["Calgary", "AB"],
    ["Montréal", "QC"],
    ["Ottawa", "ON"],
    ["Toronto", "ON"],
    ["Waterloo", "ON"],
  ])("accepts the Canadian Tier 1 location %s, %s", (city, state) => {
    expect(
      service.classify(job(new LocationDto({ city, state })), target(1)),
    ).toMatchObject({
      eligible: true,
      sourceTargetKey: "source-company-google",
      matchedCountry: "CA",
      locationConfidence: "high",
      geographyDecision: "eligible-canada",
    });
  });

  it("accepts a Canadian location from any Tier 2 or Tier 3 target", () => {
    for (const tier of [2, 3] as const) {
      expect(
        service.classify(
          job(new LocationDto({ city: "Halifax", state: "NS" })),
          target(tier),
        ),
      ).toMatchObject({
        eligible: true,
        matchedCountry: "CA",
        geographyDecision: "eligible-canada",
      });
    }
  });

  it("rejects a US posting from Tier 1 but accepts it from Tier 2 and Tier 3", () => {
    const posting = job(
      new LocationDto({ city: "New York", state: "NY", country: "USA" }),
    );

    expect(service.classify(posting, target(1))).toMatchObject({
      eligible: false,
      geographyDecision: "outside-target-scope",
      suppressionReason: "outside-target-scope",
    });
    for (const tier of [2, 3] as const) {
      expect(service.classify(posting, target(tier))).toMatchObject({
        eligible: true,
        matchedCountry: "US",
        geographyDecision: "eligible-united-states",
      });
    }
  });

  it("applies regional remote policy by tier", () => {
    const remoteCanada = job(
      new LocationDto({ city: "Remote", country: "Canada" }),
    );
    const remoteUs = job(
      new LocationDto({ city: "Remote", country: "United States" }),
    );

    expect(service.classify(remoteCanada, target(1))).toMatchObject({
      eligible: true,
      matchedCountry: "CA",
      geographyDecision: "eligible-canada",
    });
    expect(service.classify(remoteUs, target(1))).toMatchObject({
      eligible: false,
      geographyDecision: "outside-target-scope",
    });
    expect(service.classify(remoteUs, target(2))).toMatchObject({
      eligible: true,
      matchedCountry: "US",
      geographyDecision: "eligible-united-states",
    });
  });

  it.each(["North America", "Remote Americas"])(
    "accepts %s only for Tier 2 or Tier 3",
    (city) => {
      const posting = job(new LocationDto({ city }));
      expect(service.classify(posting, target(1))).toMatchObject({
        eligible: false,
        geographyDecision: "outside-target-scope",
      });
      expect(service.classify(posting, target(2))).toMatchObject({
        eligible: true,
        geographyDecision: "eligible-north-america",
        locationConfidence: "medium",
      });
    },
  );

  it("rejects a regional label that explicitly excludes both allowed countries", () => {
    const posting = job(new LocationDto({ city: "Remote Americas" }));
    posting.description =
      "This role is not available in Canada and cannot hire in the United States.";

    expect(service.classify(posting, target(3))).toMatchObject({
      eligible: false,
      geographyDecision: "outside-target-scope",
      suppressionReason: "outside-target-scope",
    });
  });

  it("suppresses unknown geography rather than treating it as outside scope", () => {
    expect(
      service.classify(job(new LocationDto({ city: "Remote" })), target(2)),
    ).toMatchObject({
      eligible: false,
      geographyDecision: "geography-unknown",
      suppressionReason: "geography-unknown",
      locationConfidence: "low",
    });
  });

  it("uses every advertised location and accepts when one is in scope", () => {
    const posting = job(
      new LocationDto({ city: "Berlin", country: "Germany" }),
    );
    posting.locations = [
      new LocationDto({ city: "Berlin", country: "Germany" }),
      new LocationDto({ city: "Vancouver", state: "BC" }),
    ];

    expect(service.classify(posting, target(1))).toMatchObject({
      eligible: true,
      matchedCountry: "CA",
      geographyDecision: "eligible-canada",
    });
  });

  it("keeps ranking preferences separate from Canada-wide eligibility", () => {
    const vancouver = service.classify(
      job(new LocationDto({ city: "Vancouver", state: "BC" })),
      target(1),
    );
    const toronto = service.classify(
      job(new LocationDto({ city: "Toronto", state: "ON" })),
      target(1),
    );
    const waterloo = service.classify(
      job(new LocationDto({ city: "Waterloo", state: "ON" })),
      target(1),
    );

    expect(vancouver.eligible).toBe(true);
    expect(vancouver.preferences).toEqual([]);
    expect(toronto.preferences).toContain("toronto");
    expect(waterloo.preferences).toContain("waterloo");
  });
});

function job(location: LocationDto): JobPostDto {
  return new JobPostDto({
    title: "Software Engineer Intern",
    companyName: "Example",
    jobUrl: "https://example.test/jobs/1",
    location,
  });
}

function target(tier: 1 | 2 | 3): GeographyTargetContext {
  return { key: "source-company-google", tier };
}
