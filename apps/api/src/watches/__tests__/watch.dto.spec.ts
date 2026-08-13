import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Site } from "@ever-jobs/models";
import {
  ApplyWatchDto,
  CreateWatchDto,
  InitializeWatchDto,
} from "../watch.dto";

describe("watch DTO nested source scope", () => {
  it("accepts a bounded target scope and nullable baseline timestamp", async () => {
    const dto = plainToInstance(CreateWatchDto, {
      name: "Scoped internships",
      roleFamilies: ["technical-product", "technology-risk-it-audit"],
      sourceTargets: [
        {
          site: Site.ASHBY,
          tier: 1,
          intervalMinutes: 3,
          companySlug: "wealthsimple",
          companyName: "Wealthsimple",
          companyUrl: "https://jobs.example.ca/students",
          mode: "board-search",
          initializedAt: null,
          searchScope: {
            countryCodes: ["CA", "US"],
            locations: ["Canada", "United States"],
            searchTerms: ["software intern"],
            maxRequestsPerRun: 8,
          },
          enabled: true,
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it("rejects invalid target URLs, modes, and duplicate role families", async () => {
    const dto = plainToInstance(CreateWatchDto, {
      name: "Invalid target contract",
      roleFamilies: ["technical-product", "technical-product"],
      sourceTargets: [
        {
          site: Site.ASHBY,
          tier: 1,
          intervalMinutes: 10,
          companyUrl: "not-a-url",
          mode: "term-board",
          enabled: true,
        },
      ],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it("rejects invalid nested scope bounds", async () => {
    const dto = plainToInstance(CreateWatchDto, {
      name: "Invalid scope",
      sourceTargets: [
        {
          site: Site.GOOGLE,
          tier: 2,
          intervalMinutes: 15,
          searchScope: {
            countryCodes: ["CAN"],
            locations: [],
            maxRequestsPerRun: 1_001,
          },
          enabled: true,
        },
      ],
    });

    const errors = await validate(dto);
    expect(errors).not.toHaveLength(0);
    expect(errors[0].children?.[0].children).not.toHaveLength(0);
  });
});

describe("InitializeWatchDto", () => {
  it("accepts omitted, empty, and unique target keys", async () => {
    await expect(validate(new InitializeWatchDto())).resolves.toEqual([]);
    await expect(
      validate(plainToInstance(InitializeWatchDto, { targetKeys: [] })),
    ).resolves.toEqual([]);
    await expect(
      validate(
        plainToInstance(InitializeWatchDto, {
          targetKeys: ["ashby:wealthsimple", "canadajobbank"],
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("rejects duplicate or blank target keys", async () => {
    const duplicate = plainToInstance(InitializeWatchDto, {
      targetKeys: ["canadajobbank", "canadajobbank"],
    });
    const blank = plainToInstance(InitializeWatchDto, { targetKeys: [""] });

    expect(await validate(duplicate)).not.toHaveLength(0);
    expect(await validate(blank)).not.toHaveLength(0);
  });
});

describe("operator watch DTOs", () => {
  it("accepts nested notification routing and an optimistic apply envelope", async () => {
    const dto = plainToInstance(ApplyWatchDto, {
      expectedUpdatedAt: "2026-08-04T12:00:00.000Z",
      patch: {
        notificationRoutes: [
          {
            id: "tier-one",
            name: "Tier one urgent",
            enabled: true,
            provider: "discord",
            destinationRef: "tier-one",
            conditions: {
              sourceTiers: [1],
              notificationTypes: ["urgent"],
              minimumScore: 80,
              maximumScore: 100,
            },
          },
        ],
      },
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it("rejects malformed optimistic timestamps and route conditions", async () => {
    const dto = plainToInstance(ApplyWatchDto, {
      expectedUpdatedAt: "yesterday",
      patch: {
        notificationRoutes: [
          {
            id: "tier-one",
            name: "Tier one urgent",
            enabled: true,
            provider: "discord",
            destinationRef: "tier-one",
            conditions: {
              sourceTiers: [4],
              notificationTypes: ["immediate"],
            },
          },
        ],
      },
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
