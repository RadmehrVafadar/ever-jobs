import "reflect-metadata";
import * as fs from "fs";
import * as path from "path";
import { Test } from "@nestjs/testing";
import { ScraperInputDto, Site } from "@ever-jobs/models";
import {
  SOURCE_PLUGIN_METADATA,
  type IPluginMetadata,
} from "@ever-jobs/plugin";

const mockGet = jest.fn();
jest.mock("@ever-jobs/common", () => {
  const actual = jest.requireActual("@ever-jobs/common");
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({
      get: mockGet,
      setHeaders: jest.fn(),
    })),
  };
});

import {
  GoogleCareersModule,
  GoogleCareersService,
  GoogleCareersSourceError,
} from "../src";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const fixture = (name: string): string =>
  fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");

const RESULTS_PAGE_1 = fixture("results-page-1.html");
const RESULTS_PAGE_2 = fixture("results-page-2.html");
const EMPTY_RESULTS = fixture("empty-results.html");
const BLOCKED = fixture("blocked.html");
const MALFORMED_RESULTS = fixture("malformed-results.html");
const DETAILS: Record<string, string> = {
  "100000000000000001": fixture("detail-software.html"),
  "100000000000000002": fixture("detail-ml.html"),
  "100000000000000003": fixture("detail-security.html"),
};

function mockOfficialPages(): void {
  mockGet.mockImplementation(async (url: string) => {
    const detailId = /jobs\/results\/(\d+)-/.exec(url)?.[1];
    if (detailId) return { data: DETAILS[detailId] };
    if (url.includes("page=2")) return { data: RESULTS_PAGE_2 };
    return { data: RESULTS_PAGE_1 };
  });
}

