import {
  buildDiscordWebhookPayload,
  classifyDiscordHttpResponse,
  DiscordFetch,
  DiscordNotificationProvider,
  escapeDiscordMarkdown,
  truncateDiscordText,
} from "../services/discord-notification.provider";
import {
  JobNotificationMessage,
  NotificationDestination,
} from "../interfaces/watch.types";

const WEBHOOK_URL =
  "https://discord.com/api/webhooks/123456789/test_webhook_token";

type DiscordDestination = NotificationDestination & {
  destinationRef?: string;
};

describe("DiscordNotificationProvider", () => {
  it("resolves only the referenced environment webhook and sends a Discord embed", async () => {
    const fetchMock = jest.fn<
      ReturnType<DiscordFetch>,
      Parameters<DiscordFetch>
    >(
      async () =>
        new Response(JSON.stringify({ id: "discord-message-id" }), {
          status: 200,
        }),
    );
    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
      fetch: fetchMock,
      timeoutMs: 1_000,
    });

    const result = await provider.send(
      notificationMessage(),
      discordDestination("https://attacker.example/ignored"),
    );

    expect(result).toEqual({
      status: "sent",
      providerResponse: {
        status: 200,
        category: "success",
        retryable: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe(`${WEBHOOK_URL}?wait=true`);
    expect(requestUrl).not.toContain("attacker.example");
    expect(requestInit).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        "user-agent": "EverJobs-Watcher/0.1",
      },
    });

    const payload = JSON.parse(String(requestInit?.body));
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toContain("URGENT INTERNSHIP");
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toContain("@\u200beveryone");
    expect(payload.embeds[0].title).toContain("\\*Acme\\*");
    expect(payload.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Apply",
          value: "<https://jobs.example/apply>",
        }),
        expect.objectContaining({
          name: "Detection delay",
          value: "2 minutes",
        }),
      ]),
    );
  });

  it("does not accept a raw webhook URL stored in the destination", async () => {
    const fetchMock = jest.fn<
      ReturnType<DiscordFetch>,
      Parameters<DiscordFetch>
    >();
    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
      fetch: fetchMock,
    });

    const result = await provider.send(notificationMessage(), {
      type: "discord",
      destination: WEBHOOK_URL,
    });

    expect(result).toEqual({
      status: "failed",
      errorMessage:
        "Discord destinationRef must be default or DISCORD_WEBHOOK_URL",
      providerResponse: {
        category: "configuration_error",
        retryable: false,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid environment URLs without exposing the configured value", async () => {
    const configuredSecret =
      "https://internal.example/api/webhooks/123456789/very_secret_token";
    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: configuredSecret },
      fetch: jest.fn(),
    });

    const result = await provider.send(
      notificationMessage(),
      discordDestination("ignored"),
    );

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBe(
      "Discord webhook configuration is invalid",
    );
    expect(JSON.stringify(result)).not.toContain(configuredSecret);
    expect(JSON.stringify(result)).not.toContain("very_secret_token");
  });

  it("classifies Discord 429 responses using retry_after seconds", async () => {
    const fetchMock: DiscordFetch = async () =>
      new Response(
        JSON.stringify({
          message: "rate limited",
          retry_after: 1.25,
          secret: "must-not-be-persisted",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
      fetch: fetchMock,
    });

    const result = await provider.send(
      notificationMessage(),
      discordDestination("ignored"),
    );

    expect(result.status).toBe("failed");
    expect(result.providerResponse).toEqual({
      status: 429,
      category: "rate_limited",
      retryable: true,
      retryAfterMs: 1_250,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-persisted");
  });

  it("classifies 5xx responses as retryable and other 4xx responses as permanent", async () => {
    expect(classifyDiscordHttpResponse(503)).toEqual({
      category: "server_error",
      retryable: true,
    });
    expect(classifyDiscordHttpResponse(401)).toEqual({
      category: "client_error",
      retryable: false,
    });

    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
      fetch: async () => new Response(null, { status: 503 }),
    });
    const result = await provider.send(
      notificationMessage(),
      discordDestination("ignored"),
    );
    expect(result.providerResponse).toEqual({
      status: 503,
      category: "server_error",
      retryable: true,
    });
  });

  it("classifies network errors as retryable without returning fetch error details", async () => {
    const leakedSecret = "network_failure_including_test_webhook_token";
    const provider = new DiscordNotificationProvider({
      env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
      fetch: async () => {
        throw new TypeError(leakedSecret);
      },
    });

    const result = await provider.send(
      notificationMessage(),
      discordDestination("ignored"),
    );

    expect(result).toEqual({
      status: "failed",
      errorMessage: "Discord webhook network request failed",
      providerResponse: {
        category: "network_error",
        retryable: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(leakedSecret);
  });

  it("aborts a hanging webhook request at the configured timeout", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock: DiscordFetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(Object.assign(new Error("abort"), { name: "AbortError" }));
            },
            { once: true },
          );
        });
      const provider = new DiscordNotificationProvider({
        env: { DISCORD_WEBHOOK_URL: WEBHOOK_URL },
        fetch: fetchMock,
        timeoutMs: 25,
      });

      const delivery = provider.send(
        notificationMessage(),
        discordDestination("ignored"),
      );
      await jest.advanceTimersByTimeAsync(25);

      await expect(delivery).resolves.toEqual({
        status: "failed",
        errorMessage: "Discord webhook request timed out",
        providerResponse: {
          category: "timeout",
          retryable: true,
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Discord payload safety", () => {
  it("escapes markdown and mentions and stays within every Discord embed limit", () => {
    const message = notificationMessage();
    message.job.location = `${"_*@everyone[]".repeat(400)}\ud800`;
    message.watch.name = "*".repeat(2_000);
    message.match.scoreBreakdown.reasons = Array.from(
      { length: 50 },
      (_, index) => `*reason ${index}* ${"x".repeat(500)}`,
    );

    const payload = buildDiscordWebhookPayload(message);
    const embed = payload.embeds[0];
    const combinedEmbedLength =
      embed.title.length +
      embed.description.length +
      embed.footer.text.length +
      embed.fields.reduce(
        (total, field) => total + field.name.length + field.value.length,
        0,
      );

    expect(escapeDiscordMarkdown("@everyone *bold* [link]")).toBe(
      "@\u200beveryone \\*bold\\* \\[link\\]",
    );
    expect(payload.content.length).toBeLessThanOrEqual(2_000);
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.description.length).toBeLessThanOrEqual(4_096);
    expect(embed.fields.length).toBeGreaterThan(0);
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    expect(combinedEmbedLength).toBeLessThanOrEqual(6_000);
    for (const field of embed.fields) {
      expect(field.name.length).toBeLessThanOrEqual(256);
      expect(field.value.length).toBeGreaterThan(0);
      expect(field.value.length).toBeLessThanOrEqual(1_024);
    }
    expect(JSON.stringify(payload)).not.toContain("@everyone");
    expect(JSON.stringify(payload)).not.toContain("\ud800");
  });

  it("does not split surrogate pairs while truncating", () => {
    const truncated = truncateDiscordText("ab😀cd", 4);
    expect(truncated).toBe("ab…");
    expect(truncated.length).toBeLessThanOrEqual(4);
  });
});

function discordDestination(destination: string): DiscordDestination {
  return {
    type: "discord",
    destination,
    destinationRef: "default",
  };
}

function notificationMessage(): JobNotificationMessage {
  const publishedAt = new Date("2026-07-14T13:31:00.000Z");
  const detectedAt = new Date("2026-07-14T13:33:00.000Z");
  return {
    idempotencyKey: "watch-1:job-1:urgent:discord:default",
    type: "urgent",
    detectedAt,
    watch: {
      id: "watch-1",
      name: "Toronto internship alerts",
    },
    job: {
      id: "job-1",
      company: "@everyone *Acme*",
      title: "Software _Engineering_ Intern",
      location: "Toronto, Ontario, Canada",
      workplaceType: "Hybrid",
      employmentType: "Internship",
      source: "Google Careers",
      applicationUrl: "https://jobs.example/apply",
      jobUrl: "https://jobs.example/details",
      sourcePublishedAt: publishedAt,
      firstSeenAt: detectedAt,
    },
    match: {
      id: "match-1",
      score: 94,
      matchedTerms: ["software engineering internship", "Toronto"],
      scoreBreakdown: {
        reasons: ["Software engineering internship", "Toronto", "Python"],
        matchedKeywords: ["distributed systems"],
      },
    },
  } as unknown as JobNotificationMessage;
}
