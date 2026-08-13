import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  INotificationSecretStore,
  NotificationSecretStatus,
} from "@ever-jobs/plugin";
import { parse as parseDotEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

const DEFAULT_DESTINATION_REF = "default";
const DEFAULT_ENVIRONMENT_VARIABLE = "DISCORD_WEBHOOK_URL";
const CUSTOM_ENVIRONMENT_PREFIX = "DISCORD_WEBHOOK_";
const LOCAL_ENV_FILE_VARIABLE = "EVER_JOBS_LOCAL_ENV_FILE";
const DESTINATION_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESTINATION_REF_LENGTH = 64;
const DISCORD_HOSTS = new Set([
  "discord.com",
  "canary.discord.com",
  "ptb.discord.com",
]);
const DISCORD_WEBHOOK_PATH =
  /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/;

export interface LocalNotificationSecretStoreOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  filePath?: string;
  /** Writable root for the local secret file. Defaults to the process cwd. */
  allowedRoot?: string;
}

export const LOCAL_NOTIFICATION_SECRET_OPTIONS = Symbol(
  "LOCAL_NOTIFICATION_SECRET_OPTIONS",
);

@Injectable()
export class LocalNotificationSecretStore implements INotificationSecretStore {
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly filePath: string;
  private cachedMtimeMs: number | null = null;
  private cachedValues: Readonly<Record<string, string>> = {};

  constructor(
    @Optional()
    @Inject(LOCAL_NOTIFICATION_SECRET_OPTIONS)
    options: LocalNotificationSecretStoreOptions = {},
  ) {
    this.environment = options.environment ?? process.env;
    const allowedRoot = resolve(options.allowedRoot ?? process.cwd());
    const filePath = resolve(
      options.filePath ??
        this.environment[LOCAL_ENV_FILE_VARIABLE] ??
        ".env.local",
    );
    const pathWithinRoot = relative(allowedRoot, filePath);
    if (
      basename(filePath) !== ".env.local" ||
      pathWithinRoot === ".." ||
      pathWithinRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathWithinRoot)
    ) {
      throw new Error(
        "Local notification secrets must use a .env.local file inside the configured application root",
      );
    }
    this.filePath = filePath;
  }

  async resolve(destinationRef: string): Promise<string | undefined> {
    const environmentVariable =
      discordDestinationEnvironmentVariable(destinationRef);
    const environmentValue = this.environment[environmentVariable]?.trim();
    if (environmentValue) return normalizeDiscordWebhookUrl(environmentValue);
    const values = await this.localValues();
    const localValue = values[environmentVariable]?.trim();
    return localValue ? normalizeDiscordWebhookUrl(localValue) : undefined;
  }

  async list(
    destinationRefs: readonly string[] = [],
  ): Promise<NotificationSecretStatus[]> {
    const values = await this.localValues();
    const discoveredRefs = new Set<string>([DEFAULT_DESTINATION_REF]);
    for (const ref of destinationRefs) {
      if (isDiscordDestinationRef(ref)) discoveredRefs.add(ref);
    }
    for (const key of [
      ...Object.keys(this.environment),
      ...Object.keys(values),
    ]) {
      const ref = destinationRefFromEnvironmentVariable(key);
      if (ref) discoveredRefs.add(ref);
    }

    return [...discoveredRefs]
      .sort((left, right) =>
        left === DEFAULT_DESTINATION_REF
          ? -1
          : right === DEFAULT_DESTINATION_REF
            ? 1
            : left.localeCompare(right),
      )
      .map((destinationRef) => {
        const environmentVariable =
          discordDestinationEnvironmentVariable(destinationRef);
        const environmentConfigured = Boolean(
          this.environment[environmentVariable]?.trim(),
        );
        const localConfigured = Boolean(values[environmentVariable]?.trim());
        return {
          destinationRef,
          environmentVariable,
          configured: environmentConfigured || localConfigured,
          ...(environmentConfigured
            ? { source: "environment" as const }
            : localConfigured
              ? { source: "local" as const }
              : {}),
          readOnly: environmentConfigured,
        };
      });
  }

  async set(
    destinationRef: string,
    secret: string,
  ): Promise<NotificationSecretStatus> {
    const environmentVariable =
      discordDestinationEnvironmentVariable(destinationRef);
    if (this.environment[environmentVariable]?.trim()) {
      throw new Error(
        `Destination is managed by the process environment: ${destinationRef}`,
      );
    }
    const normalized = normalizeDiscordWebhookUrl(secret);
    const content = await this.readFileText();
    const updated = setEnvironmentLine(
      content,
      environmentVariable,
      normalized,
    );
    await this.atomicWrite(updated);
    this.invalidate();
    return {
      destinationRef,
      environmentVariable,
      configured: true,
      source: "local",
      readOnly: false,
    };
  }

  async remove(destinationRef: string): Promise<boolean> {
    const environmentVariable =
      discordDestinationEnvironmentVariable(destinationRef);
    if (this.environment[environmentVariable]?.trim()) {
      throw new Error(
        `Destination is managed by the process environment: ${destinationRef}`,
      );
    }
    const content = await this.readFileText();
    const updated = removeEnvironmentLine(content, environmentVariable);
    if (updated === content) return false;
    await this.atomicWrite(updated);
    this.invalidate();
    return true;
  }

  private async localValues(): Promise<Readonly<Record<string, string>>> {
    const mtimeMs = await this.mtimeMs();
    if (this.cachedMtimeMs === mtimeMs) return this.cachedValues;
    const content = await this.readFileText();
    this.cachedValues = parseDotEnv(content);
    this.cachedMtimeMs = mtimeMs;
    return this.cachedValues;
  }

  private async mtimeMs(): Promise<number> {
    try {
      return (await fs.stat(this.filePath)).mtimeMs;
    } catch (error: unknown) {
      if (isMissingFile(error)) return -1;
      throw error;
    }
  }

  private async readFileText(): Promise<string> {
    try {
      return await fs.readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return "";
      throw error;
    }
  }

  private async atomicWrite(content: string): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      await fs.writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private invalidate(): void {
    this.cachedMtimeMs = null;
    this.cachedValues = {};
  }
}

