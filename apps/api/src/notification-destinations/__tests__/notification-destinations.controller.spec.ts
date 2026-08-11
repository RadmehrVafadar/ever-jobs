import { NotificationDestinationsController } from "../notification-destinations.controller";

describe("NotificationDestinationsController", () => {
  const watch = {
    id: "watch-1",
    notificationChannels: [{ type: "discord", destinationRef: "default" }],
    notificationRoutes: [
      {
        id: "route-1",
        name: "Tier one",
        enabled: true,
        provider: "discord",
        destinationRef: "tier-one",
      },
    ],
  };

  it("lists only alias, provider, source, and configured status", async () => {
    const repository = { listWatches: jest.fn().mockResolvedValue([watch]) };
    const secrets = {
      list: jest.fn().mockResolvedValue([
        {
          destinationRef: "default",
          environmentVariable: "DISCORD_WEBHOOK_URL",
          configured: true,
          source: "environment",
          readOnly: true,
        },
        {
          destinationRef: "tier-one",
          environmentVariable: "DISCORD_WEBHOOK_TIER_ONE",
          configured: true,
          source: "local",
          readOnly: false,
        },
      ]),
    };
    const controller = new NotificationDestinationsController(
      repository as never,
      secrets as never,
      {} as never,
    );

    const result = await controller.list();

    expect(result).toEqual([
      {
        alias: "default",
        provider: "discord",
        configured: true,
        source: "environment",
      },
      {
        alias: "tier-one",
        provider: "discord",
        configured: true,
        source: "local",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("https://");
    expect(JSON.stringify(result)).not.toContain("DISCORD_WEBHOOK");
  });

  it("rejects removal while any watch references the destination", async () => {
    const controller = new NotificationDestinationsController(
      { listWatches: jest.fn().mockResolvedValue([watch]) } as never,
      { remove: jest.fn() } as never,
      {} as never,
    );

    await expect(controller.remove("tier-one")).rejects.toThrow(
      /referenced by a watch/,
    );
  });
});