describe("GoogleCareersService — Spec 6000 / T18", () => {
  beforeEach(() => mockGet.mockReset());

  it("resolves through its Nest module and declares query watch mode", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GoogleCareersModule],
    }).compile();
    expect(moduleRef.get(GoogleCareersService)).toBeInstanceOf(
      GoogleCareersService,
    );
    await moduleRef.close();

    const metadata = Reflect.getMetadata(
      SOURCE_PLUGIN_METADATA,
      GoogleCareersService,
    ) as IPluginMetadata;
    expect(metadata).toMatchObject({
      site: Site.GOOGLE_CAREERS,
      watchMode: "query",
    });
  });

  it("maps stable IDs, official apply URLs, genuine dates, and all locations", async () => {
    mockOfficialPages();
    const result = await new GoogleCareersService().scrape({
      searchTerm: "software engineering internship",
      location: "United States",
      resultsWanted: 2,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((job) => job.title)).not.toContain(
      "Software Engineering Apprenticeship, 2027",
    );
    const software = result.jobs[0];
    expect(software).toMatchObject({
      id: "google-careers-100000000000000001",
      site: Site.GOOGLE_CAREERS,
      companyName: "Google",
      title: "Software Engineering Intern, Summer 2027",
      datePosted: "2026-07-10",
      employmentType: "Intern & Apprentice",
    });
    expect(software.jobUrl).toBe(
      "https://www.google.com/about/careers/applications/jobs/results/100000000000000001-software-engineering-intern-summer-2027",
    );
    expect(software.applyUrl).toContain(
      "google.com/about/careers/applications/jobs/results/apply?jobId=official-google-token-1",
    );
    expect(software.locations).toHaveLength(3);
    expect(software.locations?.map((location) => location.city)).toEqual(
      expect.arrayContaining(["Waterloo", "Montreal", "Toronto"]),
    );

    const requestedUrls = mockGet.mock.calls.map((call) => call[0] as string);
    expect(requestedUrls[0]).toContain(
      "google.com/about/careers/applications/jobs/results/",
    );
    expect(requestedUrls[0]).toContain("location=Canada");
    expect(requestedUrls[0]).toContain("target_level=INTERN_AND_APPRENTICE");
    expect(requestedUrls[0]).not.toContain("careers.google.com/api/v3/search");
    expect(
      requestedUrls.some((url) => url.includes("100000000000000004")),
    ).toBe(false);
  });

  it("paginates deterministically when the requested cap exceeds one page", async () => {
    mockOfficialPages();
    const result = await new GoogleCareersService().scrape({
      resultsWanted: 21,
    } as ScraperInputDto);

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[2].id).toBe("google-careers-100000000000000003");
    const searchUrls = mockGet.mock.calls
      .map((call) => call[0] as string)
      .filter((url) => !/jobs\/results\/\d+-/.test(url));
    expect(searchUrls).toHaveLength(2);
    expect(searchUrls[0]).toContain("page=1");
    expect(searchUrls[1]).toContain("page=2");
  });

  it("continues pagination when early cards are filtered before resultsWanted is met", async () => {
    mockOfficialPages();
    const result = await new GoogleCareersService().scrape({
      resultsWanted: 3,
    } as ScraperInputDto);

    expect(result.jobs.map((job) => job.id)).toEqual([
      "google-careers-100000000000000001",
      "google-careers-100000000000000002",
      "google-careers-100000000000000003",
    ]);
    const requestedUrls = mockGet.mock.calls.map((call) => call[0] as string);
    expect(requestedUrls.filter((url) => url.includes("page=2"))).toHaveLength(
      1,
    );
    expect(
      requestedUrls.some((url) => url.includes("100000000000000004")),
    ).toBe(false);
  });

  it("forwards shared-parser-confirmed Canadian matrix locations", async () => {
    mockGet.mockResolvedValueOnce({ data: EMPTY_RESULTS });
    await new GoogleCareersService().scrape({
      location: "Toronto, Ontario",
      resultsWanted: 10,
    } as ScraperInputDto);

    const url = new URL(mockGet.mock.calls[0][0] as string);
    expect(url.searchParams.get("location")).toBe("Toronto, Ontario");
  });

  it("accepts a validated empty results page as a successful empty run", async () => {
    mockGet.mockResolvedValueOnce({ data: EMPTY_RESULTS });
    const result = await new GoogleCareersService().scrape({
      resultsWanted: 10,
    } as ScraperInputDto);
    expect(result.jobs).toEqual([]);
  });

  it("turns HTTP failures into explicit source failures", async () => {
    mockGet.mockRejectedValueOnce(new Error("Request failed with status 503"));
    await expect(
      new GoogleCareersService().scrape({} as ScraperInputDto),
    ).rejects.toMatchObject({ code: "HTTP" });
  });

  it("rejects blocking and unexpected markup instead of returning empty success", async () => {
    const service = new GoogleCareersService();
    mockGet.mockResolvedValueOnce({ data: BLOCKED });
    await expect(service.scrape({} as ScraperInputDto)).rejects.toMatchObject({
      code: "BLOCKED",
    });

    mockGet.mockResolvedValueOnce({ data: MALFORMED_RESULTS });
    await expect(service.scrape({} as ScraperInputDto)).rejects.toMatchObject({
      code: "MARKUP_CHANGED",
    });
  });

  it("rejects a malformed detail payload as a schema failure", async () => {
    mockOfficialPages();
    mockGet.mockImplementation(async (url: string) => {
      if (/jobs\/results\/100000000000000001-/.test(url)) {
        return {
          data: DETAILS["100000000000000001"].replace(
            /<a id="apply-action-button"[^>]*><\/a>/,
            "",
          ),
        };
      }
      if (/jobs\/results\/\d+-/.test(url)) {
        return { data: DETAILS["100000000000000002"] };
      }
      return { data: RESULTS_PAGE_1 };
    });

    const rejection = new GoogleCareersService().scrape({
      resultsWanted: 1,
    } as ScraperInputDto);
    await expect(rejection).rejects.toBeInstanceOf(GoogleCareersSourceError);
    await expect(rejection).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });
});
