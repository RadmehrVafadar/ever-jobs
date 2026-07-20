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

import { ShopifyModule, ShopifyService, ShopifySourceError } from "../src";

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const fixture = (name: string): string =>
  fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");

const BOARD = fixture("shopify-board.html");
const DETAIL_TEMPLATE = fixture("shopify-detail-template.html");
const EMPTY_BOARD = fixture("shopify-empty-board.html");
const BLOCKED = fixture("shopify-blocked.html");
const MALFORMED_BOARD = fixture("shopify-malformed-board.html");
const MALICIOUS_DETAIL = fixture("shopify-malicious-detail.html");

interface DetailFixture {
  jid: string;
  title: string;
  location: string;
  date: string;
  description: string;
}

const DETAILS: DetailFixture[] = [
  {
    jid: "11111111-1111-4111-8111-111111111111",
    title: "Software Engineering Intern",
    location: "Remote - Canada; Toronto, ON, Canada",
    date: "2026-07-01",
    description: "Build reliable commerce software for merchants.",
  },
  {
    jid: "22222222-2222-4222-8222-222222222222",
    title: "Applied ML Engineering Intern",
    location: "Remote - Canada",
    date: "2026-07-02",
    description: "Build and evaluate production machine-learning systems.",
  },
  {
    jid: "33333333-3333-4333-8333-333333333333",
    title: "Data Engineering Co-op",
    location: "Toronto, ON, Canada; Waterloo, ON, Canada",
    date: "2026-07-03",
    description: "Develop governed data pipelines and streaming systems.",
  },
  {
    jid: "44444444-4444-4444-8444-444444444444",
    title: "Infrastructure Engineering Intern",
    location: "Remote - Americas, Canada",
    date: "2026-07-04",
    description: "Improve cloud infrastructure and developer experience.",
  },
  {
    jid: "55555555-5555-4555-8555-555555555555",
    title: "Security Engineering Intern",
    location: "Ottawa, ON, Canada",
    date: "2026-07-05",
    description: "Automate product and platform security controls.",
  },
];

function renderDetail(detail: DetailFixture): string {
  return DETAIL_TEMPLATE.replaceAll("__JID__", detail.jid)
    .replaceAll("__TITLE__", detail.title)
    .replaceAll("__LOCATION__", detail.location)
    .replaceAll("__DATE__", detail.date)
    .replaceAll("__DESCRIPTION__", detail.description);
}

