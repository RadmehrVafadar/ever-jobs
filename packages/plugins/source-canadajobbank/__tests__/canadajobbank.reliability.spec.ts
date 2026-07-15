import "reflect-metadata";
import { ScraperInputDto, Site } from "@ever-jobs/models";

const mockGet = jest.fn();
jest.mock("@ever-jobs/common", () => ({
  ...jest.requireActual("@ever-jobs/common"),
  createHttpClient: jest.fn(() => ({
    get: mockGet,
    setHeaders: jest.fn(),
  })),
}));

import { CanadaJobBankService } from "../src";

describe("CanadaJobBankService source reliability", () => {
  beforeEach(() => mockGet.mockReset());

  it("rejects an API-level unsuccessful response", async () => {
    mockGet.mockResolvedValueOnce({ data: { success: false } });

    await expect(
      new CanadaJobBankService().scrape({
        siteType: [Site.CANADAJOBBANK],
      } as ScraperInputDto),
    ).rejects.toThrow("unsuccessful response");
  });

  it("accepts a valid empty records array but rejects a malformed payload", async () => {
    const service = new CanadaJobBankService();
    mockGet.mockResolvedValueOnce({
      data: { success: true, result: { records: [], total: 0, fields: [] } },
    });
    await expect(
      service.scrape({ siteType: [Site.CANADAJOBBANK] } as ScraperInputDto),
    ).resolves.toMatchObject({ jobs: [] });

    mockGet.mockResolvedValueOnce({ data: { success: true, result: {} } });
    await expect(
      service.scrape({ siteType: [Site.CANADAJOBBANK] } as ScraperInputDto),
    ).rejects.toThrow("expected result.records[]");
  });
});
