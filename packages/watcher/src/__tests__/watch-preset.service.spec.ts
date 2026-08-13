import { readFileSync } from "fs";
import { resolve } from "path";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import { JobWatch } from "../interfaces/watch.types";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import {
  assertCanadianTechInternshipCompanyCoverage,
  CANADIAN_TECH_INTERNSHIP_COMPANIES,
  CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES,
  CANADIAN_TECH_INTERNSHIP_LOCATIONS,
  canadianTechInternshipsWatch,
  CANADIAN_TECH_INTERNSHIPS_ID,
  CANADIAN_TECH_INTERNSHIPS_NAME,
} from "../services/canadian-tech-internships.preset";
import {
  assertCanadianTechAdjacentInternshipCompanyCoverage,
  CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES,
  CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS,
  CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES,
  canadianTechAdjacentInternshipsWatch,
  CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
  CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME,
} from "../services/canadian-tech-adjacent-internships.preset";
import {
  validateWatchTargetKeys,
  watchSourceTargetKey,
  WatchPresetService,
} from "../services/watch-preset.service";
import { WatchValidationService } from "../services/watch-validation.service";

describe("canadian-tech-internships preset", () => {
  it("defines the disabled, uninitialized and evidence-gated target matrix", () => {
    const watch = canadianTechInternshipsWatch();
    const targets = watch.sourceTargets ?? [];
    const byKey = new Map(
      targets.map((target) => [watchSourceTargetKey(target), target]),
    );

    expect(watch).toEqual(
      expect.objectContaining({
        name: CANADIAN_TECH_INTERNSHIPS_NAME,
        enabled: false,
        intervalMinutes: 10,
        initializationMode: "baseline",
        countryCodes: ["CA"],
        locations: CANADIAN_TECH_INTERNSHIP_LOCATIONS,
        requiredTerms: ["intern", "internship", "co-op", "coop", "summer 2027"],
      }),
    );
    expect([...byKey]).toHaveLength(targets.length);
    expect(
      targets.filter((target) => target.enabled).map(watchSourceTargetKey),
    ).toEqual([
      "google_careers",
      "shopify",
      "ashby:wealthsimple",
      "ashby:plaid",
      "amazon",
      "microsoft",
      "apple",
      "nvidia",
      "stripe",
      "openai",
      "datadog",
      "doordash",
      "coinbase",
      "figma",
      "vercel",
      "meta",
      "wellfound",
      "uber",
      "notion",
      "ramp",
      "netflix",
      "ibm",
      "canadajobbank",
      "linkedin",
    ]);
    expect(targets.every((target) => target.initializedAt === null)).toBe(true);
    expect(watch.searchTerms).toHaveLength(19);
    expect(
      watch.searchTerms?.every((term) => term.startsWith("summer 2027 ")),
    ).toBe(true);
    expect(watch.excludedTerms).toEqual(
      expect.arrayContaining(["phd", "ph.d", "ph.d.", "doctoral", "doctorate"]),
    );

    expect(byKey.get("google_careers")).toEqual(
      expect.objectContaining({
        tier: 1,
        intervalMinutes: 10,
        enabled: true,
        searchScope: expect.objectContaining({
          countryCodes: ["CA"],
          maxRequestsPerRun: 1,
        }),
      }),
    );
    expect(byKey.get("canadajobbank")).toEqual(
      expect.objectContaining({ tier: 2, intervalMinutes: 30, enabled: true }),
    );
    expect(byKey.get("google")?.searchScope).toEqual(
      expect.objectContaining({
        countryCodes: ["CA"],
        locations: CANADIAN_TECH_INTERNSHIP_LOCATIONS,
        maxRequestsPerRun: 12,
      }),
    );
    expect(byKey.get("linkedin")).toEqual(
      expect.objectContaining({
        tier: 3,
        intervalMinutes: 60,
        enabled: true,
        searchScope: expect.objectContaining({ maxRequestsPerRun: 8 }),
      }),
    );
    expect(byKey.get("meta")?.enabled).toBe(true);
    expect(byKey.get("meta")?.intervalMinutes).toBe(10);
    expect(byKey.get("wellfound")).toEqual(
      expect.objectContaining({ enabled: true, intervalMinutes: 30 }),
    );
    for (const key of ["uber", "notion", "ramp", "netflix", "ibm"]) {
      expect(byKey.get(key)).toEqual(
        expect.objectContaining({
          enabled: true,
          tier: 1,
          intervalMinutes: 10,
          resultsWanted: 500,
          initializedAt: null,
          searchScope: expect.objectContaining({ countryCodes: ["CA"] }),
        }),
      );
    }
    expect(byKey.get("google")?.enabled).toBe(false);
    expect(
      targets.every(
        (target) =>
          !target.searchScope ||
          (target.searchScope.countryCodes.length === 1 &&
            target.searchScope.countryCodes[0] === "CA" &&
            target.searchScope.strictLocations === true &&
            JSON.stringify(target.searchScope.locations) ===
              JSON.stringify(CANADIAN_TECH_INTERNSHIP_LOCATIONS)),
      ),
    ).toBe(true);

    const activePrestige = new Set(
      targets
        .filter((target) => target.enabled && target.companyName)
        .map((target) => target.companyName),
    );
    expect(
      CANADIAN_TECH_INTERNSHIP_COMPANIES.filter((company) =>
        activePrestige.has(company),
      ),
    ).toHaveLength(21);
    expect(CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES).toEqual([
      "RBC",
      "TD",
      "Scotiabank",
      "BMO",
      "CIBC",
    ]);
  });

  it("rejects an inventory entry with neither target nor deferral", () => {
    const targets = canadianTechInternshipsWatch().sourceTargets ?? [];
    const withoutUber = targets.filter(
      (target) => target.companyName !== "Uber",
    );
    expect(() =>
      assertCanadianTechInternshipCompanyCoverage(withoutUber),
    ).toThrow(/Uber/);
    expect(() =>
      assertCanadianTechInternshipCompanyCoverage([
        ...withoutUber,
        {
          site: Site.LINKEDIN,
          companyName: "Uber",
          tier: 3,
          intervalMinutes: 60,
          enabled: true,
        },
      ]),
    ).toThrow(/Uber/);
  });

  it("uses the same normalized exact-name semantics as coverage reports", () => {
    const targets = (canadianTechInternshipsWatch().sourceTargets ?? []).map(
      (target) =>
        target.companyName === "Google"
          ? { ...target, companyName: "Google, Inc." }
          : target,
    );

    expect(() =>
      assertCanadianTechInternshipCompanyCoverage(targets),
    ).not.toThrow();
  });

  it("keeps the Canadian Tech Internships JSON example aligned with the factory", () => {
    const example = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../../../../examples/canadian-tech-internships.watch.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const parsed = new WatchValidationService().parseCreate(example);
    const preset = canadianTechInternshipsWatch();

    expect(parsed).toEqual(preset);
  });
});

