import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WatchSourceTarget } from "../types";
import { SourceTargetsEditor } from "./source-targets-editor";

function Editor({ initial }: { initial: WatchSourceTarget[] }) {
  const [targets, setTargets] = useState(initial);
  return (
    <>
      <SourceTargetsEditor
        targets={targets}
        sourceHealth={[]}
        defaultIntervalMinutes={20}
        defaultCountryCodes={["CA", "US"]}
        defaultLocations={["Toronto", "Remote"]}
        onChange={setTargets}
      />
      <output data-testid="targets-state">{JSON.stringify(targets)}</output>
    </>
  );
}

describe("SourceTargetsEditor watch defaults", () => {
  it("shows inherited cadence and supports a custom interval reset", async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initial={[
          { site: "google", companyName: "Google", tier: 2, enabled: true },
        ]}
      />,
    );

    expect(screen.getByText("Every 20 min (default)")).toBeInTheDocument();
    await user.click(screen.getByText("Google"));
    const interval = screen.getByLabelText(/^Run interval/);
    await user.type(interval, "45");
    expect(screen.getByTestId("targets-state")).toHaveTextContent(
      '"intervalMinutes":45',
    );

    await user.click(screen.getByRole("button", { name: "Use watch default" }));
    expect(screen.getByTestId("targets-state")).not.toHaveTextContent(
      "intervalMinutes",
    );
  });

  it("creates and removes a country-only override independently", async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initial={[
          { site: "google", companyName: "Google", tier: 2, enabled: true },
        ]}
      />,
    );
    await user.click(screen.getByText("Google"));

    await user.click(screen.getByRole("button", { name: "Remove US" }));
    expect(screen.getByTestId("targets-state")).toHaveTextContent(
      '"countryCodes":["CA"]',
    );
    expect(screen.getByTestId("targets-state")).not.toHaveTextContent(
      "locations",
    );

    await user.click(
      screen.getByRole("button", { name: "Use watch country codes" }),
    );
    expect(screen.getByTestId("targets-state")).not.toHaveTextContent(
      "searchScope",
    );
  });

  it("bulk-restores shared defaults without dropping target-only settings", async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initial={[
          {
            site: "google",
            companyName: "Google",
            tier: 2,
            intervalMinutes: 60,
            enabled: true,
            searchScope: {
              countryCodes: ["CA"],
              locations: ["Toronto"],
              strictLocations: true,
              searchTerms: ["software intern"],
              maxRequestsPerRun: 2,
            },
          },
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Use defaults for all" }),
    );
    const state = screen.getByTestId("targets-state");
    expect(state).not.toHaveTextContent("intervalMinutes");
    expect(state).not.toHaveTextContent("countryCodes");
    expect(state).not.toHaveTextContent("locations");
    expect(state).toHaveTextContent('"searchTerms":["software intern"]');
    expect(state).toHaveTextContent('"maxRequestsPerRun":2');
  });
});
