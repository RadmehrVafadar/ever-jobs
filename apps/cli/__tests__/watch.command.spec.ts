import { JobWatch, WatchRepository } from "@ever-jobs/watcher";
import { WatchCommand } from "../src/commands/watch.command";

describe("WatchCommand", () => {
  let repository: jest.Mocked<WatchRepository>;
  let execution: { runWatch: jest.Mock };
  let command: WatchCommand;
  let stdout: jest.SpyInstance;

  beforeEach(() => {
    repository = {
      getWatch: jest.fn(),
      listWatches: jest.fn(),
      createWatch: jest.fn(),
      updateWatch: jest.fn(),
      deleteWatch: jest.fn(),
      listRuns: jest.fn(),
      listMatches: jest.fn(),
      getMatch: jest.fn(),
      updateMatch: jest.fn(),
      listObservedJobs: jest.fn(),
      listNotifications: jest.fn(),
    } as unknown as jest.Mocked<WatchRepository>;
    execution = { runWatch: jest.fn().mockResolvedValue({ id: "run-1" }) };
    command = new WatchCommand(repository, execution as never);
    stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
  });

  it("baselines an uninitialized manual run", async () => {
    repository.getWatch.mockResolvedValue(
      watchFixture({ initializedAt: null }),
    );

    await command.run(["run", "watch-1"], { json: true });

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "baseline");
    expect(execution.runWatch).not.toHaveBeenCalledWith(
      "watch-1",
      "notify-all",
    );
  });

  it("uses recent-only for an initialized manual run", async () => {
    repository.getWatch.mockResolvedValue(
      watchFixture({ initializedAt: new Date("2026-07-14T12:00:00Z") }),
    );

    await command.run(["run", "watch-1"], { json: true });

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "recent-only");
  });

  it("always baselines the initialize action", async () => {
    repository.getWatch.mockResolvedValue(watchFixture());

    await command.run(["initialize", "watch-1"], { json: true });

    expect(execution.runWatch).toHaveBeenCalledWith("watch-1", "baseline");
  });

  it("updates only an allowed match workflow status", async () => {
    repository.getMatch.mockResolvedValue({
      id: "match-1",
      status: "new",
    } as never);
    repository.updateMatch.mockResolvedValue({
      id: "match-1",
      status: "reviewed",
    } as never);

    await command.run(["match-status", "match-1", "reviewed"], { json: true });

    expect(repository.updateMatch).toHaveBeenCalledWith("match-1", {
      status: "reviewed",
    });
    await expect(
      command.run(["match-status", "match-1", "invalid"], { json: true }),
    ).rejects.toThrow("Invalid match status");
  });
});

function watchFixture(patch: Partial<JobWatch> = {}): JobWatch {
  const now = new Date("2026-07-14T12:00:00Z");
  return {
    id: "watch-1",
    name: "Internships",
    enabled: false,
    intervalMinutes: 3,
    timezone: "America/Toronto",
    sources: [],
    sourceTiers: {},
    sourceTargets: [],
    companySlugs: [],
    companies: [],
    searchTerms: ["software intern"],
    requiredTerms: [],
    preferredTerms: [],
    excludedTerms: [],
    locations: ["Toronto"],
    countryCodes: ["CA"],
    allowedWorkplaceTypes: ["remote", "hybrid", "on-site"],
    allowedEmploymentTypes: ["internship"],
    minimumScore: 60,
    urgentScore: 80,
    digestScore: 40,
    notificationChannels: [{ type: "discord", destinationRef: "default" }],
    initializationMode: "baseline",
    initializedAt: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
