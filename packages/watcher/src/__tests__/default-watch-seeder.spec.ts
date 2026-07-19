import { ConfigService } from "@nestjs/config";
import { InMemoryWatchRepository } from "../persistence/in-memory-watch.repository";
import { DefaultWatchSeederService } from "../services/default-watch-seeder.service";

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
        enabled: false,
        initializationMode: "baseline",
        intervalMinutes: 3,
      }),
    );

    await repository.updateWatch(created.id, { enabled: true });
    await seeder.onApplicationBootstrap();
    const watches = await repository.listWatches();
    expect(watches).toHaveLength(1);
    expect(watches[0].enabled).toBe(true);
  });
});
