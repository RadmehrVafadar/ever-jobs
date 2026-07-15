# Plan: 016 — Real-time Job Watcher

| Field        | Value                 |
| ------------ | --------------------- |
| Spec         | [spec.md](spec.md)    |
| Status       | in-progress           |
| Owner        | Ever Jobs maintainers |
| Created      | 2026-07-14            |
| Last updated | 2026-07-14            |

## 1. Approach

Implement the watcher as an integrated NestJS feature package plus a long-running application. `@ever-jobs/watcher` owns the domain contracts and replaceable services. `apps/watcher` composes that package with the existing `JobsModule`, starts the scheduler, and exposes operational HTTP endpoints. The existing API and CLI import the same package with scheduling disabled for management operations.

Use PostgreSQL as both the watcher system of record and the durable scheduler coordination mechanism. Prisma implements the production `WatchRepository`; the in-memory repository remains a deterministic test adapter. A due-watch query finds enabled work, and an atomic renewable lease prevents execution by two replicas. Explicit targets carry independent due timestamps so Tier 1, Tier 2, and Tier 3 can run at 3/15/60-minute cadences without polling every source every three minutes.

Reuse the existing source registry and `JobsService`. A planner resolves direct, ATS, structured, and fragile targets, validates ATS board slugs, limits query terms, and selects only due targets. The executor applies concurrency, timeouts, retries, jitter, and settled-result accounting. Successful siblings survive a source rejection.

Within one database-backed pipeline, normalize/fingerprint each job, transactionally upsert the observation and watch match, score it, and only then enqueue a notification. Use a persisted outbox row and transactional delivery claim for retries and duplicate-send protection. Configure Discord through a non-secret destination reference whose complete URL is resolved from the process environment.

Roll out safely. Seed a disabled baseline watch; initialize all enabled targets without notification; inspect failed sources; test Discord; then resume scheduling. Keep known stale desired sources absent from the default until they have a supported public endpoint and deterministic adapter tests.

For local operation, run PostgreSQL and the watcher on the host or through Compose. For Google Cloud, deploy the same worker image as a private, always-on Cloud Run service with instance-based CPU, one minimum instance, Cloud SQL, and Secret Manager. Do not use a run-to-completion Cloud Run Job for the current in-process scheduler.

## 2. Architecture and module boundaries

