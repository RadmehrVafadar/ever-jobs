import { describe, expect, it } from "vitest";
import { JobWatch } from "../types";
import {
  diffWatch,
  editableWatch,
  isTargetInitialized,
  parseImportedWatchDraft,
  validateDraft,
} from "./watch-draft";

describe("watch draft helpers", () => {
  it("classifies metadata, schedule, and routing changes as live updates", () => {
    const original = editableWatch(makeWatch());
    const draft = structuredClone(original);
    draft.name = "Renamed watch";
    draft.schedule = "0 * * * *";
    draft.notificationRoutes = [
      {
        id: "tier-one",
        name: "Tier 1 alerts",
        enabled: true,
        provider: "discord",
        destinationRef: "tier-one",
        conditions: { sourceTiers: [1] },
      },
    ];

    expect(diffWatch(original, draft)).toEqual([
      expect.objectContaining({ path: "name", behaviorChanging: false }),
      expect.objectContaining({ path: "schedule", behaviorChanging: false }),
      expect.objectContaining({
        path: "notificationRoutes",
        behaviorChanging: false,
      }),
    ]);
  });

  it("classifies source, eligibility, and scoring changes as baseline-requiring", () => {
    const original = editableWatch(makeWatch());
    const draft = structuredClone(original);
    draft.locations = ["Vancouver, BC"];
    draft.minimumScore = 65;
    draft.sourceTargets = [{ ...draft.sourceTargets[0], tier: 1 }];

    expect(diffWatch(original, draft)).toEqual([
      expect.objectContaining({
        path: "sourceTargets",
        behaviorChanging: true,
      }),
      expect.objectContaining({ path: "locations", behaviorChanging: true }),
      expect.objectContaining({ path: "minimumScore", behaviorChanging: true }),
    ]);
  });

  it("does not include identifiers or runtime health fields in an editable draft", () => {
    const draft = editableWatch(makeWatch());

    expect(draft).not.toHaveProperty("id");
    expect(draft).not.toHaveProperty("createdAt");
    expect(draft).not.toHaveProperty("updatedAt");
    expect(draft).not.toHaveProperty("targetHealth");
    expect(draft).not.toHaveProperty("lastRunAt");
    expect(draft).not.toHaveProperty("nextRunAt");
    expect(draft.sourceTargets[0]).not.toHaveProperty("initializedAt");
    expect(draft.sourceTargets[0]).not.toHaveProperty("lastRunAt");
    expect(draft.sourceTargets[0]).not.toHaveProperty("nextRunAt");
    expect(draft.sourceTargets[0]).toEqual(
      expect.objectContaining({
        companyUrl: "https://boards.example.ca/students",
        mode: "board-search",
      }),
    );
    expect(draft.sourceTargets[0].searchScope?.strictLocations).toBe(true);
  });

  it("validates imported JSON and discards identifiers, runtime state, and unknown secret fields", () => {
    const current = editableWatch(makeWatch());
    const imported = parseImportedWatchDraft(
      {
        ...current,
        id: "must-not-import",
        leaseToken: "must-not-import",
        webhookUrl: "https://discord.com/api/webhooks/1/must-not-import",
      },
      current,
    );

    expect(imported).not.toHaveProperty("id");
    expect(imported).not.toHaveProperty("leaseToken");
    expect(imported).not.toHaveProperty("webhookUrl");
    expect(() =>
      parseImportedWatchDraft({ ...current, locations: "Toronto" }, current),
    ).toThrow(/locations must be an array of strings/);
    expect(() =>
      parseImportedWatchDraft(
        {
          ...current,
          notificationRoutes: [
            {
              id: "unsafe",
              name: "Unsafe",
              enabled: true,
              provider: "discord",
              destinationRef: "default",
              webhookUrl: "https://discord.com/api/webhooks/1/must-not-import",
            },
          ],
        },
        current,
      ),
    ).toThrow(/notificationRoutes contains an invalid routing rule/);
  });

  it("inherits a legacy watch baseline only when the target timestamp is absent", () => {
    const watchInitializedAt = "2026-08-04T12:00:00.000Z";

    expect(isTargetInitialized({}, watchInitializedAt)).toBe(true);
    expect(
      isTargetInitialized({ initializedAt: null }, watchInitializedAt),
    ).toBe(false);
    expect(isTargetInitialized({}, null)).toBe(false);
  });

  it("accepts a valid profile and inclusive route score range", () => {
    const draft = editableWatch(makeWatch());
    draft.notificationRoutes = [
      {
        id: "standard",
        name: "Standard alerts",
        enabled: true,
        provider: "discord",
        destinationRef: "default",
        conditions: { minimumScore: 60, maximumScore: 60 },
      },
    ];

    expect(validateDraft(draft)).toEqual([]);
  });

  it("reports profile, target, threshold, country, and route validation failures", () => {
    const draft = editableWatch(makeWatch());
    draft.name = " ";
    draft.timezone = "";
    draft.intervalMinutes = 0;
    draft.digestScore = 90;
    draft.minimumScore = 80;
    draft.urgentScore = 70;
    draft.countryCodes = ["CAN"];
    draft.sourceTargets = [
      { ...draft.sourceTargets[0], site: "", intervalMinutes: 1_441 },
    ];
    draft.notificationRoutes = [
      {
        id: "broken",
        name: "",
        enabled: true,
        provider: "discord",
        destinationRef: " ",
        conditions: { minimumScore: 91, maximumScore: 90 },
      },
    ];

    const errors = validateDraft(draft);

    expect(errors).toEqual(
      expect.arrayContaining([
        "Give this watch a name.",
        "Choose a timezone.",
        "Default interval must be between 1 and 1,440 minutes.",
        "Country codes must use two letters.",
        "Source 1 needs a site.",
        "Source 1 has an invalid interval.",
        "Notification route 1 needs a name.",
        "Notification route 1 needs a destination.",
      ]),
    );
    expect(errors.some((error) => error.startsWith("Scores must follow"))).toBe(
      true,
    );
    expect(
      errors.some((error) =>
        error.includes("minimum score above maximum score"),
      ),
    ).toBe(true);
  });
});

