# Tasks: 016 — Real-time Job Watcher

> Status legend: `[ ]` pending • `[~]` in-progress • `[x]` done • `[-]` dropped

## Phase 1 — Analysis and specification

- [x] T01 — Inspect reusable monorepo architecture
  - **Files:** `apps/api`, `apps/cli`, `packages/models`, `packages/plugin`, `packages/plugins`, `packages/common`, root configuration and Docker files
  - **Acceptance:** Actual normalized DTO, source invocation, DI, config, logging, API, CLI, test, and Docker extension points are recorded; no separate scraper is introduced.
  - **Estimate:** 0.5 day

- [x] T02 — Complete Spec-Kit artifacts
  - **Files:** `.specify/specs/016-realtime-job-watcher/spec.md`, `plan.md`, `tasks.md`
  - **Acceptance:** Problem, goals, non-goals, functional/non-functional contracts, metadata, test plan, risks, rollout, rollback, and production source status are documented.
  - **Estimate:** 0.5 day

## Phase 2 — Persistence and repository

- [x] T03 — Define watcher domain and repository contracts
  - **Files:** `packages/watcher/src/interfaces/watch.types.ts`
  - **Acceptance:** Watches, explicit source targets, observations, matches, runs, deliveries, pages/filters, leases, claims, providers, and repository operations are TypeScript contracts.
  - **Estimate:** 1 day

- [x] T04 — Complete Prisma schema and migrations
  - **Files:** `prisma/schema.prisma`, `prisma/migrations/20260714120000_complete_watcher_persistence/migration.sql`
  - **Acceptance:** All five entities, foreign keys, unique constraints, due/lease/claim/filter indexes, timestamps, and cascading history are deployable to PostgreSQL.
  - **Estimate:** 1 day

- [x] T05 — Implement production Prisma repository
  - **Files:** `packages/watcher/src/persistence/prisma-watch.repository.ts`, `watcher-prisma.service.ts`
  - **Acceptance:** CRUD, queries, pagination, filters, transactionally persisted observation/match, lease acquire/renew/release, outbox enqueue/claim/update, digest selection, and health are implemented.
  - **Estimate:** 1 day

- [x] T06 — Keep deterministic in-memory repository parity
  - **Files:** `packages/watcher/src/persistence/in-memory-watch.repository.ts`, repository tests
  - **Acceptance:** Unit/pipeline tests can exercise equivalent observable behavior without PostgreSQL; production DI defaults to Prisma.
  - **Estimate:** 0.5 day

- [x] T07 — Add safe idempotent seeding
  - **Files:** `packages/watcher/src/services/default-watch.ts`, `default-watch-seeder.service.ts`, `scripts/seeds/watcher-seed.ts`
  - **Acceptance:** A missing default is created disabled/uninitialized/baseline; an existing watch is never reset; destination stores `default`, not a webhook secret.
  - **Estimate:** 0.5 day

## Phase 3 — Identity, scoring, and source planning

- [x] T08 — Implement deterministic fingerprinting
  - **Files:** `packages/watcher/src/services/job-fingerprint.service.ts`, tests
  - **Acceptance:** Text/location/URL normalization, stable external-ID identity, fallback identity, numeric-ID coercion, tracking removal, and separate description hash have deterministic tests.
  - **Estimate:** 0.5 day

- [x] T09 — Implement explainable internship scoring
  - **Files:** `packages/watcher/src/services/job-scoring.service.ts`, tests
  - **Acceptance:** Required role/internship/Canada conditions, contextual exclusions, configurable category weights, skill cap, thresholds, reasons, matches, and missing conditions are covered.
  - **Estimate:** 1 day

- [x] T10 — Implement explicit source planning
  - **Files:** `packages/watcher/src/services/watch-source-planner.service.ts`, tests
  - **Acceptance:** Direct/ATS/structured/fragile classification, explicit target enablement, ATS slug validation, due selection, 3/15/60 defaults, query budget, deduplication, and force-all mode are deterministic.
  - **Estimate:** 1 day

- [x] T11 — Harden the production default source set
  - **Files:** `packages/watcher/src/services/default-watch.ts`, source adapters, tests
  - **Acceptance:** Active defaults are Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash Canada, Coinbase, Figma, Vercel, Ashby `plaid`, and Canada Job Bank; known stale Google Careers, Meta, Shopify, Google Jobs, and Wellfound paths are absent.
  - **Estimate:** 0.5 day

## Phase 4 — Execution and scheduler

- [x] T12 — Implement bounded source execution
  - **Files:** `packages/watcher/src/services/jobs-service-watch.executor.ts`, `apps/api/src/jobs/jobs.service.ts`, tests
  - **Acceptance:** Existing `JobsService` is reused; source requests are bounded, timed out, retried with jitter, settled independently, and attributed to per-source results.
  - **Estimate:** 1 day

- [x] T13 — Implement transactional watch pipeline
  - **Files:** `packages/watcher/src/services/watch-execution.service.ts`, pipeline tests
  - **Acceptance:** Run creation, normalization, observation/match persistence, edit handling, scoring, safe mode selection, notification-after-persistence, counts, partial errors, latency, and completion are tested.
  - **Estimate:** 1 day

- [x] T14 — Implement PostgreSQL lease lifecycle
  - **Files:** execution service, Prisma repository, repository/scheduler tests
  - **Acceptance:** Acquire is atomic, due-aware scheduling cannot overlap, heartbeat renews, finally releases, expired leases recover, and two replicas cannot both execute one watch.
  - **Estimate:** 1 day

