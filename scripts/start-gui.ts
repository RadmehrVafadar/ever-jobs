import { ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

export type GuiMode = "development" | "production";

interface CommandSpec {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}

interface PrismaArtifactReader {
  exists(path: string): boolean;
  read(path: string): string;
}

interface ServiceEndpoint {
  readonly name: string;
  readonly host: string;
  readonly port: number;
}

export interface GuiRuntimeConfiguration {
  readonly mode: GuiMode;
  readonly workspaceRoot: string;
  readonly webHost: string;
  readonly webPort: number;
  readonly apiHost: string;
  readonly apiPort: number;
  readonly watcherHost: string;
  readonly watcherPort: number;
}

const children = new Map<string, ChildProcess>();
let shuttingDown = false;

export function parseMode(args: readonly string[]): GuiMode {
  const modeArgument = args.find((argument) => argument.startsWith("--mode="));
  const mode = modeArgument?.slice("--mode=".length) ?? "development";
  if (mode !== "development" && mode !== "production") {
    throw new Error(
      `Unsupported GUI mode "${mode}". Use development or production.`,
    );
  }
  return mode;
}

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TCP port: ${value}`);
  }
  return port;
}

export function createRuntimeConfiguration(
  mode: GuiMode,
  environment: NodeJS.ProcessEnv = process.env,
): GuiRuntimeConfiguration {
  return {
    mode,
    workspaceRoot: resolve(__dirname, ".."),
    webHost: environment.WEB_HOST?.trim() || "127.0.0.1",
    webPort: parsePort(environment.WEB_PORT, 3000),
    apiHost: environment.API_HOST?.trim() || "127.0.0.1",
    apiPort: parsePort(environment.PORT, 3001),
    watcherHost: environment.WATCHER_HEALTH_HOST?.trim() || "127.0.0.1",
    watcherPort: parsePort(environment.WATCHER_HEALTH_PORT, 3002),
  };
}

export function serviceCommands(
  configuration: GuiRuntimeConfiguration,
): readonly CommandSpec[] {
  const nx = resolve(
    configuration.workspaceRoot,
    "node_modules",
    "nx",
    "bin",
    "nx.js",
  );
  if (configuration.mode === "development") {
    return [
      {
        name: "api",
        command: process.execPath,
        args: [nx, "run", "api:start:dev"],
      },
      {
        name: "watcher",
        command: process.execPath,
        args: [nx, "run", "watcher:start:dev"],
      },
      {
        name: "web",
        command: process.execPath,
        args: [
          nx,
          "run",
          "web:dev",
          "--",
          "--host",
          configuration.webHost,
          "--port",
          String(configuration.webPort),
          "--strictPort",
        ],
      },
    ];
  }

  return [
    {
      name: "api",
      command: process.execPath,
      args: ["dist/apps/api/main.js"],
    },
    {
      name: "watcher",
      command: process.execPath,
      args: ["dist/apps/watcher/main.js"],
    },
    {
      name: "web",
      command: process.execPath,
      args: [
        nx,
        "run",
        "web:preview",
        "--",
        "--host",
        configuration.webHost,
        "--port",
        String(configuration.webPort),
        "--strictPort",
      ],
    },
  ];
}

/**
 * Prisma's Windows query-engine DLL cannot be replaced while an existing
 * API/worker process has it loaded. Avoid that unnecessary write when the
 * generated client already matches both the schema and installed client
 * version.
 */
export function prismaClientIsCurrent(
  workspaceRoot: string,
  reader: PrismaArtifactReader = {
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
  },
): boolean {
  const schema = resolve(workspaceRoot, "prisma", "schema.prisma");
  const generatedRoot = resolve(
    workspaceRoot,
    "node_modules",
    ".prisma",
    "client",
  );
  const generatedSchema = resolve(generatedRoot, "schema.prisma");
  const generatedEntry = resolve(generatedRoot, "index.js");
  const installedPackage = resolve(
    workspaceRoot,
    "node_modules",
    "@prisma",
    "client",
    "package.json",
  );
  const generatedPackage = resolve(generatedRoot, "package.json");
  const required = [
    schema,
    generatedSchema,
    generatedEntry,
    installedPackage,
    generatedPackage,
  ];
  if (!required.every((path) => reader.exists(path))) return false;

  try {
    const installedVersion = packageVersion(reader.read(installedPackage));
    const generatedVersion = packageVersion(reader.read(generatedPackage));
    return (
      reader.read(schema) === reader.read(generatedSchema) &&
      installedVersion !== null &&
      installedVersion === generatedVersion
    );
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const workspaceRoot = resolve(__dirname, "..");
  loadDotEnv({ path: resolve(workspaceRoot, ".env"), quiet: true });
  const configuration = createRuntimeConfiguration(
    parseMode(process.argv.slice(2)),
  );
  const environment = runtimeEnvironment(configuration);
  const prisma = resolve(
    configuration.workspaceRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const nx = resolve(
    configuration.workspaceRoot,
    "node_modules",
    "nx",
    "bin",
    "nx.js",
  );

  await assertServicePortsAvailable(configuration);

  await runToCompletion(
    {
      name: "database migration",
      command: process.execPath,
      args: [prisma, "migrate", "deploy"],
    },
    configuration.workspaceRoot,
    environment,
  );

  if (prismaClientIsCurrent(configuration.workspaceRoot)) {
    process.stdout.write(
      "[gui] Prisma client matches the schema; skipping generation.\n",
    );
  } else {
    try {
      await runToCompletion(
        {
          name: "Prisma client generation",
          command: process.execPath,
          args: [prisma, "generate"],
        },
        configuration.workspaceRoot,
        environment,
      );
    } catch (error) {
      if (process.platform === "win32") {
        throw new Error(
          "Prisma client generation could not replace its Windows query-engine DLL. " +
            "Stop any existing rad.ar API/watcher/GUI Node processes, then run npm run gui:dev again.",
        );
      }
      throw error;
    }
  }

  if (configuration.mode === "production") {
    await runToCompletion(
      {
        name: "application build",
        command: process.execPath,
        args: [nx, "run-many", "--target=build", "--projects=api,watcher,web"],
      },
      configuration.workspaceRoot,
      environment,
    );
  }

  registerShutdownHandlers();
  const [api, watcher, web] = serviceCommands(configuration);
  if (!api || !watcher || !web) {
    throw new Error("The GUI launcher service configuration is incomplete.");
  }

  const apiProcess = startService(
    api,
    configuration.workspaceRoot,
    environment,
  );
  await waitForService(
    {
      name: "API",
      host: configuration.apiHost,
      port: configuration.apiPort,
    },
    apiProcess,
  );

  const watcherProcess = startService(
    watcher,
    configuration.workspaceRoot,
    environment,
  );
  await waitForService(
    {
      name: "watcher health service",
      host: configuration.watcherHost,
      port: configuration.watcherPort,
    },
    watcherProcess,
  );

  const webProcess = startService(
    web,
    configuration.workspaceRoot,
    environment,
  );
  await waitForService(
    {
      name: "GUI",
      host: configuration.webHost,
      port: configuration.webPort,
    },
    webProcess,
  );

  process.stdout.write(
    `\nrad.ar operator GUI: http://${configuration.webHost}:${configuration.webPort}\n` +
      `API: http://${configuration.apiHost}:${configuration.apiPort}\n` +
      `Watcher health: http://${configuration.watcherHost}:${configuration.watcherPort}/health\n` +
      "Press Ctrl+C to stop the local stack.\n\n",
  );
}

