import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  IUiPlugin,
  UI_PLUGIN_TOKEN,
  UiPluginManifest,
} from "../interfaces/ui-plugin.interface";

export const ERR_UI_PLUGIN_DUPLICATE_ID = "ERR_UI_PLUGIN_DUPLICATE_ID";
export const ERR_UI_PLUGIN_DUPLICATE_ROUTE = "ERR_UI_PLUGIN_DUPLICATE_ROUTE";

export class UiPluginRegistryError extends Error {
  constructor(
    readonly code:
      | typeof ERR_UI_PLUGIN_DUPLICATE_ID
      | typeof ERR_UI_PLUGIN_DUPLICATE_ROUTE,
    message: string,
  ) {
    super(message);
    this.name = "UiPluginRegistryError";
  }
}

/**
 * Runtime registry for replaceable UI manifests. It deliberately exposes only
 * non-executable metadata so browser hosts can map enabled routes to their own
 * components without importing Nest providers into the client bundle.
 */
@Injectable()
export class UiPluginRegistry {
  constructor(
    @Optional()
    @Inject(UI_PLUGIN_TOKEN)
    private readonly plugins: readonly IUiPlugin[] = [],
  ) {}

  manifests(
    environment: NodeJS.ProcessEnv = process.env,
  ): readonly UiPluginManifest[] {
    const enabled = this.plugins.filter((plugin) =>
      plugin.isEnabled(environment),
    );
    const ids = new Set<string>();
    const routes = new Set<string>();

    for (const plugin of enabled) {
      if (ids.has(plugin.manifest.id)) {
        throw new UiPluginRegistryError(
          ERR_UI_PLUGIN_DUPLICATE_ID,
          `Duplicate UI plugin id: ${plugin.manifest.id}`,
        );
      }
      ids.add(plugin.manifest.id);
      for (const navigation of plugin.manifest.navigation) {
        const route = normalizeRoute(navigation.path);
        if (routes.has(route)) {
          throw new UiPluginRegistryError(
            ERR_UI_PLUGIN_DUPLICATE_ROUTE,
            `Duplicate UI navigation route: ${route}`,
          );
        }
        routes.add(route);
      }
    }

    return Object.freeze(enabled.map((plugin) => plugin.manifest));
  }
}

function normalizeRoute(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "/") return trimmed;
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}
