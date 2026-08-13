/**
 * Central configuration factory.
 * Maps every environment variable to a typed config object.
 */
export default () => {
  const parseBool = (val: string | undefined, fallback: boolean): boolean => {
    if (val === undefined || val === "") return fallback;
    return ["true", "1", "yes", "on"].includes(val.toLowerCase());
  };

  const parseList = (val: string | undefined): string[] => {
    if (!val || val.trim() === "") return [];
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const parseInt = (val: string | undefined, fallback: number): number => {
    if (val === undefined || val === "") return fallback;
    const n = Number(val);
    return Number.isNaN(n) ? fallback : n;
  };

  return {
    port: parseInt(process.env.PORT, 3001),
    host: process.env.API_HOST || "0.0.0.0",

    // API Security
    auth: {
      enabled: parseBool(process.env.ENABLE_API_KEY_AUTH, false),
      apiKeys: parseList(process.env.API_KEYS),
      headerName: process.env.API_KEY_HEADER_NAME || "x-api-key",
    },

    // Rate Limiting
    rateLimit: {
      enabled: parseBool(process.env.RATE_LIMIT_ENABLED, false),
      maxRequests: parseInt(process.env.RATE_LIMIT_REQUESTS, 100),
      timeframeSec: parseInt(process.env.RATE_LIMIT_TIMEFRAME, 3600),
    },

    // Proxy
    proxy: {
      defaults: parseList(process.env.DEFAULT_PROXIES),
      caCertPath: process.env.CA_CERT_PATH || null,
    },

    // Search Defaults
    defaults: {
      siteNames: parseList(
        process.env.DEFAULT_SITE_NAMES ||
          "linkedin,indeed,zip_recruiter,glassdoor,google,bayt,naukri,bdjobs,internshala,exa,upwork",
      ),
      resultsWanted: parseInt(process.env.DEFAULT_RESULTS_WANTED, 20),
      distance: parseInt(process.env.DEFAULT_DISTANCE, 50),
      descriptionFormat: process.env.DEFAULT_DESCRIPTION_FORMAT || "markdown",
      country: process.env.DEFAULT_COUNTRY || "USA",
    },

    // Caching
    cache: {
      enabled: parseBool(process.env.ENABLE_CACHE, false),
      expirySec: parseInt(process.env.CACHE_EXPIRY, 3600),
      redisUrl: process.env.REDIS_URL || null,
      maxItems: parseInt(process.env.CACHE_MAX_ITEMS, 500),
    },

    // Retry policies
    retry: {
      defaultRetries: parseInt(process.env.RETRY_DEFAULT_RETRIES, 3),
      defaultDelayMs: parseInt(process.env.RETRY_DEFAULT_DELAY_MS, 1000),
      defaultBackoff: process.env.RETRY_DEFAULT_BACKOFF || "linear",
      perSource: (() => {
        try {
          return JSON.parse(process.env.RETRY_PER_SOURCE || "{}");
        } catch {
          return {};
        }
      })(),
    },

    // GraphQL
    graphql: {
      enabled: parseBool(process.env.ENABLE_GRAPHQL, true),
      playground: parseBool(process.env.GRAPHQL_PLAYGROUND, true),
      path: process.env.GRAPHQL_PATH || "graphql",
    },

    // Prometheus Metrics
    metrics: {
      enabled: parseBool(process.env.ENABLE_METRICS, true),
    },

    // Plugins
    plugins: {
      enabled: parseBool(process.env.ENABLE_PLUGINS, false),
      dir: process.env.PLUGINS_DIR || null,
    },

    // Persistent watcher
    watcher: {
      healthUrl:
        process.env.WATCHER_HEALTH_URL || "http://127.0.0.1:3002/health",
      enabled: parseBool(process.env.WATCHER_ENABLED, false),
      defaultTimezone:
        process.env.WATCHER_DEFAULT_TIMEZONE || "America/Toronto",
      defaultIntervalMinutes: parseInt(
        process.env.WATCHER_DEFAULT_INTERVAL_MINUTES,
        3,
      ),
      schedulerPollMs: parseInt(process.env.WATCHER_SCHEDULER_POLL_MS, 15_000),
      maxConcurrentWatches: parseInt(
        process.env.WATCHER_MAX_CONCURRENT_WATCHES,
        2,
      ),
      maxConcurrentSources: parseInt(
        process.env.WATCHER_MAX_CONCURRENT_SOURCES,
        5,
      ),
      sourceTimeoutMs: parseInt(process.env.WATCHER_SOURCE_TIMEOUT_MS, 12_000),
      retryAttempts: parseInt(process.env.WATCHER_RETRY_ATTEMPTS, 3),
      retryBaseDelayMs: parseInt(process.env.WATCHER_RETRY_BASE_DELAY_MS, 500),
      schedulerLockTtlMs: parseInt(
        process.env.WATCHER_SCHEDULER_LOCK_TTL_MS,
        180_000,
      ),
      instanceId: process.env.WATCHER_INSTANCE_ID || null,
      seedDefault: parseBool(process.env.WATCHER_SEED_DEFAULT, true),
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
      genericWebhookUrl: process.env.GENERIC_WEBHOOK_URL || null,
      genericWebhookSecret: process.env.GENERIC_WEBHOOK_SECRET || null,
      digestEnabled: parseBool(process.env.DIGEST_ENABLED, true),
      digestHour: parseInt(process.env.DIGEST_DEFAULT_HOUR, 8),
      digestMinute: parseInt(process.env.DIGEST_DEFAULT_MINUTE, 0),
    },

    // Logging
    logLevel: process.env.LOG_LEVEL || "info",
    environment: process.env.NODE_ENV || "development",

    // CORS
    cors: {
      origins: parseList(process.env.CORS_ORIGINS || "*"),
    },

    // Swagger
    swagger: {
      enabled: parseBool(process.env.ENABLE_SWAGGER, true),
      path: process.env.SWAGGER_PATH || "swg",
    },

    // Scalar
    scalar: {
      enabled: parseBool(process.env.ENABLE_SCALAR, true),
      path: process.env.SCALAR_PATH || "docs",
    },
  };
};