function mockOfficialPages(): void {
  mockGet.mockImplementation(async (url: string) => {
    if (url === "https://www.shopify.com/careers") return { data: BOARD };
    const jid = /_([0-9a-f-]{36})(?:[/?#]|$)/i.exec(url)?.[1];
    const detail = DETAILS.find((candidate) => candidate.jid === jid);
    if (!detail) throw new Error(`Unexpected fixture URL: ${url}`);
    return { data: renderDetail(detail) };
  });
}

describe("ShopifyService — Spec 6000 / T19", () => {
  beforeEach(() => mockGet.mockReset());

  it("resolves through its Nest module, pins Site.SHOPIFY, and declares board mode", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ShopifyModule],
    }).compile();
    expect(moduleRef.get(ShopifyService)).toBeInstanceOf(ShopifyService);
    await moduleRef.close();
    expect(Site.SHOPIFY).toBe("shopify");

    const metadata = Reflect.getMetadata(
      SOURCE_PLUGIN_METADATA,
      ShopifyService,
    ) as IPluginMetadata;
    expect(metadata).toMatchObject({ site: Site.SHOPIFY, watchMode: "board" });
  });

  it("covers software, ML, data, infrastructure, and security internships", async () => {
    mockOfficialPages();
    const result = await new ShopifyService().scrape({
      resultsWanted: 100,
    } as ScraperInputDto);

    expect(result.jobs.map((job) => job.title)).toEqual([
      "Software Engineering Intern",
      "Applied ML Engineering Intern",
      "Data Engineering Co-op",
      "Infrastructure Engineering Intern",
      "Security Engineering Intern",
    ]);
    expect(result.jobs.map((job) => job.title)).not.toContain(
      "Senior Product Manager",
    );
    expect(mockGet).toHaveBeenCalledTimes(6);
    expect(
      mockGet.mock.calls
        .map((call) => call[0] as string)
        .some((url) => url.includes("api.ashbyhq.com")),
    ).toBe(false);
  });

  it("preserves public JID identity, official application URL, date, remote label, and locations", async () => {
    mockOfficialPages();
    const result = await new ShopifyService().scrape({
      resultsWanted: 1,
    } as ScraperInputDto);
    const job = result.jobs[0];

    expect(job).toMatchObject({
      id: "shopify-11111111-1111-4111-8111-111111111111",
      atsId: "11111111-1111-4111-8111-111111111111",
      site: Site.SHOPIFY,
      companyName: "Shopify",
      title: "Software Engineering Intern",
      datePosted: "2026-07-01",
      isRemote: true,
      employmentType: "Intern",
      department: "Engineering & Data",
    });
    expect(job.jobUrl).toBe(
      "https://www.shopify.com/careers/software-engineering-intern_11111111-1111-4111-8111-111111111111",
    );
    expect(job.applyUrl).toBe(
      "https://www.shopify.com/careers?ashby_jid=11111111-1111-4111-8111-111111111111",
    );
    expect(job.locations?.length).toBeGreaterThanOrEqual(2);
    expect(
      job.locations?.some((location) => location.city?.includes("Toronto")),
    ).toBe(true);
  });

  it("honours resultsWanted without fetching unrelated Product roles", async () => {
    mockOfficialPages();
    const result = await new ShopifyService().scrape({
      resultsWanted: 2,
    } as ScraperInputDto);
    expect(result.jobs).toHaveLength(2);
    expect(mockGet).toHaveBeenCalledTimes(6);
    expect(
      mockGet.mock.calls.some((call) =>
        String(call[0]).includes("senior-product-manager"),
      ),
    ).toBe(false);
  });

  it("accepts a marker-validated board with no postings as an empty success", async () => {
    mockGet.mockResolvedValueOnce({ data: EMPTY_BOARD });
    const result = await new ShopifyService().scrape({} as ScraperInputDto);
    expect(result.jobs).toEqual([]);
  });

  it("propagates HTTP, blocking, and markup failures with explicit codes", async () => {
    const service = new ShopifyService();
    mockGet.mockRejectedValueOnce(new Error("Request failed with status 503"));
    await expect(service.scrape({} as ScraperInputDto)).rejects.toMatchObject({
      code: "HTTP",
    });

    mockGet.mockResolvedValueOnce({ data: BLOCKED });
    await expect(service.scrape({} as ScraperInputDto)).rejects.toMatchObject({
      code: "BLOCKED",
    });

    mockGet.mockResolvedValueOnce({ data: MALFORMED_BOARD });
    await expect(service.scrape({} as ScraperInputDto)).rejects.toMatchObject({
      code: "MARKUP_CHANGED",
    });
  });

  it("rejects malformed public detail payloads instead of returning partial success", async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === "https://www.shopify.com/careers") return { data: BOARD };
      return {
        data: '<html><script>window.__reactRouterContext.streamController.enqueue("[]")</script></html>',
      };
    });

    const rejection = new ShopifyService().scrape({
      resultsWanted: 1,
    } as ScraperInputDto);
    await expect(rejection).rejects.toBeInstanceOf(ShopifySourceError);
    await expect(rejection).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  it("rejects dangerous flattened keys without polluting Object.prototype", async () => {
    mockGet.mockImplementation(async (url: string) =>
      url === "https://www.shopify.com/careers"
        ? { data: BOARD }
        : { data: MALICIOUS_DETAIL },
    );

    await expect(
      new ShopifyService().scrape({ resultsWanted: 1 } as ScraperInputDto),
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });
});
