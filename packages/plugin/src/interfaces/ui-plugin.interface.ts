export const UI_PLUGIN_TOKEN = Symbol.for("@ever-jobs/plugin/IUiPlugin");

export interface UiNavigationItem {
  id: string;
  label: string;
  path: string;
}

export interface UiPluginManifest {
  id: string;
  name: string;
  description: string;
  mountPath: string;
  navigation: readonly UiNavigationItem[];
}

/** Replaceable manifest contract mounted by the local web host. */
export interface IUiPlugin {
  readonly manifest: UiPluginManifest;
  isEnabled(environment?: NodeJS.ProcessEnv): boolean;
}
