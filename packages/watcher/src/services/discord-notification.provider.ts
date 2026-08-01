import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHttpClient, HttpClient } from "@ever-jobs/common";
import {
  JobNotificationMessage,
  NotificationDestination,
  NotificationProvider,
  NotificationResult,
} from "../interfaces/watch.types";

export const DISCORD_WEBHOOK_ENV_VAR = "DISCORD_WEBHOOK_URL";
export const DISCORD_DEFAULT_DESTINATION_REF = "default";
export const DISCORD_NOTIFICATION_OPTIONS = Symbol(
  "DISCORD_NOTIFICATION_OPTIONS",
);

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_CONTENT_LENGTH = 2_000;
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_DESCRIPTION_LENGTH = 4_096;
const MAX_FIELD_NAME_LENGTH = 256;
const MAX_FIELD_VALUE_LENGTH = 1_024;
const MAX_EMBED_TOTAL_LENGTH = 6_000;
const MAX_EMBED_FIELDS = 25;

export type DiscordFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface DiscordNotificationProviderOptions {
  env?: Readonly<Record<string, string | undefined>>;
  /** Test seam only. Production uses the mandatory @ever-jobs/common client. */
  fetch?: DiscordFetch;
  httpClient?: Pick<HttpClient, "post">;
  timeoutMs?: number;
}

export type DiscordDeliveryCategory =
  | "success"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "network_error"
  | "timeout"
  | "configuration_error";

export interface DiscordDeliveryClassification {
  category: DiscordDeliveryCategory;
  retryable: boolean;
  retryAfterMs?: number;
}

export interface DiscordProviderResponse extends DiscordDeliveryClassification {
  status?: number;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookPayload {
  username: string;
  content: string;
  allowed_mentions: { parse: string[] };
  embeds: Array<{
    title: string;
    url?: string;
    color: number;
    description: string;
    fields: DiscordEmbedField[];
    timestamp: string;
    footer: { text: string };
  }>;
}

/**
 * Escapes Discord markdown and neutralizes visible @mentions. The webhook also
 * disables all allowed mentions, providing a second layer of protection.
 */
export function escapeDiscordMarkdown(value: unknown): string {
  return sanitizeDiscordText(value)
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~|>\[\]])/g, "\\$1")
    .replace(/@/g, "@\u200b");
}

/** Truncates by UTF-16 code unit without leaving a dangling surrogate pair. */
export function truncateDiscordText(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength === 1) return "…";

  let truncated = value.slice(0, maxLength - 1);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  // Avoid ending on an escape character, which would alter subsequent Discord
  // markdown if the value is later combined with more text.
  if (truncated.endsWith("\\")) truncated = truncated.slice(0, -1);
  return `${truncated}…`;
}

/** Discord returns retry_after in seconds, including fractional seconds. */
export function discordRetryAfterMs(value: unknown): number | undefined {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.ceil(seconds * 1_000);
}

