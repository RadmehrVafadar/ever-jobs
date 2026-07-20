import { readFileSync } from "fs";
import { resolve } from "path";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import {
  prestigeInternshipsV2Watch,
  PRESTIGE_INTERNSHIPS_V2_ID,
  PRESTIGE_INTERNSHIPS_V2_NAME,
} from "../services/prestige-internships-v2.preset";
import {
  validateWatchTargetKeys,
  watchSourceTargetKey,
  WatchPresetService,
} from "../services/watch-preset.service";
import { WatchValidationService } from "../services/watch-validation.service";

describe("prestige-internships-v2 preset", () => {
  it("defines the disabled, uninitialized and evidence-gated target matrix", () => {
    const watch = prestigeInternshipsV2Watch();
    const targets = watch.sourceTargets ?? [];
    const byKey = new Map(
      targets.map((target) => [watchSourceTargetKey(target), target]),
    );

    expect(watch).toEqual(
      expect.objectContaining({
        name: PRESTIGE_INTERNSHIPS_V2_NAME,
        enabled: false,
        intervalMinutes: 3,
        initializationMode: "baseline",
        countryCodes: ["CA", "US"],
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
        intervalMinutes: 3,
        enabled: true,
        searchScope: expect.objectContaining({
          countryCodes: ["CA"],
          maxRequestsPerRun: 12,
        }),
      }),
    );
    expect(byKey.get("canadajobbank")).toEqual(
      expect.objectContaining({ tier: 2, intervalMinutes: 15, enabled: true }),
    );
    expect(byKey.get("google")?.searchScope).toEqual(
      expect.objectContaining({
        countryCodes: ["CA", "US"],
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
    expect(byKey.get("meta")?.enabled).toBe(false);
    expect(byKey.get("wellfound")?.enabled).toBe(false);
  });

  it("keeps the Canada/USA JSON example aligned with the factory", () => {
    const example = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          "../../../../examples/prestige-internships-v2-canada-usa.watch.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const parsed = new WatchValidationService().parseCreate(example);
    const preset = prestigeInternshipsV2Watch();

    expect(parsed).toEqual(preset);
  });
});

describe("WatchPresetService", () => {
  it("previews without mutation and requires a paused watch to apply", async () => {
    const repository = new InMemoryWatchRepository();
    const watch = await repository.createWatch({
      ...prestigeInternshipsV2Watch(),
      enabled: true,
    });
    const update = jest.spyOn(repository, "updateWatch");
    const service = new WatchPresetService(repository);

    const preview = await service.apply(PRESTIGE_INTERNSHIPS_V2_ID, watch.id);

    expect(preview).toEqual(
      expect.objectContaining({ dryRun: true, applied: false }),
    );
    expect(update).not.toHaveBeenCalled();
    await expect(
      service.apply(PRESTIGE_INTERNSHIPS_V2_ID, watch.id, { apply: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it("preserves operator state and resets only added/materially changed targets", async () => {
    const repository = new InMemoryWatchRepository();
    const baselineAt = new Date("2026-07-18T12:00:00.000Z");
    const sourceTargets = (prestigeInternshipsV2Watch().sourceTargets ?? [])
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
      ...prestigeInternshipsV2Watch(),
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

    const result = await service.apply(PRESTIGE_INTERNSHIPS_V2_ID, watch.id, {
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
    const watch = await repository.createWatch(prestigeInternshipsV2Watch());

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