export function isDiscordDestinationRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_DESTINATION_REF_LENGTH &&
    DESTINATION_REF_PATTERN.test(value)
  );
}

export function discordDestinationEnvironmentVariable(
  destinationRef: string,
): string {
  // Compatibility with the original public test/CLI contract.
  if (destinationRef === DEFAULT_ENVIRONMENT_VARIABLE) {
    return DEFAULT_ENVIRONMENT_VARIABLE;
  }
  if (!isDiscordDestinationRef(destinationRef)) {
    throw new Error(
      "Destination reference must be a lowercase slug of at most 64 characters",
    );
  }
  return destinationRef === DEFAULT_DESTINATION_REF
    ? DEFAULT_ENVIRONMENT_VARIABLE
    : `${CUSTOM_ENVIRONMENT_PREFIX}${destinationRef.replace(/-/g, "_").toUpperCase()}`;
}

export function normalizeDiscordWebhookUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !DISCORD_HOSTS.has(url.hostname) ||
      !DISCORD_WEBHOOK_PATH.test(url.pathname) ||
      url.username !== "" ||
      url.password !== "" ||
      (url.port !== "" && url.port !== "443") ||
      url.hash !== ""
    ) {
      throw new Error("invalid");
    }
    url.search = "";
    return url.toString();
  } catch {
    throw new Error("Discord webhook URL is invalid");
  }
}

function destinationRefFromEnvironmentVariable(
  environmentVariable: string,
): string | undefined {
  if (environmentVariable === DEFAULT_ENVIRONMENT_VARIABLE) {
    return DEFAULT_DESTINATION_REF;
  }
  if (!environmentVariable.startsWith(CUSTOM_ENVIRONMENT_PREFIX)) {
    return undefined;
  }
  const ref = environmentVariable
    .slice(CUSTOM_ENVIRONMENT_PREFIX.length)
    .toLowerCase()
    .replace(/_/g, "-");
  return isDiscordDestinationRef(ref) ? ref : undefined;
}

function setEnvironmentLine(
  content: string,
  key: string,
  value: string,
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));
  const nextLine = `${key}=${value}`;
  if (index >= 0) lines[index] = nextLine;
  else {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(nextLine);
  }
  return `${lines.join(newline).replace(new RegExp(`${escapeRegExp(newline)}+$`), "")}${newline}`;
}

function removeEnvironmentLine(content: string, key: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => !pattern.test(line));
  if (filtered.length === lines.length) return content;
  return filtered
    .join(newline)
    .replace(
      new RegExp(`${escapeRegExp(newline)}{3,}`, "g"),
      `${newline}${newline}`,
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}