export function classifyDiscordHttpResponse(
  status: number,
  retryAfter?: unknown,
): DiscordDeliveryClassification {
  if (status >= 200 && status < 300) {
    return { category: "success", retryable: false };
  }
  if (status === 429) {
    const retryAfterMs = discordRetryAfterMs(retryAfter);
    return {
      category: "rate_limited",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  if (status >= 500 && status <= 599) {
    return { category: "server_error", retryable: true };
  }
  return { category: "client_error", retryable: false };
}

export function classifyDiscordTransportError(
  error: unknown,
): DiscordDeliveryClassification {
  return isAbortError(error)
    ? { category: "timeout", retryable: true }
    : { category: "network_error", retryable: true };
}

export function buildDiscordWebhookPayload(
  message: JobNotificationMessage,
): DiscordWebhookPayload {
  const score = normalizeScore(message.match.score);
  const urgency = urgencyPresentation(message.type);
  const company = displayValue(message.job.company, "Unknown company", 100);
  const title = displayValue(message.job.title, "Untitled job", 130);
  const applicationUrl = safeExternalUrl(message.job.applicationUrl);
  const detailsUrl = safeExternalUrl(message.job.jobUrl);
  const targetUrl = applicationUrl ?? detailsUrl;
  const detectedAt = validDate(message.detectedAt) ?? new Date();
  const sourcePublishedAt = validDate(message.job.sourcePublishedAt);
  const firstSeenAt = validDate(message.job.firstSeenAt);
  const latencyStart = sourcePublishedAt ?? firstSeenAt;
  const reasons = uniqueReasons(message).slice(0, 6);
  const reasonDescription =
    reasons.length > 0
      ? `**Top matches**\n${reasons.map((reason) => `• ${displayValue(reason, "Match", 220)}`).join("\n")}`
      : "**Top matches**\n• Match met the configured score threshold";

  const fields: DiscordEmbedField[] = [
    field("Location", message.job.location, false, "Not provided", 400),
    field("Workplace", message.job.workplaceType, true, "Not provided", 100),
    field("Employment", message.job.employmentType, true, "Not provided", 100),
    field("Source", message.job.source, true, "Unknown", 200),
    field(
      "Published (UTC)",
      sourcePublishedAt?.toISOString(),
      true,
      "Not provided by source",
      100,
    ),
    field("Detected (UTC)", detectedAt.toISOString(), true, "Unknown", 100),
    field(
      "Detection delay",
      latencyStart
        ? `${formatDuration(Math.max(0, detectedAt.getTime() - latencyStart.getTime()))}${sourcePublishedAt ? "" : " (from first seen)"}`
        : undefined,
      true,
      "Unavailable",
      100,
    ),
  ];

  if (applicationUrl) {
    fields.push(linkField("Apply", applicationUrl));
  }
  if (detailsUrl && detailsUrl !== applicationUrl) {
    fields.push(linkField("Job details", detailsUrl));
  }
  fields.push(field("Watch", message.watch.name, false, "Unnamed watch", 300));

  const embed = {
    title: truncateDiscordText(
      `${score}/100 — ${company} — ${title}`,
      MAX_EMBED_TITLE_LENGTH,
    ),
    ...(targetUrl ? { url: targetUrl } : {}),
    color: urgency.color,
    description: truncateDiscordText(
      reasonDescription,
      MAX_EMBED_DESCRIPTION_LENGTH,
    ),
    fields: fields.slice(0, MAX_EMBED_FIELDS),
    timestamp: detectedAt.toISOString(),
    footer: { text: "rad.ar watcher" },
  };

  enforceEmbedCombinedLimit(embed);

  return {
    username: "rad.ar",
    content: truncateDiscordText(
      `${urgency.icon} **${urgency.label} — ${score}/100 MATCH**`,
      MAX_CONTENT_LENGTH,
    ),
    allowed_mentions: { parse: [] },
    embeds: [embed],
  };
}

@Injectable()
export class DiscordNotificationProvider implements NotificationProvider {
  readonly type = "discord";

  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly fetchImpl?: DiscordFetch;
  private readonly httpClient: Pick<HttpClient, "post">;
  private readonly timeoutMs: number;

  constructor(
    @Optional()
    @Inject(DISCORD_NOTIFICATION_OPTIONS)
    options: DiscordNotificationProviderOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.fetchImpl = options.fetch;
    this.httpClient =
      options.httpClient ??
      createHttpClient({
        timeout: Math.max(1, Math.ceil(this.timeoutMs / 1_000)),
        retries: 0,
      });
  }

  async send(
    message: JobNotificationMessage,
    destination: NotificationDestination,
  ): Promise<NotificationResult> {
    const resolved = resolveDiscordWebhook(destination, this.env);
    if ("errorMessage" in resolved) {
      return {
        status: "failed",
        errorMessage: resolved.errorMessage,
        providerResponse: {
          category: "configuration_error",
          retryable: false,
        } satisfies DiscordProviderResponse,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const payload = buildDiscordWebhookPayload(message);
      const response = this.fetchImpl
        ? await sendWithFetch(
            this.fetchImpl,
            resolved.url,
            payload,
            controller.signal,
          )
        : await sendWithSharedHttpClient(
            this.httpClient,
            resolved.url,
            payload,
            controller.signal,
          );

      const retryAfter = response.retryAfter;
      const classification = classifyDiscordHttpResponse(
        response.status,
        retryAfter,
      );
      const providerResponse: DiscordProviderResponse = {
        status: response.status,
        ...classification,
      };

      if (response.status >= 200 && response.status < 300) {
        return { status: "sent", providerResponse };
      }

      return {
        status: "failed",
        errorMessage: `Discord webhook request failed (HTTP ${response.status})`,
        providerResponse,
      };
    } catch (error: unknown) {
      const classification = classifyDiscordTransportError(error);
      return {
        status: "failed",
        errorMessage:
          classification.category === "timeout"
            ? "Discord webhook request timed out"
            : "Discord webhook network request failed",
        providerResponse: classification satisfies DiscordProviderResponse,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function sanitizeDiscordText(value: unknown): string {
  const stringValue = String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  let result = "";
  for (let index = 0; index < stringValue.length; index += 1) {
    const codeUnit = stringValue.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = stringValue.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        result += stringValue[index] + stringValue[index + 1];
        index += 1;
      } else {
        result += "�";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      result += "�";
    } else {
      result += stringValue[index];
    }
  }
  return result;
}

function displayValue(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  const escaped = escapeDiscordMarkdown(value);
  return truncateDiscordText(escaped || fallback, maxLength);
}

function field(
  name: string,
  value: unknown,
  inline: boolean,
  fallback: string,
  maxValueLength = MAX_FIELD_VALUE_LENGTH,
): DiscordEmbedField {
  return {
    name: truncateDiscordText(
      escapeDiscordMarkdown(name),
      MAX_FIELD_NAME_LENGTH,
    ),
    value: displayValue(
      value,
      fallback,
      Math.min(maxValueLength, MAX_FIELD_VALUE_LENGTH),
    ),
    inline,
  };
}

function linkField(name: string, url: string): DiscordEmbedField {
  return {
    name: truncateDiscordText(
      escapeDiscordMarkdown(name),
      MAX_FIELD_NAME_LENGTH,
    ),
    // safeExternalUrl has already rejected non-HTTP(S), credentialed, and
    // overlong URLs. Angle brackets suppress noisy automatic Discord embeds.
    value: `<${url}>`,
    inline: false,
  };
}

function uniqueReasons(message: JobNotificationMessage): string[] {
  const candidates = [
    ...(message.match.scoreBreakdown.reasons ?? []),
    ...(message.match.scoreBreakdown.matchedKeywords ?? []),
    ...(message.match.matchedTerms ?? []),
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const normalized = sanitizeDiscordText(candidate);
    const key = normalized.toLocaleLowerCase("en-CA");
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    const serialized = url.toString();
    // The URL is also rendered in a field value, whose hard Discord limit is
    // 1,024 characters including the surrounding angle brackets.
    return serialized.length <= MAX_FIELD_VALUE_LENGTH - 2
      ? serialized
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveDiscordWebhook(
  destination: NotificationDestination,
  env: Readonly<Record<string, string | undefined>>,
): { url: string } | { errorMessage: string } {
  const destinationRef = destination.destinationRef;
  if (
    destinationRef !== DISCORD_DEFAULT_DESTINATION_REF &&
    destinationRef !== DISCORD_WEBHOOK_ENV_VAR
  ) {
    return {
      errorMessage:
        "Discord destinationRef must be default or DISCORD_WEBHOOK_URL",
    };
  }

  const configuredValue = env[DISCORD_WEBHOOK_ENV_VAR];
  if (!configuredValue) {
    return {
      errorMessage: "Discord webhook environment variable is not configured",
    };
  }

  try {
    const url = new URL(configuredValue);
    const validHostname =
      url.hostname === "discord.com" ||
      url.hostname === "canary.discord.com" ||
      url.hostname === "ptb.discord.com";
    const validPath =
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(
        url.pathname,
      );
    if (
      url.protocol !== "https:" ||
      !validHostname ||
      !validPath ||
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      url.hash !== ""
    ) {
      return { errorMessage: "Discord webhook configuration is invalid" };
    }

    // Discard arbitrary query parameters from the secret and explicitly request
    // a Discord message response so a successful delivery is confirmed.
    url.search = "";
    url.searchParams.set("wait", "true");
    return { url: url.toString() };
  } catch {
    return { errorMessage: "Discord webhook configuration is invalid" };
  }
}

interface DiscordTransportResponse {
  status: number;
  retryAfter?: unknown;
}

async function sendWithFetch(
  fetchImpl: DiscordFetch,
  url: string,
  payload: DiscordWebhookPayload,
  signal: AbortSignal,
): Promise<DiscordTransportResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "EverJobs-Watcher/0.1",
    },
    body: JSON.stringify(payload),
    redirect: "error",
    signal,
  });
  return {
    status: response.status,
    retryAfter:
      response.status === 429
        ? await readDiscordRetryAfter(response)
        : undefined,
  };
}

async function sendWithSharedHttpClient(
  httpClient: Pick<HttpClient, "post">,
  url: string,
  payload: DiscordWebhookPayload,
  signal: AbortSignal,
): Promise<DiscordTransportResponse> {
  const response = await httpClient.post<{ retry_after?: unknown }>(
    url,
    payload,
    {
      headers: {
        "content-type": "application/json",
        "user-agent": "EverJobs-Watcher/0.1",
      },
      signal,
      maxBodyLength: 64 * 1024,
      maxRedirects: 0,
      validateStatus: () => true,
    },
  );
  const headers = response.headers as Record<string, unknown>;
  return {
    status: response.status,
    retryAfter:
      response.status === 429
        ? (response.data?.retry_after ??
          headers["retry-after"] ??
          headers["x-ratelimit-reset-after"])
        : undefined,
  };
}

async function readDiscordRetryAfter(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { retry_after?: unknown };
    if (body && typeof body === "object" && body.retry_after !== undefined) {
      return body.retry_after;
    }
  } catch {
    // Fall through to standard Discord/HTTP rate-limit headers.
  }
  return (
    response.headers.get("retry-after") ??
    response.headers.get("x-ratelimit-reset-after") ??
    undefined
  );
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.ceil(value), 60_000);
}

function normalizeScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function urgencyPresentation(type: JobNotificationMessage["type"]): {
  icon: string;
  label: string;
  color: number;
} {
  if (type === "urgent") {
    return { icon: "🚨", label: "URGENT INTERNSHIP", color: 0xed4245 };
  }
  if (type === "digest") {
    return { icon: "📋", label: "INTERNSHIP DIGEST", color: 0xfee75c };
  }
  return { icon: "🔔", label: "NEW INTERNSHIP", color: 0x57f287 };
}

function validDate(value: Date | null | undefined): Date | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime()))
    return undefined;
  return value;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 60_000) return `${Math.floor(durationMs / 1_000)} seconds`;
  if (durationMs < 3_600_000) {
    return `${Math.floor(durationMs / 60_000)} minutes`;
  }
  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.floor((durationMs % 3_600_000) / 60_000);
  return minutes === 0 ? `${hours} hours` : `${hours}h ${minutes}m`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function enforceEmbedCombinedLimit(embed: {
  title: string;
  description: string;
  fields: DiscordEmbedField[];
  footer: { text: string };
}): void {
  const size = () =>
    embed.title.length +
    embed.description.length +
    embed.footer.text.length +
    embed.fields.reduce(
      (total, current) => total + current.name.length + current.value.length,
      0,
    );

  if (size() <= MAX_EMBED_TOTAL_LENGTH) return;
  let excess = size() - MAX_EMBED_TOTAL_LENGTH;
  const originalDescriptionLength = embed.description.length;
  embed.description = truncateDiscordText(
    embed.description,
    Math.max(1, originalDescriptionLength - excess),
  );
  excess -= originalDescriptionLength - embed.description.length;

  // This is normally unnecessary because buildDiscordWebhookPayload applies
  // conservative per-field caps. Keep the final guard defensive so future
  // fields cannot accidentally breach Discord's aggregate 6,000-char limit.
  for (
    let index = embed.fields.length - 1;
    index >= 0 && excess > 0;
    index -= 1
  ) {
    const originalLength = embed.fields[index].value.length;
    embed.fields[index].value = truncateDiscordText(
      embed.fields[index].value,
      Math.max(1, originalLength - excess),
    );
    excess -= originalLength - embed.fields[index].value.length;
  }
}
