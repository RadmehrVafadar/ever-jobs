import { createServer } from "node:net";
import {
  assertServicePortsAvailable,
  createRuntimeConfiguration,
  parseMode,
  parsePort,
  prismaClientIsCurrent,
  serviceCommands,
} from "../start-gui";

describe("start-gui launcher", () => {
  it("uses loopback and the documented ports by default", () => {
    expect(createRuntimeConfiguration("development", {})).toMatchObject({
      mode: "development",
      webHost: "127.0.0.1",
      webPort: 3000,
      apiHost: "127.0.0.1",
      apiPort: 3001,
      watcherHost: "127.0.0.1",
      watcherPort: 3002,
    });
  });

  it("accepts explicit environment overrides", () => {
    expect(
      createRuntimeConfiguration("production", {
        WEB_HOST: "localhost",
        WEB_PORT: "4100",
        API_HOST: "localhost",
        PORT: "4101",
        WATCHER_HEALTH_HOST: "localhost",
        WATCHER_HEALTH_PORT: "4102",
      }),
    ).toMatchObject({
      mode: "production",
      webHost: "localhost",
      webPort: 4100,
      apiHost: "localhost",
      apiPort: 4101,
      watcherHost: "localhost",
      watcherPort: 4102,
    });
  });

  it("rejects invalid modes and ports", () => {
    expect(() => parseMode(["--mode=staging"])).toThrow("Unsupported GUI mode");
    expect(() => parsePort("0", 3000)).toThrow("Invalid TCP port");
    expect(() => parsePort("65536", 3000)).toThrow("Invalid TCP port");
    expect(() => parsePort("3.5", 3000)).toThrow("Invalid TCP port");
  });

  it("selects watch-mode services for development", () => {
    const commands = serviceCommands(
      createRuntimeConfiguration("development", {}),
    );
    expect(commands.map(({ name }) => name)).toEqual(["api", "watcher", "web"]);
    expect(commands[0]?.args.slice(-2)).toEqual(["run", "api:start:dev"]);
    expect(commands[1]?.args.slice(-2)).toEqual(["run", "watcher:start:dev"]);
    expect(commands[2]?.args).toContain("web:dev");
  });

  it("selects built services and the web preview for production", () => {
    const commands = serviceCommands(
      createRuntimeConfiguration("production", {}),
    );
    expect(commands[0]?.args).toEqual(["dist/apps/api/main.js"]);
    expect(commands[1]?.args).toEqual(["dist/apps/watcher/main.js"]);
    expect(commands[2]?.args).toContain("web:preview");
  });

  it("skips Prisma generation only for matching complete artifacts", () => {
    const workspace = "C:\\workspace";
    const files = new Map<string, string>();
    const path = (...parts: string[]) => [workspace, ...parts].join("\\");
    files.set(path("prisma", "schema.prisma"), "model Job {}");
    files.set(
      path("node_modules", ".prisma", "client", "schema.prisma"),
      "model Job {}",
    );
    files.set(path("node_modules", ".prisma", "client", "index.js"), "");
    files.set(
      path("node_modules", "@prisma", "client", "package.json"),
      JSON.stringify({ version: "6.19.3" }),
    );
    files.set(
      path("node_modules", ".prisma", "client", "package.json"),
      JSON.stringify({ version: "6.19.3" }),
    );
    const reader = {
      exists: (file: string) => files.has(file),
      read: (file: string) => {
        const value = files.get(file);
        if (value === undefined) throw new Error(`missing ${file}`);
        return value;
      },
    };

    expect(prismaClientIsCurrent(workspace, reader)).toBe(true);
    files.set(
      path("node_modules", ".prisma", "client", "schema.prisma"),
      "model Changed {}",
    );
    expect(prismaClientIsCurrent(workspace, reader)).toBe(false);
  });

  it("rejects startup before spawning services when a configured port is occupied", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      throw new Error("Expected a TCP test address.");
    }
    const configuration = createRuntimeConfiguration("development", {
      WEB_PORT: String(address.port),
      PORT: String(address.port),
      WATCHER_HEALTH_PORT: String(address.port),
    });

    try {
      await expect(assertServicePortsAvailable(configuration)).rejects.toThrow(
        `127.0.0.1:${address.port}`,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