function runtimeEnvironment(
  configuration: GuiRuntimeConfiguration,
): NodeJS.ProcessEnv {
  const operatorUiEnabled =
    process.env.EVER_JOBS_UI_OPERATOR ?? process.env.VITE_UI_OPERATOR ?? "true";
  return {
    ...process.env,
    API_HOST: configuration.apiHost,
    PORT: String(configuration.apiPort),
    WATCHER_HEALTH_HOST: configuration.watcherHost,
    WATCHER_HEALTH_PORT: String(configuration.watcherPort),
    WATCHER_HEALTH_URL:
      process.env.WATCHER_HEALTH_URL ??
      `http://${configuration.watcherHost}:${configuration.watcherPort}/health`,
    WEB_HOST: configuration.webHost,
    WEB_PORT: String(configuration.webPort),
    CORS_ORIGINS:
      process.env.CORS_ORIGINS ??
      `http://${configuration.webHost}:${configuration.webPort}`,
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? "/api",
    VITE_PROXY_TARGET:
      process.env.VITE_PROXY_TARGET ??
      `http://${configuration.apiHost}:${configuration.apiPort}`,
    EVER_JOBS_UI_OPERATOR: operatorUiEnabled,
    VITE_UI_OPERATOR: operatorUiEnabled,
    NX_DAEMON: process.env.NX_DAEMON ?? "false",
    NX_ISOLATE_PLUGINS: process.env.NX_ISOLATE_PLUGINS ?? "false",
    EVER_JOBS_LOCAL_ENV_FILE:
      process.env.EVER_JOBS_LOCAL_ENV_FILE ??
      resolve(configuration.workspaceRoot, ".env.local"),
  };
}

