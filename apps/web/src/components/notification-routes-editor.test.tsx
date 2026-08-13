import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationRoute } from "../types";
import { NotificationRoutesEditor } from "./notification-routes-editor";

describe("NotificationRoutesEditor", () => {
  it("creates a catch-all route from the empty state", async () => {
    const user = userEvent.setup();
    render(<RouteHarness initialRoutes={[]} />);

    expect(screen.getByText("No conditional routes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add route" }));

    expect(screen.getByLabelText("Route name")).toHaveValue("New route");
    expect(screen.getByLabelText("Destination")).toHaveValue("default");
    expect(readRoutes()[0]).toEqual(
      expect.objectContaining({
        enabled: true,
        provider: "discord",
        destinationRef: "default",
        conditions: {},
      }),
    );
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
}: {
  initialRoutes: NotificationRoute[];
}) {
  const [routes, setRoutes] = useState(initialRoutes);
  return (
    <>
      <NotificationRoutesEditor
        routes={routes}
        destinations={[
          {
            alias: "tier-one",
            provider: "discord",
            source: "local",
            configured: true,
          },
        ]}
        onChange={setRoutes}
      />
      <output data-testid="routes-state">{JSON.stringify(routes)}</output>
    </>
  );
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
