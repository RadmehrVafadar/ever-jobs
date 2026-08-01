import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { Test } from "@nestjs/testing";
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

import { IbmModule, IbmService, IbmSourceError } from "../src";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

const PAGE_0 = fixture("ibm-page-0.html");
const PAGE_1 = fixture("ibm-page-1.html");
const EMPTY = fixture("ibm-empty.html");
const BLOCKED = fixture("ibm-blocked.html");
const MALFORMED = fixture("ibm-malformed.html");

describe("IbmService — deterministic Spec 6000 / T49 coverage", () => {
  let service: IbmService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IbmService();
  });

  it("resolves through its module and declares board mode", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IbmModule],
    }).compile();
    expect(moduleRef.get(IbmService)).toBeInstanceOf(IbmService);
    await moduleRef.close();

    const metadata = Reflect.getMetadata(
      SOURCE_PLUGIN_METADATA,
      IbmService,
    ) as IPluginMetadata;
    expect(metadata).toMatchObject({
      site: Site.IBM,
      category: "company",
      watchMode: "board",
    });
  });

  it("paginates fixtures only and preserves identity, URLs, dates, employment, and locations", async () => {
    mockGet
      .mockResolvedValueOnce({ data: PAGE_0 })
      .mockResolvedValueOnce({ data: PAGE_1 });

    const response = await service.scrape(
      new ScraperInputDto({
        searchTerm: "ignored board filter",
        location: "Canada",
        resultsWanted: 3,
      }),
    );

    expect(response.jobs.map((job) => job.id)).toEqual([
      "ibm-301",
      "ibm-302",
      "ibm-303",
    ]);
    expect(response.jobs[0]).toMatchObject({
      site: Site.IBM,
      companyName: "IBM",
      jobUrl: "https://www.ibm.com/careers/job/301",
      applyUrl: "https://www.ibm.com/careers/job/301/apply",
      datePosted: "2026-07-08",
      employmentType: "Intern",
      department: "Cloud Platform",
      isRemote: true,
    });
    expect(response.jobs[0].locations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "Toronto", country: "Canada" }),
      ]),
    );
    expect(response.jobs[2].locations).toHaveLength(2);
    expect(mockGet.mock.calls.map((call) => call[0])).toEqual([
      "https://www.ibm.com/careers/search?page=0",
      "https://www.ibm.com/careers/search?page=1",
    ]);
    expect(mockSetHeaders).toHaveBeenCalledWith({
      Accept: "text/html,application/xhtml+xml",
    });
  });

  it("honours resultsWanted before requesting a later page", async () => {
    mockGet.mockResolvedValueOnce({ data: PAGE_0 });
    const response = await service.scrape(
      new ScraperInputDto({ resultsWanted: 1 }),
    );
    expect(response.jobs).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("accepts a board-marker-validated empty page", async () => {
    mockGet.mockResolvedValueOnce({ data: EMPTY });
    await expect(service.scrape(new ScraperInputDto())).resolves.toMatchObject({
      jobs: [],
    });
  });

  it("rejects transport, blocked, malformed, and unavailable pages without live I/O", async () => {
    mockGet.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "HTTP",
    });

    mockGet.mockResolvedValueOnce({ data: BLOCKED });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "BLOCKED",
    });

    mockGet.mockResolvedValueOnce({ data: MALFORMED });
    await expect(service.scrape(new ScraperInputDto())).rejects.toBeInstanceOf(
      IbmSourceError,
    );

    mockGet.mockResolvedValueOnce({
      data: "<html><body><h1>Search Jobs</h1><p>0 results</p><p>Our search function is temporarily unavailable. Please wait a few minutes and try again.</p></body></html>",
    });
    await expect(service.scrape(new ScraperInputDto())).rejects.toMatchObject({
      code: "MARKUP_CHANGED",
    });
  });
});
