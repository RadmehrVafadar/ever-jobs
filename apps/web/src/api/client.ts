import {
  ApiHealth,
  CompareResponse,
  CoverageReport,
  DestinationSummary,
  JobAnalysis,
  JobWatch,
  NotificationDelivery,
  ObservedJob,
  OperatorOverview,
  Page,
  SearchInput,
  SearchResponse,
  SourceHealth,
  WatchApplyResponse,
  WatchMatch,
  WatchMatchStatus,
  WatchMetrics,
  WatchPresetPreview,
  WatchPresetApplyResponse,
  WatchPresetSummary,
  WatchRun,
} from "../types";
import { CreatableWatch, EditableWatch } from "../lib/watch-draft";
import { getSessionApiKey } from "../lib/session-key";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  authenticated?: boolean;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const key = getSessionApiKey();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (key && options.authenticated !== false) headers.set("x-api-key", key);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new ApiError(
      "The rad.ar API is unreachable. Check that the local stack is running.",
      0,
      error,
    );
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message =
      apiMessage(payload) || `${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, payload);
  }
  return payload as T;
}

async function rootRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const apiUrl = new URL(API_BASE, window.location.href);
  const target = API_BASE.startsWith("http")
    ? new URL(path, `${apiUrl.origin}/`).toString()
    : path;
  let response: Response;
  try {
    response = await fetch(target, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new ApiError("The rad.ar API is unreachable.", 0, error);
  }
  const payload = (await response.json()) as unknown;
  if (!response.ok)
    throw new ApiError(
      apiMessage(payload) || "Health check failed.",
      response.status,
      payload,
    );
  return payload as T;
}

function apiMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload || undefined;
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const field of ["message", "detail", "error"] as const) {
    const value = record[field];
    if (Array.isArray(value)) return value.map(String).join(" ");
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function queryString(values: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export const api = {
  health: (signal?: AbortSignal) => rootRequest<ApiHealth>("/health", signal),
  overview: (signal?: AbortSignal) =>
    request<OperatorOverview>("/operator/overview", { signal }),
  sources: {
    health: (signal?: AbortSignal) =>
      request<{ count: number; sources: SourceHealth[] }>(
        "/sources/health?include=all",
        { signal },
      ),
    openCircuit: (site: string) =>
      request<{ ok: true; site: string; health: SourceHealth }>(
        `/sources/${encodeURIComponent(site)}/circuit/open`,
        {
          method: "POST",
        },
      ),
    resetCircuit: (site: string) =>
      request<{ ok: true; site: string; health: SourceHealth }>(
        `/sources/${encodeURIComponent(site)}/circuit/reset`,
        {
          method: "POST",
        },
      ),
  },
  watches: {
    list: (signal?: AbortSignal) => request<JobWatch[]>("/watches", { signal }),
    get: (id: string, signal?: AbortSignal) =>
      request<JobWatch>(`/watches/${id}`, { signal }),
    create: (body: Partial<CreatableWatch>) =>
      request<JobWatch>("/watches", { method: "POST", body }),
    createDefault: () =>
      request<JobWatch>("/watches/default", { method: "POST" }),
    clone: (watch: CreatableWatch) =>
      request<JobWatch>("/watches", { method: "POST", body: watch }),
    remove: (id: string) =>
      request<void>(`/watches/${id}`, { method: "DELETE" }),
    apply: (
      id: string,
      expectedUpdatedAt: string,
      patch: Partial<EditableWatch>,
    ) =>
      request<WatchApplyResponse>(`/watches/${id}/apply`, {
        method: "POST",
        body: { expectedUpdatedAt, patch },
      }),
    pause: (id: string) =>
      request<JobWatch>(`/watches/${id}/pause`, { method: "POST" }),
    resume: (id: string) =>
      request<JobWatch>(`/watches/${id}/resume`, { method: "POST" }),
    run: (id: string) =>
      request<WatchRun>(`/watches/${id}/run`, { method: "POST" }),
    initialize: (id: string, targetKeys: string[] = []) =>
      request<WatchRun>(`/watches/${id}/initialize`, {
        method: "POST",
        body: { targetKeys },
      }),
    runs: (
      id: string,
      values: Record<string, unknown> = {},
      signal?: AbortSignal,
    ) =>
      request<Page<WatchRun>>(`/watches/${id}/runs${queryString(values)}`, {
        signal,
      }),
    matches: (
      id: string,
      values: Record<string, unknown> = {},
      signal?: AbortSignal,
    ) =>
      request<Page<WatchMatch>>(
        `/watches/${id}/matches${queryString(values)}`,
        { signal },
      ),
    match: (id: string, matchId: string, signal?: AbortSignal) =>
      request<WatchMatch>(`/watches/${id}/matches/${matchId}`, { signal }),
    updateMatchStatus: (
      id: string,
      matchId: string,
      status: WatchMatchStatus,
    ) =>
      request<WatchMatch>(`/watches/${id}/matches/${matchId}/status`, {
        method: "PATCH",
        body: { status },
      }),
    metrics: (id: string, signal?: AbortSignal) =>
      request<WatchMetrics>(`/watches/${id}/metrics`, { signal }),
    coverage: (id: string, signal?: AbortSignal) =>
      request<CoverageReport>(`/watches/${id}/coverage`, { signal }),
  },
  presets: {
    list: (signal?: AbortSignal) =>
      request<WatchPresetSummary[]>("/watches/presets", { signal }),
    preview: (presetId: string, watchId: string, signal?: AbortSignal) =>
      request<WatchPresetPreview>(
        `/watches/${watchId}/presets/${encodeURIComponent(presetId)}/preview`,
        {
          method: "POST",
          signal,
        },
      ),
    apply: (presetId: string, watchId: string) =>
      request<WatchPresetApplyResponse>(
        `/watches/${watchId}/presets/${encodeURIComponent(presetId)}/apply`,
        {
          method: "POST",
        },
      ),
  },
  destinations: {
    list: (signal?: AbortSignal) =>
      request<DestinationSummary[]>("/notification-destinations", { signal }),
    upsert: (alias: string, webhookUrl: string) =>
      request<DestinationSummary>(
        `/notification-destinations/${encodeURIComponent(alias)}`,
        {
          method: "PUT",
          body: { webhookUrl },
        },
      ),
    remove: (alias: string) =>
      request<void>(`/notification-destinations/${encodeURIComponent(alias)}`, {
        method: "DELETE",
      }),
    test: (alias: string, watchId: string) =>
      request<{
        ok: boolean;
        result?: { status: string; errorMessage?: string };
      }>(`/notification-destinations/${encodeURIComponent(alias)}/test`, {
        method: "POST",
        body: { watchId },
      }),
  },
  notifications: {
    deliveries: (values: Record<string, unknown> = {}, signal?: AbortSignal) =>
      request<Page<NotificationDelivery>>(
        `/notifications/deliveries${queryString(values)}`,
        { signal },
      ),
  },
  observedJobs: {
    list: (values: Record<string, unknown> = {}, signal?: AbortSignal) =>
      request<Page<ObservedJob>>(`/observed-jobs${queryString(values)}`, {
        signal,
      }),
    get: (id: string, signal?: AbortSignal) =>
      request<ObservedJob>(`/observed-jobs/${id}`, { signal }),
  },
  jobs: {
    search: (
      body: SearchInput,
      options: {
        dedup?: boolean;
        liveness?: boolean;
        legitimacy?: boolean;
      } = {},
    ) =>
      request<SearchResponse>(
        `/jobs/search${queryString({
          dedup: options.dedup ?? true,
          liveness: options.liveness,
          legitimacy: options.legitimacy,
        })}`,
        { method: "POST", body, authenticated: false },
      ),
    analyze: (body: SearchInput) =>
      request<JobAnalysis>("/jobs/analyze", {
        method: "POST",
        body,
        authenticated: false,
      }),
    compare: (body: SearchInput & { concurrency?: number }) =>
      request<CompareResponse>("/jobs/compare", {
        method: "POST",
        body,
        authenticated: false,
      }),
  },
};

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError && [401, 403, 503].includes(error.status);
}
