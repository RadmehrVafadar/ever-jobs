# Plan: 6002 — Local Operator GUI and Notification Routing

| Field        | Value      |
| ------------ | ---------- |
| Spec         | `spec.md`  |
| Created      | 2026-08-04 |
| Last updated | 2026-08-04 |

## 1. Architecture

Use `apps/web` as a small React/Vite host and
`packages/plugins/ui-operator` as the feature implementation. Add a minimal UI
plugin descriptor/registry to `@ever-jobs/plugin`; runtime configuration from
the API determines which statically bundled UI plugins are enabled.

Keep API and worker processes separate. A TypeScript local launcher starts API,
worker, and web development/static servers on loopback. The GUI proxies API and
watcher-status requests and maps “Start watcher” to the existing Resume API.

Extend the watcher domain additively with `notificationRoutes`, a pure route
matcher, a local destination-secret resolver, and a safe configuration-apply
service. Preserve the current outbox, retry, and idempotency boundaries.

## 2. Implementation phases

1. **Contracts and persistence**
   - Add UI plugin, notification route, routing suppression, secret resolver,
     safe-apply request/result, and comparison request/result types.
   - Add the Prisma JSON column and repository parity.
2. **Routing and secrets**
   - Implement pure matching and destination deduplication.
   - Make any non-empty route array authoritative, match only its enabled
     routes, and retain legacy fallback only when routes are absent or empty.
   - Implement mtime-cached `.env.local` and environment resolution, validation,
     atomic mutation, masking, and reference protection.
3. **Operator APIs**
   - Add safe apply, preset list/preview/apply, destination CRUD/test, compare,
     and overview/runtime status endpoints.
   - Reuse watcher, preset, jobs, analytics, registry, and health services rather
     than duplicating domain logic in the browser.
4. **Web application**
   - Build the operator shell, typed client, session auth, overview, watch list
     and editor, activation flow, notifications, matches/history, search,
     analysis, comparison, settings, and downloads.
5. **Local operations**
   - Add Nx and root scripts, loopback host configuration, environment examples,
     Docker Compose GUI profile, and local runbook changes.
6. **Validation and rollout**
   - Add unit/integration/UI/e2e coverage, run all gates, fix regressions, update
     documentation with final evidence, then commit and push if instructed by
     the active workflow.

## 3. Compatibility and migration

- The only database migration adds a default-empty JSON column.
- Old API/CLI/MCP clients remain valid because every new field is optional.
- Existing watches use legacy destinations until routes are configured.
- Environment secrets keep precedence; `.env.local` is a local convenience and
  is already ignored.
- Local host binding is selected by GUI launch scripts and does not change
  container/cloud defaults.

## 4. Risks and mitigations

| Risk                                         | Mitigation                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Route overlap duplicates alerts              | Deduplicate provider/destination before outbox enqueue and retain current idempotency key.              |
| Rollback broadcasts conditional destinations | Store routes separately and keep legacy fallback semantics explicit.                                    |
| Secret disclosure                            | Mask all reads, redact request/error paths, never persist URLs, and test logs/responses/exports.        |
| Unsafe edit produces alert flood             | Optimistic apply, atomic pause, conservative behavior-change classification, baseline, explicit resume. |
| Worker process confused with watch state     | Separate runtime health from per-watch enabled state in UI and copy.                                    |
| All-source comparison overloads sources      | Bounded concurrency, per-source timeout/retry policy, partial results.                                  |
| GUI diverges from CLI/API                    | Typed API client and shared DTO/domain services; no browser-only business rules.                        |

## 5. Validation

Run focused watcher and API unit suites after each backend phase, build the web
app after the complete UI pass, then run lint, full typecheck/build, CLI, API,
watcher, integration/e2e, Playwright, docs lint, migration inspection, and
`git diff --check`. Operational validation uses fake notification endpoints
before an optional real Discord channel test.
