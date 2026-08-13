import { Navigate, Route, Routes } from "react-router-dom";
import { type ReactNode } from "react";
import {
  isOperatorUiEnabled,
  OPERATOR_UI_MANIFEST,
} from "@ever-jobs/ui-operator/manifest";
import { AppShell } from "./components/app-shell";
import { ComparePage } from "./pages/compare-page";
import { MatchesPage } from "./pages/matches-page";
import { NotificationsPage } from "./pages/notifications-page";
import { OverviewPage } from "./pages/overview-page";
import { SearchPage } from "./pages/search-page";
import { SettingsPage } from "./pages/settings-page";
import { WatchEditorPage } from "./pages/watch-editor-page";
import { WatchesPage } from "./pages/watches-page";

export function App() {
  if (!isOperatorUiEnabled(import.meta.env.VITE_UI_OPERATOR)) {
    return <OperatorUiDisabled />;
  }

  const routeElements: Record<string, ReactNode> = {
    overview: <OverviewPage />,
    watches: <WatchesPage />,
    notifications: <NotificationsPage />,
    matches: <MatchesPage />,
    search: <SearchPage />,
    compare: <ComparePage />,
    settings: <SettingsPage />,
  };
  return (
    <Routes>
      <Route element={<AppShell />}>
        {OPERATOR_UI_MANIFEST.navigation.map((item) =>
          item.path === "/" ? (
            <Route index element={routeElements[item.id]} key={item.id} />
          ) : (
            <Route
              path={item.path.slice(1)}
              element={routeElements[item.id]}
              key={item.id}
            />
          ),
        )}
        <Route path="watches/:watchId" element={<WatchEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function OperatorUiDisabled() {
  return (
    <main className="feature-disabled">
      <div className="brand__mark" aria-hidden="true" />
      <p className="eyebrow">Local operator</p>
      <h1>Operator GUI is disabled</h1>
      <p>
        Set <code>VITE_UI_OPERATOR=true</code> and restart the local stack to
        enable this surface. The API, watcher, CLI, and MCP remain available.
      </p>
    </main>
  );
}