describe("WatchPresetService", () => {
  it("hydrates legacy watches with the engineering-family defaults", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(canadianTechInternshipsWatch());

    expect(watch.roleFamilies).toEqual([
      "software-engineering",
      "data-ai",
      "cybersecurity",
      "cloud-platform-infrastructure",
    ]);
  });

  it("lists both Canadian internship presets and rejects the retired ID", () => {
    const service = new WatchPresetService(new InMemoryWatchRepository());

    expect(service.list()).toEqual([
      {
        id: CANADIAN_TECH_INTERNSHIPS_ID,
        version: 1,
        name: CANADIAN_TECH_INTERNSHIPS_NAME,
      },
      {
        id: CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
        version: 1,
        name: CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME,
      },
    ]);
    expect(() => service.get("prestige-internships-v2")).toThrow(
      BadRequestException,
    );
  });

  it("defines the separate disabled 41-company tech-adjacent preset", () => {
    const watch = canadianTechAdjacentInternshipsWatch();
    const targets = watch.sourceTargets ?? [];
    const covered = new Set(
      targets
        .filter((target) => target.enabled && target.companyName)
        .map((target) => target.companyName),
    );

    expect(watch).toEqual(
      expect.objectContaining({
        name: CANADIAN_TECH_ADJACENT_INTERNSHIPS_NAME,
        enabled: false,
        initializationMode: "baseline",
        companies: CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES,
        locations: CANADIAN_TECH_ADJACENT_INTERNSHIP_LOCATIONS,
        roleFamilies: CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES,
      }),
    );
    expect(watch.companies).toHaveLength(41);
    expect(
      CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES.every((company) =>
        covered.has(company),
      ),
    ).toBe(true);
    expect(() =>
      assertCanadianTechAdjacentInternshipCompanyCoverage(targets),
    ).not.toThrow();
    expect(() => new WatchValidationService().parseCreate(watch)).not.toThrow();
    expect(
      targets
        .filter((target) =>
          CANADIAN_TECH_ADJACENT_INTERNSHIP_COMPANIES.slice(21).includes(
            target.companyName as never,
          ),
        )
        .every(
          (target) =>
            target.enabled &&
            target.mode === "board-search" &&
            target.resultsWanted === 25 &&
            target.searchScope?.maxRequestsPerRun === 2,
        ),
    ).toBe(true);
  });

  it("treats companyUrl and planning mode changes as material", async () => {
    const repository = new InMemoryWatchRepository();
    const desired = canadianTechAdjacentInternshipsWatch();
    const initializedAt = new Date("2026-08-12T12:00:00.000Z");
    const currentTargets = (desired.sourceTargets ?? []).map((target) =>
      target.companyName === "RBC"
        ? {
            ...target,
            companyUrl: "https://old.example/rbc",
            mode: "board" as const,
            initializedAt,
          }
        : { ...target, initializedAt: target.enabled ? initializedAt : null },
    );
    const watch = await repository.createWatch({
      ...desired,
      sourceTargets: currentTargets,
      initializedAt,
    });

    const result = await new WatchPresetService(repository).apply(
      CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
      watch.id,
      { apply: true },
    );

    expect(result.targets.materiallyChanged).toEqual([
      "workday:rbc:3:RBCEARLYTALENT1",
    ]);
    expect(result.targetKeysRequiringInitialization).toEqual([
      "workday:rbc:3:RBCEARLYTALENT1",
    ]);
    expect(
      result.watch?.sourceTargets.find(
        (target) => target.companyName === "RBC",
      ),
    ).toEqual(
      expect.objectContaining({
        companyUrl: "https://rbc.wd3.myworkdayjobs.com/RBCEARLYTALENT1",
        mode: "board-search",
        initializedAt: null,
      }),
    );
  });

  it("replaces role-family matching scope with the preset's exact nine families", async () => {
    const repository = new InMemoryWatchRepository();
    const desired = canadianTechAdjacentInternshipsWatch();
    const watch = await repository.createWatch({
      ...desired,
      roleFamilies: [
        "software-engineering",
        "legacy-experimental" as JobWatch["roleFamilies"][number],
      ],
    });
    const service = new WatchPresetService(repository);

    const preview = await service.apply(
      CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
      watch.id,
    );
    const applied = await service.apply(
      CANADIAN_TECH_ADJACENT_INTERNSHIPS_ID,
      watch.id,
      { apply: true },
    );

    expect(preview.fields.roleFamiliesAdded).toEqual(
      CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES.slice(1),
    );
    expect(preview.fields.roleFamiliesRemoved).toEqual(["legacy-experimental"]);
    expect(applied.watch?.roleFamilies).toEqual(
      CANADIAN_TECH_ADJACENT_INTERNSHIP_ROLE_FAMILIES,
    );
  });

  it("replaces legacy Canada/USA geography and reports removals", async () => {
    const repository = new InMemoryWatchRepository();
    const baselineAt = new Date("2026-08-10T12:00:00.000Z");
    const sourceTargets = (
      canadianTechInternshipsWatch().sourceTargets ?? []
    ).map((target) => ({
      ...target,
      searchScope: target.searchScope
        ? {
            ...target.searchScope,
            countryCodes: ["CA", "US"],
            locations: [
              ...target.searchScope.locations,
              "Waterloo, Ontario",
              "United States",
            ],
          }
        : undefined,
      initializedAt: target.enabled ? baselineAt : target.initializedAt,
    }));
    const watch = await repository.createWatch({
      ...canadianTechInternshipsWatch(),
      locations: [
        "Canada",
        "Toronto, Ontario",
        "Waterloo, Ontario",
        "United States",
      ],
      countryCodes: ["CA", "US"],
      sourceTargets,
      excludedTerms: ["operator exclusion", "United States only"],
    });

    const result = await new WatchPresetService(repository).apply(
      CANADIAN_TECH_INTERNSHIPS_ID,
      watch.id,
      { apply: true },
    );

    expect(result.fields.locationsRemoved).toEqual([
      "Canada",
      "Waterloo, Ontario",
      "United States",
    ]);
    expect(result.fields.countryCodesRemoved).toEqual(["US"]);
    expect(result.watch?.locations).toEqual(CANADIAN_TECH_INTERNSHIP_LOCATIONS);
    expect(result.watch?.countryCodes).toEqual(["CA"]);
    expect(result.watch?.excludedTerms).toEqual(
      expect.arrayContaining(["operator exclusion", "United States only"]),
    );
    expect(result.targets.materiallyChanged).toHaveLength(sourceTargets.length);
    expect(result.targetKeysRequiringInitialization).toHaveLength(
      sourceTargets.filter((target) => target.enabled).length,
    );
    expect(
      result.watch?.sourceTargets.every(
        (target) =>
          !target.searchScope ||
          (target.searchScope.countryCodes.join(",") === "CA" &&
            target.searchScope.locations.includes("Toronto, Ontario") &&
            !target.searchScope.locations.includes("United States")),
      ),
    ).toBe(true);
  });

  it("previews without mutation and requires a paused watch to apply", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      ...canadianTechInternshipsWatch(),
      enabled: true,
    });
    const update = jest.spyOn(repository, "updateWatch");
    const service = new WatchPresetService(repository);

    const preview = await service.apply(CANADIAN_TECH_INTERNSHIPS_ID, watch.id);

    expect(preview).toEqual(
      expect.objectContaining({ dryRun: true, applied: false }),
    );
    expect(update).not.toHaveBeenCalled();
    await expect(
      service.apply(CANADIAN_TECH_INTERNSHIPS_ID, watch.id, { apply: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it("adds exactly the five phase 13 targets and requires their initialization", async () => {
    const repository = new InMemoryWatchRepository();
    const baselineAt = new Date("2026-07-21T12:00:00.000Z");
    const phase13Keys = ["uber", "notion", "ramp", "netflix", "ibm"];
    const currentTargets = (canadianTechInternshipsWatch().sourceTargets ?? [])
      .filter((target) => !phase13Keys.includes(watchSourceTargetKey(target)))
      .map((target) => ({
        ...target,
        initializedAt: target.enabled ? baselineAt : target.initializedAt,
      }));
    const watch = await repository.createWatch({
      ...canadianTechInternshipsWatch(),
      initializedAt: baselineAt,
      sourceTargets: currentTargets,
      sources: currentTargets.map((target) => target.site),
      sourceTiers: Object.fromEntries(
        currentTargets.map((target) => [String(target.site), target.tier]),
      ),
    });
    const service = new WatchPresetService(repository);

    const result = await service.apply(CANADIAN_TECH_INTERNSHIPS_ID, watch.id, {
      apply: true,
    });

    expect(result.preset.version).toBe(1);
    expect(result.targets.added).toEqual(phase13Keys);
    expect(result.targets.materiallyChanged).toEqual([]);
    expect(result.targetKeysRequiringInitialization).toEqual(phase13Keys);
  });

  it("treats a resultsWanted change as material target configuration", async () => {
    const repository = new InMemoryWatchRepository();
    const baselineAt = new Date("2026-07-21T12:00:00.000Z");
    const currentTargets = (
      canadianTechInternshipsWatch().sourceTargets ?? []
    ).map((target) => ({
      ...target,
      ...(watchSourceTargetKey(target) === "uber"
        ? { resultsWanted: 100 }
        : {}),
      initializedAt: target.enabled ? baselineAt : target.initializedAt,
    }));
    const watch = await repository.createWatch({
      ...canadianTechInternshipsWatch(),
      initializedAt: baselineAt,
      sourceTargets: currentTargets,
    });

    const result = await new WatchPresetService(repository).apply(
      CANADIAN_TECH_INTERNSHIPS_ID,
      watch.id,
      { apply: true },
    );

    expect(result.targets.materiallyChanged).toEqual(["uber"]);
    expect(result.targetKeysRequiringInitialization).toEqual(["uber"]);
    expect(
      result.watch?.sourceTargets.find(
        (target) => watchSourceTargetKey(target) === "uber",
      ),
    ).toEqual(
      expect.objectContaining({ resultsWanted: 500, initializedAt: null }),
    );
  });

  it("preserves operator state and resets only added/materially changed targets", async () => {
    const repository = new InMemoryWatchRepository();
    const baselineAt = new Date("2026-07-18T12:00:00.000Z");
    const sourceTargets = (canadianTechInternshipsWatch().sourceTargets ?? [])
      .filter((target) => target.site !== Site.CANADAJOBBANK)
      .map((target) => {
        if (!target.enabled) return target;
        return {
          ...target,
          ...(target.companySlug === "plaid" ? { intervalMinutes: 9 } : {}),
          initializedAt: baselineAt,
          lastRunAt: baselineAt,
          nextRunAt: baselineAt,
        };
      });
    sourceTargets.push({
      site: Site.INDEED,
      companyName: "Operator source",
      tier: 3,
      intervalMinutes: 30,
      enabled: true,
      initializedAt: baselineAt,
    });
    const watch = await repository.createWatch({
      ...canadianTechInternshipsWatch(),
      name: "My operator-owned watch",
      enabled: false,
      minimumScore: 73,
      urgentScore: 91,
      digestScore: 37,
      notificationChannels: [
        { type: "discord", destinationRef: "operator-discord" },
      ],
      requiredTerms: ["student", "security clearance"],
      allowedWorkplaceTypes: ["remote", "flexible"],
      allowedEmploymentTypes: ["internship", "research placement"],
      sourceTargets,
    });
    const service = new WatchPresetService(repository);

    const result = await service.apply(CANADIAN_TECH_INTERNSHIPS_ID, watch.id, {
      apply: true,
    });
    const updated = await repository.getWatch(watch.id);

    expect(result).toEqual(
      expect.objectContaining({
        dryRun: false,
        applied: true,
        targetKeysRequiringInitialization: ["ashby:plaid", "canadajobbank"],
        targets: expect.objectContaining({
          added: ["canadajobbank"],
          materiallyChanged: expect.arrayContaining(["ashby:plaid"]),
          operatorOnly: ["indeed"],
        }),
      }),
    );
    expect(updated).toEqual(
      expect.objectContaining({
        name: "My operator-owned watch",
        enabled: false,
        minimumScore: 73,
        urgentScore: 91,
        digestScore: 37,
        notificationChannels: [
          { type: "discord", destinationRef: "operator-discord" },
        ],
        requiredTerms: [
          "security clearance",
          "intern",
          "internship",
          "co-op",
          "coop",
          "summer 2027",
        ],
        allowedWorkplaceTypes: ["remote", "flexible", "hybrid", "on-site"],
        allowedEmploymentTypes: ["internship", "research placement", "co-op"],
      }),
    );
    const updatedByKey = new Map(
      updated?.sourceTargets.map((target) => [
        watchSourceTargetKey(target),
        target,
      ]),
    );
    expect(updatedByKey.get("ashby:wealthsimple")?.initializedAt).toEqual(
      baselineAt,
    );
    expect(updatedByKey.get("ashby:plaid")?.initializedAt).toBeNull();
    expect(updatedByKey.get("canadajobbank")?.initializedAt).toBeNull();
    expect(updatedByKey.get("indeed")?.companyName).toBe("Operator source");
  });

  it("validates explicit initialization keys before source execution", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch(canadianTechInternshipsWatch());

    expect(validateWatchTargetKeys(watch, undefined)).toEqual([]);
    expect(validateWatchTargetKeys(watch, [])).toEqual([]);
    expect(
      validateWatchTargetKeys(watch, ["ashby:wealthsimple", "canadajobbank"]),
    ).toEqual(["ashby:wealthsimple", "canadajobbank"]);
    expect(() =>
      validateWatchTargetKeys(watch, [
        "ashby:wealthsimple",
        "ashby:wealthsimple",
      ]),
    ).toThrow(BadRequestException);
    expect(() => validateWatchTargetKeys(watch, ["missing"])).toThrow(
      BadRequestException,
    );
    expect(() => validateWatchTargetKeys(watch, ["google"])).toThrow(
      BadRequestException,
    );
  });
});
