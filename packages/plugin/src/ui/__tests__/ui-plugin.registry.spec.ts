import {
  ERR_UI_PLUGIN_DUPLICATE_ID,
  ERR_UI_PLUGIN_DUPLICATE_ROUTE,
  UiPluginRegistry,
  UiPluginRegistryError,
} from "../ui-plugin.registry";
import { IUiPlugin } from "../../interfaces/ui-plugin.interface";

function plugin(id: string, path: string, enabled = true): IUiPlugin {
  return {
    manifest: {
      id,
      name: id,
      description: id,
      mountPath: path,
      navigation: [{ id: `${id}-home`, label: id, path }],
    },
    isEnabled: () => enabled,
  };
}

describe("UiPluginRegistry", () => {
  it("returns only runtime-enabled manifests", () => {
    const registry = new UiPluginRegistry([
      plugin("operator", "/"),
      plugin("disabled", "/disabled", false),
    ]);

    expect(registry.manifests().map(({ id }) => id)).toEqual(["operator"]);
  });

  it.each([
    {
      plugins: [plugin("operator", "/"), plugin("operator", "/other")],
      code: ERR_UI_PLUGIN_DUPLICATE_ID,
    },
    {
      plugins: [plugin("operator", "/same"), plugin("other", "/same/")],
      code: ERR_UI_PLUGIN_DUPLICATE_ROUTE,
    },
  ] as const)("rejects ambiguous runtime manifests", ({ plugins, code }) => {
    expect(() => new UiPluginRegistry(plugins).manifests()).toThrow(
      expect.objectContaining<Partial<UiPluginRegistryError>>({ code }),
    );
  });
});
