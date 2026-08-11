import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discordDestinationEnvironmentVariable,
  LocalNotificationSecretStore,
  normalizeDiscordWebhookUrl,
} from "../src/local-notification-secret.store";

describe("LocalNotificationSecretStore", () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "rad-ar-secrets-"));
    filePath = join(directory, ".env.local");
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("maps stable destination references to environment variables", () => {
    expect(discordDestinationEnvironmentVariable("default")).toBe(
      "DISCORD_WEBHOOK_URL",
    );
    expect(discordDestinationEnvironmentVariable("DISCORD_WEBHOOK_URL")).toBe(
      "DISCORD_WEBHOOK_URL",
    );
    expect(discordDestinationEnvironmentVariable("tier-one")).toBe(
      "DISCORD_WEBHOOK_TIER_ONE",
    );
    expect(() => discordDestinationEnvironmentVariable("Tier One")).toThrow(
      /lowercase slug/,
    );
  });

  it("validates and strips arbitrary Discord webhook query parameters", () => {
    expect(
      normalizeDiscordWebhookUrl(
        "https://discord.com/api/webhooks/123/token?unexpected=true",
      ),
    ).toBe("https://discord.com/api/webhooks/123/token");
    expect(() =>
      normalizeDiscordWebhookUrl("https://example.com/api/webhooks/123/token"),
    ).toThrow("Discord webhook URL is invalid");
  });

  it("writes, reloads, masks, and removes a local destination", async () => {
    const store = new LocalNotificationSecretStore({
      filePath,
      allowedRoot: directory,
      environment: {},
    });
    await store.set(
      "tier-one",
      "https://discord.com/api/webhooks/123/secret-token",
    );

    await expect(store.resolve("tier-one")).resolves.toBe(
      "https://discord.com/api/webhooks/123/secret-token",
    );
    await expect(store.list(["tier-one"])).resolves.toContainEqual({
      destinationRef: "tier-one",
      environmentVariable: "DISCORD_WEBHOOK_TIER_ONE",
      configured: true,
      source: "local",
      readOnly: false,
    });
    expect(JSON.stringify(await store.list(["tier-one"]))).not.toContain(
      "secret-token",
    );

    await expect(store.remove("tier-one")).resolves.toBe(true);
    await expect(store.resolve("tier-one")).resolves.toBeUndefined();
  });

  it("gives environment secrets precedence and makes them read-only", async () => {
    await fs.writeFile(
      filePath,
      "DISCORD_WEBHOOK_TIER_ONE=https://discord.com/api/webhooks/1/local\n",
    );
    const store = new LocalNotificationSecretStore({
      filePath,
      allowedRoot: directory,
      environment: {
        DISCORD_WEBHOOK_TIER_ONE:
          "https://discord.com/api/webhooks/2/environment",
      },
    });

    await expect(store.resolve("tier-one")).resolves.toBe(
      "https://discord.com/api/webhooks/2/environment",
    );
    await expect(
      store.set("tier-one", "https://discord.com/api/webhooks/3/new"),
    ).rejects.toThrow(/managed by the process environment/);
    await expect(store.remove("tier-one")).rejects.toThrow(
      /managed by the process environment/,
    );
  });

  it("rejects secret files outside the configured root or with another name", () => {
    expect(
      () =>
        new LocalNotificationSecretStore({
          filePath: join(directory, "..", ".env.local"),
          allowedRoot: directory,
          environment: {},
        }),
    ).toThrow(/inside the configured application root/);

    expect(
      () =>
        new LocalNotificationSecretStore({
          filePath: join(directory, ".env"),
          allowedRoot: directory,
          environment: {},
        }),
    ).toThrow(/\.env\.local/);
  });
});