function packageVersion(value: string): string | null {
  const parsed = JSON.parse(value) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : null;
}

async function runToCompletion(
  specification: CommandSpec,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  process.stdout.write(`[gui] Running ${specification.name}...\n`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(specification.command, [...specification.args], {
      cwd,
      env: { ...environment, ...specification.environment },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `${specification.name} failed${signal ? ` (${signal})` : ` with exit code ${code ?? "unknown"}`}`,
          ),
        );
      }
    });
  });
}

function startService(
  specification: CommandSpec,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): ChildProcess {
  const child = spawn(specification.command, [...specification.args], {
    cwd,
    env: { ...environment, ...specification.environment },
    stdio: "inherit",
    windowsHide: true,
  });
  children.set(specification.name, child);
  child.once("error", (error) => {
    process.stderr.write(
      `[gui] Could not start ${specification.name}: ${error.message}\n`,
    );
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(specification.name);
    if (shuttingDown) return;
    process.stderr.write(
      `[gui] ${specification.name} stopped unexpectedly${signal ? ` (${signal})` : ` with exit code ${code ?? "unknown"}`}.\n`,
    );
    void shutdown(code && code > 0 ? code : 1);
  });
  return child;
}

export async function assertServicePortsAvailable(
  configuration: GuiRuntimeConfiguration,
): Promise<void> {
  const endpoints: readonly ServiceEndpoint[] = [
    {
      name: "GUI",
      host: configuration.webHost,
      port: configuration.webPort,
    },
    {
      name: "API",
      host: configuration.apiHost,
      port: configuration.apiPort,
    },
    {
      name: "watcher health service",
      host: configuration.watcherHost,
      port: configuration.watcherPort,
    },
  ];
  const checks = await Promise.all(
    endpoints.map(async (endpoint) => ({
      endpoint,
      available: await portIsAvailable(endpoint.host, endpoint.port),
    })),
  );
  const occupied = checks
    .filter(({ available }) => !available)
    .map(
      ({ endpoint }) => `${endpoint.name} (${endpoint.host}:${endpoint.port})`,
    );
  if (occupied.length > 0) {
    throw new Error(
      `Cannot start because ${occupied.join(", ")} ${occupied.length === 1 ? "is" : "are"} already in use. ` +
        "Stop the previous rad.ar terminal with Ctrl+C, then run npm run gui:dev again.",
    );
  }
}

async function portIsAvailable(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolvePromise(false);
      else reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(true);
      });
    });
  });
}

async function waitForService(
  endpoint: ServiceEndpoint,
  child: ChildProcess,
  timeoutMs = 180_000,
): Promise<void> {
  process.stdout.write(
    `[gui] Waiting for ${endpoint.name} at ${endpoint.host}:${endpoint.port}...\n`,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${endpoint.name} exited before it became ready.`);
    }
    if (await canConnect(endpoint.host, endpoint.port)) {
      process.stdout.write(`[gui] ${endpoint.name} is ready.\n`);
      return;
    }
    await delay(250);
  }
  throw new Error(
    `${endpoint.name} did not become ready at ${endpoint.host}:${endpoint.port} within ${Math.round(timeoutMs / 1_000)} seconds.`,
  );
}

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const socket = createConnection({ host, port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolvePromise(connected);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function registerShutdownHandlers(): void {
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const exits = [...children.values()].map(
    (child) =>
      new Promise<void>((resolvePromise) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolvePromise();
          return;
        }
        child.once("exit", () => resolvePromise());
        if (process.platform === "win32" && child.pid !== undefined) {
          terminateWindowsProcessTree(child.pid).finally(resolvePromise);
          return;
        }
        child.kill("SIGTERM");
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
          resolvePromise();
        }, 5_000).unref();
      }),
  );
  await Promise.allSettled(exits);
  process.exitCode = exitCode;
}

function terminateWindowsProcessTree(pid: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    const fallBackToParent = () => {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") {
          process.stderr.write(
            `[gui] Could not terminate service process ${pid}; close the previous rad.ar terminal if a port remains occupied.\n`,
          );
        }
      }
    };
    const terminator = spawn(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    terminator.once("error", () => {
      fallBackToParent();
      resolvePromise();
    });
    terminator.once("exit", (code) => {
      if (code !== 0) fallBackToParent();
      resolvePromise();
    });
  });
}

if (require.main === module) {
  void run().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[gui] ${message}\n`);
    await shutdown(1);
  });
}
