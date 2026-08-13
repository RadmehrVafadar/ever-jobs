import { isOperatorUiEnabled, OperatorUiPlugin } from "../src";

describe("OperatorUiPlugin", () => {
  it("publishes stable operator navigation", () => {
    const plugin = new OperatorUiPlugin();

    expect(plugin.manifest.id).toBe("operator");
    expect(plugin.manifest.navigation.map(({ id }) => id)).toEqual([
      "overview",
      "watches",
      "notifications",
      "matches",
      "search",
      "compare",
      "settings",
    ]);
  });

  it("is enabled by default and honors the compatibility switch", () => {
    const plugin = new OperatorUiPlugin();

    expect(plugin.isEnabled({})).toBe(true);
    expect(plugin.isEnabled({ EVER_JOBS_UI_OPERATOR: "off" })).toBe(false);
    expect(plugin.isEnabled({ EVER_JOBS_UI_OPERATOR: "true" })).toBe(true);
  });

  it("uses the same browser-safe feature switch for Vite configuration", () => {
    expect(isOperatorUiEnabled()).toBe(true);
    expect(isOperatorUiEnabled(" FALSE ")).toBe(false);
    expect(isOperatorUiEnabled("0")).toBe(false);
    expect(isOperatorUiEnabled("on")).toBe(true);
  });
});
