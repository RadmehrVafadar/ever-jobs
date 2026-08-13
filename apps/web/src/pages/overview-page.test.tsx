import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/auth-context";
import { OverviewPage } from "./overview-page";

describe("OverviewPage", () => {
  it("reports the API as unavailable when the public health check fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("connection refused"),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <OverviewPage />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const serviceHealth = screen.getByRole("region", {
      name: "Service health",
    });
    expect(
      await within(serviceHealth).findByText("unavailable", undefined, {
        timeout: 3_000,
      }),
    ).toBeInTheDocument();
    expect(within(serviceHealth).queryByText("healthy")).not.toBeInTheDocument();
  });
});
