import { ConfigService } from "@nestjs/config";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { DefaultWatchSeederService } from "../services/default-watch-seeder.service";
import { CANADIAN_TECH_INTERNSHIPS_NAME } from "../services/canadian-tech-internships.preset";
import { watchSourceTargetKey } from "../services/watch-preset.service";

describe("DefaultWatchSeederService", () => {
  it("creates one disabled baseline watch and never overwrites it", async () => {
    const repository = new InMemoryWatchRepository();
    const config = {
      get: jest.fn().mockReturnValue(true),
    } as unknown as ConfigService;
    const seeder = new DefaultWatchSeederService(repository, config);

    await seeder.onApplicationBootstrap();
    const [created] = await repository.listWatches();
    expect(created).toEqual(
      expect.objectContaining({
        name: CANADIAN_TECH_INTERNSHIPS_NAME,
        countryCodes: ["CA"],
        enabled: false,
        initializationMode: "baseline",
        intervalMinutes: 10,
      }),
    );
    expect(
      created.sourceTargets
        .filter((target) => target.enabled)
        .map(watchSourceTargetKey),
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
    expect(
      created.sourceTargets.every((target) => target.initializedAt === null),
    ).toBe(true);

    await repository.updateWatch(created.id, { enabled: true });
    await seeder.onApplicationBootstrap();
    const watches = await repository.listWatches();
    expect(watches).toHaveLength(1);
    expect(watches[0].enabled).toBe(true);
  });

  it("does not add a default beside an existing legacy or custom watch", async () => {
    const repository = new InMemoryWatchRepository();
    await repository.createWatch({ name: "Operator watch", enabled: true });
    const config = {
      get: jest.fn().mockReturnValue(true),
    } as unknown as ConfigService;

    await new DefaultWatchSeederService(
      repository,
      config,
    ).onApplicationBootstrap();

    const watches = await repository.listWatches();
    expect(watches).toHaveLength(1);
    expect(watches[0].name).toBe("Operator watch");
  });
});
