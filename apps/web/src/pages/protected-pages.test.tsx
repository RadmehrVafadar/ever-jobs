import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/auth-context";
import { NotificationsPage } from "./notifications-page";
import { WatchEditorPage } from "./watch-editor-page";

describe("protected operator pages", () => {
  it("does not request watch data when a deep link has no session API key", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    renderPage(
      "/watches/watch-1",
      <Routes>
        <Route path="/watches/:watchId" element={<WatchEditorPage />} />
      </Routes>,
    );

    expect(
      await screen.findByRole("heading", { name: "Unlock this watch profile" }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not request destinations, routes, or deliveries without a key", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");

    renderPage("/notifications", <NotificationsPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Unlock notification operations",
      }),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function renderPage(path: string, page: ReactNode): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{page}</AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
