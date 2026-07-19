import { JobPostDto, LocationDto } from "../src";

describe("JobPostDto location compatibility", () => {
  it("preserves the singular primary location and an ordered location array", () => {
    const primary = new LocationDto({
      city: "Toronto",
      state: "Ontario",
      country: "Canada",
    });
    const secondary = new LocationDto({
      city: "Vancouver",
      state: "British Columbia",
      country: "Canada",
    });

    const job = new JobPostDto({
      title: "Software Engineering Intern",
      jobUrl: "https://example.com/jobs/1",
      location: primary,
      locations: [primary, secondary],
    });

    expect(job.location).toBe(primary);
    expect(job.locations).toEqual([primary, secondary]);
  });

  it("keeps legacy singular-location construction valid", () => {
    const location = new LocationDto({ city: "Waterloo", country: "Canada" });
    const job = new JobPostDto({
      title: "Developer Co-op",
      jobUrl: "https://example.com/jobs/2",
      location,
    });

    expect(job.location).toBe(location);
    expect(job.locations).toBeUndefined();
  });
});