| Boundary                                 | Responsibility                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WatcherModule`                          | Dependency injection, replaceable repository/source/provider bindings, optional scheduler providers           |
| `PrismaWatchRepository`                  | Persistence, transactions, pagination/filtering, leases, outbox claims, health                                |
| `WatchSourcePlanner`                     | Source classification, ATS slug validation, explicit-target cadence, bounded query planning                   |
| `JobsServiceWatchExecutor`               | Calls existing sources with bounded concurrency, timeout, retry/jitter, and partial-failure results           |
| `JobFingerprintService`                  | Text/location normalization, URL canonicalization, source-scoped and canonical SHA-256 keys, description hash |
| `JobScoringService`                      | Explainable role/internship/location/company/source/skill scoring and contextual exclusions                   |
| `WatchExecutionService`                  | Lease lifecycle, run history, observation/match transaction, safe initialization modes, notification decision |
| `NotificationDispatcher`                 | Outbox creation, idempotency, delivery claim, retry/backoff, provider result persistence                      |
| `DiscordNotificationProvider`            | Secret resolution, URL validation, safe Discord payload and HTTP behavior                                     |
| `DailyDigestService`                     | Timezone-aware due pass and medium-score digest delivery                                                      |
| `WatcherSchedulerService`                | Poll loop, due-watch capacity, notification retry pass, digest pass, scheduler status                         |
| `WatcherMetricsService`                  | Prometheus counters, gauges, and histograms                                                                   |
| `apps/watcher`                           | Production scheduler host with `/health` and `/metrics`                                                       |
| `apps/api/src/watches`                   | Authenticated REST management and dashboard-ready persisted views                                             |
| `apps/cli/src/commands/watch.command.ts` | Local/scriptable administration with scheduler disabled                                                       |

## 3. Phases

### Phase 1 — Repository analysis and contracts

- Goal: identify existing source invocation, normalized job DTO, configuration, logging, API, CLI, Docker, and test conventions.
- Deliverables: Spec 016, actual-path implementation plan, ordered tasks, and repository contract interfaces.
- Exit criteria: no separate scraper or watcher-to-REST search dependency is proposed.

### Phase 2 — Persistence and migration

- Goal: make all watcher correctness state durable.
- Deliverables: Prisma models/migrations, production repository, in-memory parity adapter, seed script, indexes, uniqueness, transactions, leases, claims, filters, and health.
- Exit criteria: migrations apply to an empty database; repository integration tests cover lease and outbox races.

### Phase 3 — Source planning, fingerprinting, and scoring

- Goal: turn watch configuration into bounded source requests and explainable persisted matches.
- Deliverables: explicit source targets, 3/15/60 cadence, ATS slug validation, normalization/fingerprinting, description updates, contextual exclusions, configurable weights, and score caps.
- Exit criteria: deterministic unit tests cover due selection, identity stability/difference, edits, requirements, exclusions, and threshold bands.

### Phase 4 — Execution and scheduling

- Goal: run watches automatically without overlap and preserve partial results.
- Deliverables: `JobsService` executor, timeout/retry/jitter, lease heartbeat, run audit, source-target due advancement, scheduler poll loop, retries, digest pass, and restart recovery.
- Exit criteria: fake-source pipeline and replica-race tests pass; a three-minute target cannot overlap its prior run.

### Phase 5 — Discord delivery and digest

- Goal: send durable provider-safe notifications after persistence.
- Deliverables: Discord provider, environment-backed destination reference, outbox enqueue-before-send, claims, retry/backoff, idempotency, latency, provider test, and digest-type delivery.
- Exit criteria: provider tests cover escaping, SSRF/host validation, mentions, timeouts, rate limits, retry classification, and duplicate suppression.

### Phase 6 — REST, CLI, health, and metrics

- Goal: make operations observable and manageable without direct database edits.
- Deliverables: authenticated CRUD/history/filter/status/metrics APIs, equivalent CLI actions, worker HTTP health/metrics, structured telemetry, and Swagger descriptions.
- Exit criteria: API authentication, validation, pagination/filtering, CLI safety, and metrics tests pass.

### Phase 7 — Source readiness and safe default

- Goal: ship a default that does not silently depend on known stale integrations.
- Deliverables: active supported target list; DoorDash Canada Greenhouse path; Plaid Ashby slug; explicit disabled list for Google Careers, Meta, Shopify, Google Jobs, and Wellfound.
- Exit criteria: seed is disabled, uninitialized, idempotent, contains only accepted targets, and its source contract matches the example configuration.

### Phase 8 — Local and cloud operations

- Goal: provide copy-and-paste paths from clean checkout to verified pipeline.
- Deliverables: environment template, Nx/package scripts, Docker target, Compose migration dependency, local runbook, Google Cloud runbook, docs index/log, and root README.
- Exit criteria: commands match `package.json` and `docker-compose.yml`; baseline/test/resume order and credentials are explicit.

### Phase 9 — Validation and release

- Goal: prove the changed surface without hiding unrelated repository debt.
- Deliverables: formatting, diff check, docs lint, watcher unit/integration/E2E tests, API/CLI tests, type checks, lint, and production build results.
- Exit criteria: watcher-caused failures are fixed; unrelated pre-existing failures are reported separately with command output.

## 4. Packages and files touched

| Path                                                            | Change                                                                                                                                                          |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/watcher`                                              | Domain interfaces, production/in-memory repositories, planner, execution, scheduler, scoring, fingerprinting, notifications, digest, validation, metrics, tests |
| `apps/watcher`                                                  | Long-running NestJS worker, health/metrics controller, Nx target, operating guide                                                                               |
| `apps/api/src/watches`                                          | Authenticated watcher management API, DTOs, serializers, persisted metrics, tests                                                                               |
| `apps/cli/src/commands/watch.command.ts`                        | Scriptable watcher management and Discord test                                                                                                                  |
| `prisma/schema.prisma`                                          | Watcher persistence, indexes, leases, and notification claims                                                                                                   |
| `prisma/migrations/20260714120000_complete_watcher_persistence` | Forward migration completing production watcher storage                                                                                                         |
| `scripts/seeds/watcher-seed.ts`                                 | Explicit safe seed command                                                                                                                                      |
| `packages/watcher/src/services/default-watch-seeder.service.ts` | Idempotent first-bootstrap safe seed                                                                                                                            |
| `docker-compose.yml`                                            | PostgreSQL, migration one-shot, and watcher service ordering/health                                                                                             |
| `Dockerfile`                                                    | `watcher-runtime` production target                                                                                                                             |
| `.env.example` and `package.json`                               | Runtime configuration and supported commands                                                                                                                    |
| `.specify/specs/016-realtime-job-watcher`                       | Authoritative specification, plan, and task ledger                                                                                                              |
| `docs/runbooks` and `apps/watcher/README.md`                    | Local and Google Cloud operations                                                                                                                               |
| `README.md`, `docs/index.md`, `docs/log.md`                     | User entry point, discoverability, and append-only change record                                                                                                |

