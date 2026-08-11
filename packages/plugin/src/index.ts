// Core module
export { PluginModule } from "./plugin.module";

// Decorator
export {
  SourcePlugin,
  SOURCE_PLUGIN_METADATA,
} from "./decorators/source-plugin.decorator";

// Registry
export { PluginRegistry } from "./registry/plugin-registry.service";

// Discovery
export { PluginDiscoveryService } from "./discovery/plugin-discovery.service";

// Interfaces
export {
  IPluginMetadata,
  PluginCategory,
  SourceWatchMode,
} from "./interfaces/plugin-metadata.interface";
export {
  INotificationSecretStore,
  NOTIFICATION_SECRET_STORE,
  NotificationSecretSource,
  NotificationSecretStatus,
} from "./interfaces/notification-secret-store.interface";
export {
  IUiPlugin,
  UI_PLUGIN_TOKEN,
  UiNavigationItem,
  UiPluginManifest,
} from "./interfaces/ui-plugin.interface";
export {
  ERR_UI_PLUGIN_DUPLICATE_ID,
  ERR_UI_PLUGIN_DUPLICATE_ROUTE,
  UiPluginRegistry,
  UiPluginRegistryError,
} from "./ui/ui-plugin.registry";

// Configuration
export {
  DISABLED_SOURCES_ENV_VAR,
  parseDisabledSources,
  readDisabledSources,
} from "./config/disabled-sources";

// Circuit breaker (Spec 005)
export { CircuitBreakerService } from "./circuit-breaker/circuit-breaker.service";
export { CircuitBreakerInterceptor } from "./circuit-breaker/circuit-breaker.interceptor";
export { CircuitBreakerModule } from "./circuit-breaker/circuit-breaker.module";

// Persistence-store plugin (Spec 004)
export {
  StorePlugin,
  STORE_PLUGIN_METADATA_KEY,
} from "./store/store-plugin.decorator";
export {
  StoreRegistry,
  StoreRegistryError,
  ERR_STORE_INVALID_ID,
  ERR_STORE_DUPLICATE_ID,
} from "./store/store-registry.service";
export {
  StoreModule,
  StoreModuleConfigurationError,
  StoreModuleForActiveOptions,
  ERR_STORE_ACTIVE_ID_REQUIRED,
  ERR_STORE_BACKEND_NOT_DECORATED,
} from "./store/store.module";
