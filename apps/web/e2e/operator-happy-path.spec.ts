import { expect, test } from "@playwright/test";

const UPDATED_AT = "2026-08-04T12:00:00.000Z";

test("an authenticated operator reviews and atomically applies a watch edit", async ({
  page,
}) => {
  const watch = makeWatch();
  let applyRequest:
    | { headers: Record<string, string>; body: unknown }
    | undefined;

  await page.addInitScript(() => {
    window.sessionStorage.setItem("radar.operator.api-key", "e2e-admin-key");
  });
  await page.route("**/health", async (route) => {
    await route.fulfill({
      json: {
        status: "healthy",
        uptime: 120,
        version: "e2e",
        environment: "test",
        timestamp: "2026-08-04T12:00:00.000Z",
      },
    });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (
      url.pathname === "/api/watches/watch-1/apply" &&
      request.method() === "POST"
    ) {
      applyRequest = {
        headers: request.headers(),
        body: request.postDataJSON() as unknown,
      };
      const updated = {
        ...watch,
        name: "Tiered internship radar",
        updatedAt: "2026-08-04T12:05:00.000Z",
      };
      await route.fulfill({
        json: {
          watch: updated,
          diff: [
            {
              field: "name",
              classification: "metadata",
              before: watch.name,
              after: updated.name,
            },
          ],
          systemChanges: [],
          changed: true,
          behaviorChanged: false,
          paused: true,
          pausedByApply: false,
          resumeRequired: false,
          targetKeysRequiringInitialization: [],
        },
      });
      return;
    }
    if (url.pathname === "/api/watches/watch-1") {
      await route.fulfill({ json: watch });
      return;
    }
    if (url.pathname === "/api/sources/health") {
      await route.fulfill({
        json: {
          count: 1,
          sources: [
            {
              site: "greenhouse",
              state: "closed",
              successRate: 1,
              p95LatencyMs: 42,
              windowMs: 60_000,
            },
          ],
        },
      });
      return;
    }
    if (
      url.pathname === "/api/notification-destinations" ||
      url.pathname === "/api/watches/presets"
    ) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { message: `No E2E fixture for ${url.pathname}` },
    });
  });

  await page.goto("/watches/watch-1");
  await expect(
    page.getByRole("heading", { name: "Internship watch" }),
  ).toBeVisible();
  await expect(page.getByText("Operator unlocked")).toBeVisible();

  await page.getByLabel("Watch name").fill("Tiered internship radar");
  await page.getByRole("button", { name: /Review changes/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Review changes" }),
  ).toContainText("Safe live update");
  await page.getByRole("button", { name: "Apply 1 changes" }).click();

  await expect(
    page.getByText(
      "Changes are live. This update did not require a new baseline.",
    ),
  ).toBeVisible();
  expect(applyRequest).toBeDefined();
  expect(applyRequest?.headers["x-api-key"]).toBe("e2e-admin-key");
  expect(applyRequest?.body).toEqual({
    expectedUpdatedAt: UPDATED_AT,
    patch: { name: "Tiered internship radar" },
  });
});

function makeWatch() {
  return {
    id: "watch-1",
    name: "Internship watch",
    enabled: false,
    description: "A route-mocked operator E2E fixture",
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
        enabled: true,
        initializedAt: "2026-08-04T11:00:00.000Z",
      },
    ],
    targetHealth: {},
    companySlugs: [],
    companies: [],
    searchTerms: ["software engineer intern"],
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
    initializedAt: "2026-08-04T11:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: UPDATED_AT,
  };
}