## 5. Dependencies

| Library/service                           | Version/source                   | Rationale                                                                                           |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Prisma / `@prisma/client`                 | Repository-pinned stable version | Existing TypeScript ORM choice for PostgreSQL schema, migrations, transactions, and generated types |
| PostgreSQL                                | 16 in Compose                    | Durable records, indexed due queries, transactional leases, and outbox claims                       |
| NestJS                                    | Repository-pinned stable version | Existing application/module/DI/config/logging conventions                                           |
| `prom-client`                             | Repository-pinned stable version | Existing TypeScript Prometheus metrics implementation                                               |
| Existing source plugins and `JobsService` | Monorepo packages                | Avoids a second scraper and preserves source protections/normalization                              |
| Discord webhook API                       | Public HTTPS endpoint            | Initial notification destination; no additional SDK required                                        |

Redis is deliberately not required. The existing Compose Redis service may support other Ever Jobs features but is not part of watcher scheduling correctness.

## 6. Migration and rollout plan

1. Generate Prisma client with `npm run db:generate`.
2. Apply checked-in migrations with `npm run db:migrate` or the Compose `watcher-migrate` one-shot service.
3. Create the safe default through `npm run db:seed` or first watcher bootstrap when `WATCHER_SEED_DEFAULT=true`.
4. Start the worker and confirm `/health` reports database and scheduler health plus Discord configuration presence.
5. Keep the watch disabled; run `watch initialize`; require zero notifications and review all source failures.
6. Rerun initialization after fixing any important failed target.
7. Run `watch notifications-test` and verify the intended Discord channel.
8. Run `watch resume` and observe at least two Tier 1 runs plus durable run/delivery history.
9. For cloud deployment, apply migrations as an explicit release step before routing scheduling to the new revision.

Existing watcher rows are preserved. Seed/bootstrap must never reset initialized or operator-edited state.

## 7. Source migration plan

| Legacy/desired source                      | Final default behavior                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| DoorDash Greenhouse board token `doordash` | Replace with the verified DoorDash Canada Greenhouse board through the maintained adapter; keep enabled in Tier 1 |
| Plaid Greenhouse wrapper                   | Do not use; configure generic Ashby with board slug `plaid` in Tier 1                                             |
| Google Careers retired v3 API              | Remove from the default until an official-page HTML adapter is implemented                                        |
| Meta `__NEXT_DATA__` parser                | Remove from the default; do not hard-code private Relay persisted queries                                         |
| Shopify Greenhouse slug                    | Remove from the default; current Shopify/Ashby surface has no stable public board slug                            |
| Google Jobs and Wellfound                  | Keep absent from the unattended default pending repair and fixture-backed validation                              |

