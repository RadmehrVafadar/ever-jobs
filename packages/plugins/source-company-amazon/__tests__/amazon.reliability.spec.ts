import "reflect-metadata";
import { ScraperInputDto, Site } from "@ever-jobs/models";

const mockPost = jest.fn();
jest.mock("@ever-jobs/common", () => ({
  ...jest.requireActual("@ever-jobs/common"),
  createHttpClient: jest.fn(() => ({
    post: mockPost,
    setHeaders: jest.fn(),
  })),
}));

import { AmazonService } from "../src";

describe("AmazonService source reliability", () => {
  beforeEach(() => mockPost.mockReset());

  it("rejects HTTP 400 instead of reporting an empty success", async () => {
    const failure = Object.assign(new Error("Request failed with status 400"), {
      response: { status: 400 },
    });
    mockPost.mockRejectedValueOnce(failure);

    await expect(
      new AmazonService().scrape({
        siteType: [Site.AMAZON],
      } as ScraperInputDto),
    ).rejects.toThrow("status 400");
  });

  it("accepts an empty searchHits array but rejects a malformed payload", async () => {
    const service = new AmazonService();
    mockPost.mockResolvedValueOnce({ data: { searchHits: [] } });
    await expect(
      service.scrape({ siteType: [Site.AMAZON] } as ScraperInputDto),
    ).resolves.toMatchObject({ jobs: [] });

    mockPost.mockResolvedValueOnce({ data: {} });
    await expect(
      service.scrape({ siteType: [Site.AMAZON] } as ScraperInputDto),
    ).rejects.toThrow("expected searchHits[]");
  });
});