- [x] T15 — Implement recurring scheduler
  - **Files:** `packages/watcher/src/services/watcher-scheduler.service.ts`, tests
  - **Acceptance:** Polling, process capacity, active-set guard, expected lease races, retry pass, digest pass, shutdown, and scheduler health are implemented; 3/15/60 target timestamps survive restart.
  - **Estimate:** 1 day

## Phase 5 — Notifications and digest

- [x] T16 — Implement durable notification dispatcher
  - **Files:** `packages/watcher/src/services/notification-dispatcher.service.ts`, persistence adapters, tests
  - **Acceptance:** Outbox row precedes provider I/O; unique identity suppresses duplicates; transactional claims, rehydration, backoff, retry-after, attempt ceiling, sent/suppressed/failed state, and sanitized errors are tested.
  - **Estimate:** 1 day

- [x] T17 — Implement production Discord provider
  - **Files:** `packages/watcher/src/services/discord-notification.provider.ts`, tests
  - **Acceptance:** Environment-backed reference, HTTPS host/path allowlist, safe embeds, bounded fields, disabled mentions, timeout, response classification, retryability, and secret redaction are covered.
  - **Estimate:** 1 day

- [x] T18 — Implement daily digest pass
  - **Files:** `packages/watcher/src/services/daily-digest.service.ts`, repositories, tests
  - **Acceptance:** Enabled initialized watches are evaluated at local 08:00 by default; pending scores in `[digestScore, minimumScore)` are ordered/capped and sent once per match/type/destination.
  - **Estimate:** 0.5 day

## Phase 6 — Management and observability

- [x] T19 — Complete authenticated REST management
  - **Files:** `apps/api/src/watches`, API tests
  - **Acceptance:** CRUD, safe run/initialize, pause/resume, runs, matches/status, metrics, observed jobs, deliveries, Discord test, Swagger, auth, validation, pagination, filters, and public secret-safe serialization work.
  - **Estimate:** 1 day

- [x] T20 — Complete CLI management
  - **Files:** `apps/cli/src/commands/watch.command.ts`, `apps/cli/src/cli.module.ts`, CLI tests
  - **Acceptance:** All documented actions and options work against PostgreSQL, pretty JSON is available, validation is useful, and the CLI does not start scheduler polling.
  - **Estimate:** 1 day

- [x] T21 — Add worker health and Prometheus metrics
  - **Files:** `apps/watcher/src`, `packages/watcher/src/services/watcher-metrics.service.ts`, tests
  - **Acceptance:** Worker binds configured port; `/health` covers app/database/scheduler/Discord without secrets; `/metrics` exposes required watcher series.
  - **Estimate:** 0.5 day

## Phase 7 — Packaging and operations

- [x] T22 — Complete configuration and startup validation
  - **Files:** `.env.example`, `apps/api/src/config/configuration.ts`, watcher validation/config tests
  - **Acceptance:** Database, watcher, concurrency, timeout, retry, lease, Discord, digest, seed, and port settings have documented defaults and secrets are never logged.
  - **Estimate:** 0.5 day

- [x] T23 — Complete Docker and Compose path
  - **Files:** `Dockerfile`, `docker-compose.yml`, app project config
  - **Acceptance:** `watcher-runtime` exists; PostgreSQL health gates one-shot migration; worker waits for migration, safely seeds missing default on bootstrap, publishes health port, and persists database volume.
  - **Estimate:** 0.5 day

- [x] T24 — Write local operations documentation
  - **Files:** `apps/watcher/README.md`, `docs/runbooks/watcher-local.md`, `README.md`
  - **Acceptance:** Host and Compose commands match scripts/services; source readiness, 3/15/60 cadence, disabled → initialize → test → resume, troubleshooting, metrics, and credential placement are explicit.
  - **Estimate:** 0.5 day

- [x] T25 — Write Google Cloud deployment documentation
  - **Files:** `docs/runbooks/watcher-google-cloud.md`
  - **Acceptance:** Private always-on Cloud Run, instance-based CPU, min/max instances, Cloud SQL, Secret Manager, explicit migration/seed, baseline flow, monitoring, rollback, and cost are documented with official references.
  - **Estimate:** 0.5 day

- [x] T26 — Update documentation discovery and history
  - **Files:** `docs/index.md`, `docs/log.md`
  - **Acceptance:** Spec, application guide, both runbooks, production source decisions, and validation record are discoverable and append-only history is updated.
  - **Estimate:** 0.25 day

## Phase 8 — Validation

- [~] T27 — Run focused automated validation
  - **Files:** watcher/API/CLI tests and TypeScript projects
  - **Acceptance:** Prisma generation, watcher unit/persistence/pipeline/scheduler/provider tests, API watcher tests, CLI tests, and app/package type checks pass; failures caused by this feature are fixed.
  - **Estimate:** 0.5 day

- [~] T28 — Run repository validation
  - **Files:** repository-wide lint/build/test configuration
  - **Acceptance:** Docs lint, diff check, lint, production build, and relevant existing suites are run; unrelated pre-existing failures are distinguished with exact commands/results.
  - **Estimate:** 0.5 day

- [ ] T29 — Complete local operational smoke test
  - **Files:** runtime only; no live-site dependency in automated tests
  - **Acceptance:** PostgreSQL starts, migration/seed succeeds, `/health` and `/metrics` respond, baseline sends zero notifications, Discord test reaches the selected channel, resume produces at least two Tier 1 run rows, and no duplicate delivery occurs.
  - **Estimate:** 0.5 day

## Notes

- T29 requires the operator's real `DISCORD_WEBHOOK_URL`; it cannot be completed safely with a placeholder.
- Live career-site success is an operational observation, not an automated test dependency.
- Do not enable Google Careers, Meta, Shopify, Google Jobs, or Wellfound in the default until their remediation and fixture tests are complete.
- Update `docs/log.md` with validation results in the same release change.
