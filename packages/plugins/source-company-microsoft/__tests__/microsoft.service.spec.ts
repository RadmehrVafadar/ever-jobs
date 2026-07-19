import { readFileSync } from "fs";
import { join } from "path";

jest.mock("@ever-jobs/common", () => {
  const actual = jest.requireActual("@ever-jobs/common");
  return { ...actual, createHttpClient: jest.fn() };
});

import { createHttpClient } from "@ever-jobs/common";
import { ScraperInputDto, Site } from "@ever-jobs/models";
import { MicrosoftService } from "../src/microsoft.service";

const payload = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "microsoft-positions.json"), "utf8"),
);

describe("MicrosoftService watcher coverage", () => {
  const get = jest.fn();
  const setHeaders = jest.fn();
  let service: MicrosoftService;

  beforeEach(() => {
    jest.clearAllMocks();
    (createHttpClient as jest.Mock).mockReturnValue({ get, setHeaders });
    service = new MicrosoftService();
    (service as unknown as { delay: () => Promise<void> }).delay = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  it("forwards the query/location and preserves every advertised location", async () => {
    get.mockResolvedValue({ data: payload });
    const response = await service.scrape(
      new ScraperInputDto({
        siteType: [Site.MICROSOFT],
        searchTerm: "software engineering intern",
        location: "Canada",
        resultsWanted: 1,
      }),
    );

    expect(get.mock.calls[0][1].params).toMatchObject({
      query: "software engineering intern",
      location: "Canada",
      sort_by: "timestamp",
    });
    expect(response.jobs).toHaveLength(1);
    expect(
      response.jobs[0].locations?.map((location) => location.displayLocation()),
    ).toEqual([
      "Vancouver, British Columbia, Canada",
      "Toronto, Ontario, Canada",
      "Redmond, Washington, United States",
    ]);
    expect(response.jobs[0].location?.displayLocation()).toBe(
      "Vancouver, British Columbia, Canada",
    );
  });

  it("propagates invalid schemas and HTTP failures", async () => {
    get.mockResolvedValueOnce({ data: { data: {} } });
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      "expected data.positions[]",
    );

    get.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      "upstream unavailable",
    );
  });

  it("rejects a malformed position instead of returning an empty success", async () => {
    get.mockResolvedValueOnce({
      data: {
        data: {
          positions: [
            {
              id: "1842002",
              locations: ["Toronto, Ontario, Canada"],
              positionUrl: "/en-us/job/1842002/malformed-position",
            },
          ],
        },
      },
    });

    await expect(service.scrape(new ScraperInputDto())).rejects.toThrow(
      "expected a non-empty name",
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});
