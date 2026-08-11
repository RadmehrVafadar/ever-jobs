import {
  createRuntimeConfiguration,
  parseMode,
  parsePort,
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
});
