import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { ScraperInputDto, Site } from "@ever-jobs/models";
import {
  SOURCE_PLUGIN_METADATA,
  type IPluginMetadata,
} from "@ever-jobs/plugin";

const mockGet = jest.fn();
const mockSetHeaders = jest.fn();
jest.mock("@ever-jobs/common", () => {
  const actual = jest.requireActual("@ever-jobs/common");
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({
      get: mockGet,
      setHeaders: mockSetHeaders,
    })),
  };
});

import { NetflixService, NetflixSourceError } from "../src";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "netflix-pages.json"), "utf8"),
) as { pages: Array<Record<string, unknown>> };

describe("NetflixService — Spec 6000 / T49", () => {
  let service: NetflixService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NetflixService();
  });

  it("declares board mode", () => {
    const metadata = Reflect.getMetadata(
      SOURCE_PLUGIN_METADATA,
      NetflixService,
    ) as IPluginMetadata;
    expect(metadata).toMatchObject({
      site: Site.NETFLIX,
      category: "company",
      watchMode: "board",
    });
  });

  it("retrieves the full bounded board and preserves official job data", async () => {
    mockGet
      .mockResolvedValueOnce({ data: fixture.pages[0] })
      .mockResolvedValueOnce({ data: fixture.pages[1] });

    const response = await service.scrape(
      new ScraperInputDto({
        searchTerm: "ignored board filter",
        location: "Canada",
        resultsWanted: 3,
      }),
    );

    expect(response.jobs.map((job) => job.id)).toEqual([
      "netflix-201",
      "netflix-202",
      "netflix-203",
    ]);
    expect(response.jobs[0]).toMatchObject({
      site: Site.NETFLIX,
      companyName: "Netflix",
      jobUrl: "https://jobs.netflix.com/jobs/201",
      applyUrl: "https://jobs.netflix.com/jobs/201/apply",
      datePosted: "2026-07-05",
      employmentType: "Intern",
      department: "Platform Engineering",
      isRemote: true,
    });
    expect(response.jobs[0].locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "Toronto", country: "Canada" }),
      ]),
    );
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet.mock.calls.map((call) => call[0])).toEqual([
      "https://jobs.netflix.com/api/search?page=1",
      "https://jobs.netflix.com/api/search?page=2",
    ]);
    expect(mockSetHeaders).toHaveBeenCalledWith({ Accept: "application/json" });
  });

  it("honours resultsWanted without fetching a later page", async () => {
    mockGet.mockResolvedValueOnce({ data: fixture.pages[0] });
    const response = await service.scrape(
      new ScraperInputDto({ resultsWanted: 1 }),
    );
    expect(response.jobs).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("accepts a marker-validated empty collection", async () => {
    mockGet.mockResolvedValueOnce({
      data: { records: { postings: [], total: 0, total_pages: 0 } },
    });
    await expect(service.scrape(new ScraperInputDto())).resolves.toMatchObject({
      jobs: [],
    });
  });

  it("rejects transport, blocked-shell, malformed payload, and non-official URL failures", async () => {
    mockGet.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "HTTP",
    });

    mockGet.mockResolvedValueOnce({
      data: "<html><title>Access denied</title></html>",
    });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "BLOCKED",
    });

    mockGet.mockResolvedValueOnce({ data: { records: {} } });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });

    mockGet.mockResolvedValueOnce({
      data: {
        postings: [
          {
            id: "999",
            title: "Untrusted listing",
            url: "https://example.com/jobs/999",
          },
        ],
        has_next: false,
      },
    });
    await expect(service.scrape(new ScraperInputDto())).rejects.toBeInstanceOf(
      NetflixSourceError,
    );
  });
});
