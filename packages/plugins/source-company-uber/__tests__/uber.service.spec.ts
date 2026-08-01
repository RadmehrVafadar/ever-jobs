import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { ScraperInputDto, Site } from "@ever-jobs/models";
import {
  SOURCE_PLUGIN_METADATA,
  type IPluginMetadata,
} from "@ever-jobs/plugin";

const mockPost = jest.fn();
const mockSetHeaders = jest.fn();
jest.mock("@ever-jobs/common", () => {
  const actual = jest.requireActual("@ever-jobs/common");
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({
      post: mockPost,
      setHeaders: mockSetHeaders,
    })),
  };
});

import { UberService, UberSourceError } from "../src";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "uber-pages.json"), "utf8"),
) as { pages: Array<Record<string, unknown>> };

describe("UberService — Spec 6000 / T49", () => {
  let service: UberService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UberService();
    (service as unknown as { delay: () => Promise<void> }).delay = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  it("declares board mode and uses the shared HTTP client contract", () => {
    const metadata = Reflect.getMetadata(
      SOURCE_PLUGIN_METADATA,
      UberService,
    ) as IPluginMetadata;
    expect(metadata).toMatchObject({
      site: Site.UBER,
      category: "company",
      watchMode: "board",
    });
  });

  it("paginates to the result boundary and preserves identity, URLs, dates, employment, and locations", async () => {
    mockPost
      .mockResolvedValueOnce({ data: fixture.pages[0] })
      .mockResolvedValueOnce({ data: fixture.pages[1] });

    const response = await service.scrape(
      new ScraperInputDto({ resultsWanted: 3 }),
    );

    expect(response.jobs).toHaveLength(3);
    expect(response.jobs.map((job) => job.id)).toEqual([
      "uber-101",
      "uber-102",
      "uber-103",
    ]);
    expect(response.jobs[0]).toMatchObject({
      companyName: "Uber",
      site: Site.UBER,
      jobUrl: "https://www.uber.com/global/en/careers/list/101/",
      applyUrl: "https://www.uber.com/global/en/careers/list/101/apply/",
      datePosted: "2026-07-01",
      employmentType: "Intern",
      department: "Engineering",
      team: "Developer Platform",
      isRemote: true,
    });
    expect(response.jobs[0].locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "Toronto", country: "Canada" }),
      ]),
    );
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(mockPost.mock.calls.map((call) => call[1].page)).toEqual([0, 1]);
    expect(mockSetHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ Accept: "application/json" }),
    );
  });

  it("accepts a validated empty collection and avoids I/O for a zero boundary", async () => {
    mockPost.mockResolvedValueOnce({
      data: { data: { results: [], totalResults: 0 } },
    });
    await expect(service.scrape(new ScraperInputDto())).resolves.toMatchObject({
      jobs: [],
    });

    mockPost.mockClear();
    await expect(
      service.scrape(new ScraperInputDto({ resultsWanted: 0 })),
    ).resolves.toMatchObject({ jobs: [] });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("rejects transport, blocked-shell, malformed payload, and malformed-job failures", async () => {
    mockPost.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "HTTP",
    });

    mockPost.mockResolvedValueOnce({
      data: "<!doctype html><title>Just a moment</title>",
    });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "BLOCKED",
    });

    mockPost.mockResolvedValueOnce({ data: { data: { totalResults: 0 } } });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
    });

    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          totalResults: 1,
          results: [{ id: 999, title: "Missing URL" }],
        },
      },
    });
    await expect(service.scrape(new ScraperInputDto())).rejects.toBeInstanceOf(
      UberSourceError,
    );
  });
});