function makeWatch(): JobWatch {
  return {
    id: "watch-1",
    name: "Internship watch",
    enabled: false,
    description: "Local operator test watch",
    schedule: null,
    intervalMinutes: 30,
    timezone: "America/Toronto",
    sources: ["greenhouse"],
    sourceTiers: { greenhouse: 2 },
    sourceTargets: [
      {
        site: "greenhouse",
        tier: 2,
        intervalMinutes: 30,
        resultsWanted: 50,
        companyUrl: "https://boards.example.ca/students",
        mode: "board-search",
        searchScope: {
          countryCodes: ["CA"],
          locations: ["Toronto, Ontario"],
          strictLocations: true,
        },
        enabled: true,
        initializedAt: "2026-08-04T12:00:00.000Z",
      },
    ],
    targetHealth: {},
    companySlugs: [],
    companies: [],
    searchTerms: ["software engineer intern"],
    roleFamilies: [
      "software-engineering",
      "data-ai",
      "cybersecurity",
      "cloud-platform-infrastructure",
    ],
    requiredTerms: [],
    preferredTerms: ["TypeScript"],
    excludedTerms: ["senior"],
    locations: ["Toronto, ON"],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid"],
    allowedEmploymentTypes: ["internship"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [{ type: "discord", destinationRef: "default" }],
    notificationRoutes: [],
    initializationMode: "baseline",
    recentWindowMinutes: 180,
    weights: { role: 30 },
    initializedAt: "2026-08-04T12:00:00.000Z",
    lastRunAt: "2026-08-04T13:00:00.000Z",
    nextRunAt: "2026-08-04T13:30:00.000Z",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
}
