import { type UiPluginManifest } from "@ever-jobs/plugin/ui-plugin";

const DISABLED_VALUES = new Set(["0", "false", "off"]);

/** Shared, browser-safe feature switch used by both the Vite host and Nest plugin. */
export function isOperatorUiEnabled(configured?: string): boolean {
  const value = configured?.trim().toLowerCase();
  return value === undefined || !DISABLED_VALUES.has(value);
}

/** Browser-safe operator surface manifest; this module has no NestJS runtime imports. */
export const OPERATOR_UI_MANIFEST: UiPluginManifest = Object.freeze({
  id: "operator",
  name: "rad.ar operator",
  description: "Local control surface for watches, jobs, and notifications.",
  mountPath: "/",
  navigation: Object.freeze([
    { id: "overview", label: "Overview", path: "/" },
    { id: "watches", label: "Watches", path: "/watches" },
    { id: "notifications", label: "Notifications", path: "/notifications" },
    { id: "matches", label: "Matches & jobs", path: "/matches" },
    { id: "search", label: "Search & analyze", path: "/search" },
    { id: "compare", label: "Compare sources", path: "/compare" },
    { id: "settings", label: "Settings", path: "/settings" },
  ]),
});
