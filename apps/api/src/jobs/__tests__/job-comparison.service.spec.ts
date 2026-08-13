import { AnalyticsService } from "@ever-jobs/analytics";
import { JobPostDto, Site } from "@ever-jobs/models";
import { JobComparisonService } from "../job-comparison.service";

describe("JobComparisonService", () => {
  it("caps concurrency and preserves successful sources after a failure", async () => {
    let active = 0;
    let peak = 0;
    const jobs = {
      listRegisteredSources: jest.fn(() => [
        Site.LINKEDIN,
        Site.INDEED,
        Site.GLASSDOOR,
      ]),
      searchJobs: jest.fn(async (input: { siteType?: Site[] }) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        const site = input.siteType?.[0];
        if (site === Site.INDEED) {
          throw new Error(
            "token=private at https://discord.com/api/webhooks/1/private",
          );
        }
        return [job(site ?? Site.LINKEDIN)];
      }),
    };
    const config = {
      get: jest.fn((_key: string, fallback: number) =>
        fallback === undefined ? 2 : 2,
      ),
    };
    const service = new JobComparisonService(
      jobs as never,
      new AnalyticsService(),
      config as never,
    );

    const result = await service.compare({
      siteType: [Site.LINKEDIN, Site.INDEED, Site.GLASSDOOR],
      concurrency: 10,
    });

    expect(result.concurrency).toBe(2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.sourcesSucceeded).toEqual([Site.LINKEDIN, Site.GLASSDOOR]);
    expect(result.comparisons).toHaveLength(2);
    expect(result.totalJobs).toBe(2);
    expect(result.sourcesFailed).toEqual([
      expect.objectContaining({
        source: Site.INDEED,
        error: expect.stringContaining("[redacted-url]"),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("reports explicitly requested unavailable sources as failures", async () => {
    const jobs = {
      listRegisteredSources: jest.fn(() => [Site.LINKEDIN]),
      searchJobs: jest.fn(),
    };
    const service = new JobComparisonService(
      jobs as never,
      new AnalyticsService(),
      { get: jest.fn(() => 3) } as never,
    );

    const result = await service.compare({ siteType: [Site.INDEED] });

    expect(result.sourcesSucceeded).toEqual([]);
    expect(result.sourcesFailed).toEqual([
      expect.objectContaining({
        source: Site.INDEED,
        error: expect.stringContaining("Unknown or unavailable source"),
      }),
    ]);
    expect(jobs.searchJobs).not.toHaveBeenCalled();
  });
});

function job(site: Site): JobPostDto {
  return new JobPostDto({
    id: `${site}-job`,
    title: "Software Engineer",
    companyName: "Acme",
    jobUrl: `https://example.test/${site}`,
    site,
    isRemote: site === Site.LINKEDIN,
  });
}
