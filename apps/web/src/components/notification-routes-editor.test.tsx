import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DestinationSummary, NotificationRoute } from "../types";
import { NotificationRoutesEditor } from "./notification-routes-editor";

describe("NotificationRoutesEditor", () => {
  it("creates a catch-all route from the empty state", async () => {
    const user = userEvent.setup();
    render(<RouteHarness initialRoutes={[]} />);

    expect(screen.getByText("No conditional routes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add route" }));

    expect(screen.getByLabelText("Route name")).toHaveValue("New route");
    expect(screen.getByLabelText("Destination")).toBeInstanceOf(
      HTMLSelectElement,
    );
    expect(screen.getByLabelText("Destination")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("Destination"), "tier-one");
    expect(readRoutes()[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "discord",
        destinationRef: "tier-one",
        conditions: {},
      }),
    );
  });

  it("filters destinations by provider and clears incompatible selections", async () => {
    const user = userEvent.setup();
    render(
      <RouteHarness
        initialRoutes={[makeRoute()]}
        destinations={[
          configuredDestination("tier-one", "discord"),
          configuredDestination("generic", "webhook"),
        ]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("Provider"), "webhook");

    expect(readRoutes()[0]).toEqual(
      expect.objectContaining({ provider: "webhook", destinationRef: "" }),
    );
    expect(
      screen.queryByRole("option", { name: "tier-one" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "generic" })).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Destination"), "generic");
    expect(readRoutes()[0].destinationRef).toBe("generic");
  });

  it("shows missing and unconfigured aliases as unavailable", () => {
    render(
      <RouteHarness
        initialRoutes={[makeRoute({ destinationRef: "removed-alias" })]}
        destinations={[
          configuredDestination("tier-one", "discord"),
          {
            ...configuredDestination("default", "discord"),
            configured: false,
            source: "unconfigured",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Destination")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByRole("option", { name: "removed-alias (unavailable)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "default (not configured)" }),
    ).toBeDisabled();
    expect(screen.getByRole("option", { name: "tier-one" })).toBeEnabled();
    expect(
      screen.getByText(
        "removed-alias is unavailable. Choose a configured destination.",
      ),
    ).toBeInTheDocument();
  });

  it("builds tier, urgency, and inclusive score conditions", async () => {
    const user = userEvent.setup();
    render(<RouteHarness initialRoutes={[makeRoute()]} />);

    await user.click(screen.getByRole("checkbox", { name: "Tier 1" }));
    await user.click(screen.getByRole("checkbox", { name: "urgent" }));
    await user.clear(screen.getByLabelText("Minimum score"));
    await user.type(screen.getByLabelText("Minimum score"), "80");
    await user.clear(screen.getByLabelText("Maximum score"));
    await user.type(screen.getByLabelText("Maximum score"), "100");

    expect(readRoutes()[0].conditions).toEqual({
      sourceTiers: [1],
      notificationTypes: ["urgent"],
      minimumScore: 80,
      maximumScore: 100,
    });
  });

  it("removes empty array conditions when the last option is unchecked", async () => {
    const user = userEvent.setup();
    render(
      <RouteHarness
        initialRoutes={[makeRoute({ conditions: { sourceTiers: [1] } })]}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Tier 1" }));

    expect(readRoutes()[0].conditions).toEqual({});
  });

  it("requires confirmation before removing a route", async () => {
    const user = userEvent.setup();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<RouteHarness initialRoutes={[makeRoute()]} />);

    const remove = screen.getByRole("button", {
      name: "Remove route Tier 1 alerts",
    });
    await user.click(remove);
    expect(readRoutes()).toHaveLength(1);

    await user.click(remove);
    expect(readRoutes()).toHaveLength(0);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

function RouteHarness({
  initialRoutes,
  destinations = [configuredDestination("tier-one", "discord")],
}: {
  initialRoutes: NotificationRoute[];
  destinations?: DestinationSummary[];
}) {
  const [routes, setRoutes] = useState(initialRoutes);
  return (
    <>
      <NotificationRoutesEditor
        routes={routes}
        destinations={destinations}
        onChange={setRoutes}
      />
      <output data-testid="routes-state">{JSON.stringify(routes)}</output>
    </>
  );
}

function configuredDestination(
  alias: string,
  provider: DestinationSummary["provider"],
): DestinationSummary {
  return {
    alias,
    provider,
    source: "local",
    configured: true,
  };
}

function readRoutes(): NotificationRoute[] {
  return JSON.parse(
    screen.getByTestId("routes-state").textContent ?? "[]",
  ) as NotificationRoute[];
}

function makeRoute(patch: Partial<NotificationRoute> = {}): NotificationRoute {
  return {
    id: "tier-one",
    name: "Tier 1 alerts",
    enabled: true,
    provider: "discord",
    destinationRef: "tier-one",
    conditions: {},
    ...patch,
  };
}
