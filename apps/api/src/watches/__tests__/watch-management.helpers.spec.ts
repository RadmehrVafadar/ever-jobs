import { JobWatch } from "@ever-jobs/watcher";
import { publicWatch } from "../watch-management.helpers";

describe("publicWatch", () => {
  it("masks secret-bearing destination references from legacy rows", () => {
    const watch = {
      notificationChannels: [
        {
          type: "discord",
          destinationRef:
            "https://discord.com/api/webhooks/123/legacy-secret",
          destination:
            "https://discord.com/api/webhooks/123/deprecated-secret",
          secretRef:
            "https://discord.com/api/webhooks/123/secret-ref-token",
        },
      ],
      notificationRoutes: [
        {
          id: "legacy",
          name: "Legacy",
          enabled: true,
          provider: "discord",
          destinationRef:
            "https://discord.com/api/webhooks/456/legacy-secret",
          webhookUrl:
            "https://discord.com/api/webhooks/456/unexpected-secret",
        },
      ],
    } as unknown as JobWatch;

    const result = publicWatch(watch);

    expect(result).toMatchObject({
      notificationChannels: [
        { type: "discord", destinationRef: "[redacted-destination]" },
      ],
      notificationRoutes: [
        expect.objectContaining({
          destinationRef: "[redacted-destination]",
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("legacy-secret");
    expect(JSON.stringify(result)).not.toContain("deprecated-secret");
    expect(JSON.stringify(result)).not.toContain("secret-ref-token");
    expect(JSON.stringify(result)).not.toContain("unexpected-secret");
  });
});