When enabling a repaired source in an existing deployment, pause, add the target, initialize while disabled, inspect its baseline, then resume.

## 8. Risks and mitigations

| Risk                                                       | Likelihood           | Impact | Mitigation                                                                                                                        |
| ---------------------------------------------------------- | -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| External source changes schema or endpoint                 | high                 | high   | Explicit supported-source list, fixtures, partial-run accounting, disable stale targets, prefer public ATS APIs                   |
| Adapter swallows an error and returns zero jobs            | medium               | high   | Harden adapters to reject hard failures; monitor sudden zero-result/source-success anomalies; document limitation                 |
| Initial alert flood                                        | high without control | high   | Disabled seed, baseline initialization, zero-notification assertion, explicit resume                                              |
| Two replicas execute the same watch                        | medium               | high   | Atomic renewable PostgreSQL lease plus process-local active set                                                                   |
| Lease expires during slow execution                        | low                  | high   | Heartbeat at one-third TTL; configurable TTL; observe long source/run duration                                                    |
| Duplicate Discord delivery                                 | medium               | high   | Unique outbox key, transactional claim, send-after-persist, durable sent state                                                    |
| Crash after provider accepts but before sent state commits | low                  | medium | Idempotency minimizes normal repeats, but Discord lacks a provider idempotency API; record this residual distributed-systems risk |
| Discord URL leaks through config or logs                   | low                  | high   | Environment/Secret Manager only, non-secret destination reference, redaction, public serializer, provider host/path validation    |
| A baseline source fails                                    | medium               | medium | Remain disabled, inspect failed list, rerun initialization, explicitly accept risk before resume                                  |
| Three-minute expectation is interpreted as a guarantee     | medium               | medium | Document cadence versus end-to-end latency; expose scheduler freshness, run duration, and latency metrics                         |
| Cloud Run CPU is throttled between requests                | high with defaults   | high   | Instance-based billing, at least one minimum instance, private service, health monitoring                                         |
| Cloud costs surprise operator                              | medium               | medium | Start max one instance; document continuous Cloud Run and Cloud SQL cost                                                          |
| Cross-source duplicate remains                             | medium               | low    | Preserve source records; plan future canonical association without changing observation identity                                  |
| Digest is expected as one aggregate message                | medium               | low    | Document current per-match digest behavior; future provider-level aggregate is separate work                                      |

## 9. Rollback plan

1. Pause the affected watch through CLI/API. This preserves observations, matches, runs, and deliveries.
2. If the entire scheduler must stop, deploy/set `WATCHER_ENABLED=false`; management and persisted data remain available.
3. Disable an individual failing source target rather than increasing request pressure or bypassing controls.
4. Roll the application image back to the previous compatible revision. Do not reverse a migration automatically.
5. Keep database migrations backward-compatible across the rollout window. Use a forward repair migration or tested database restore for schema recovery.
6. Rotate `DISCORD_WEBHOOK_URL` immediately if compromised, then run a non-persistent provider test before resuming.

## 10. Validation plan

Run from the repository root and record exact results:

```bash
npm run db:generate
npm run lint:docs
npx jest packages/watcher --runInBand
npm run test:api -- --runInBand
npm run test:cli -- --runInBand
npx tsc -p packages/watcher/tsconfig.json --noEmit
npx tsc -p apps/watcher/tsconfig.json --noEmit
npx tsc -p apps/api/tsconfig.json --noEmit
npx tsc -p apps/cli/tsconfig.build.json --noEmit
npm run lint
npm run build
git diff --check
```

Then complete the local operational smoke test from the runbook. A failure outside watcher-touched paths must be reported as unrelated repository debt; it must not be presented as a watcher pass or silently fixed through unrelated refactoring.

## 11. Open questions

No release-blocking design question remains. Future enhancements—persisted cross-source canonical groups, grouped digest messages, closed-job lifecycle, and repaired Google/Meta/Shopify sources—must receive their own scoped spec/task updates before implementation.
