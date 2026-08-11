# Tasks: 6002 — Local Operator GUI and Notification Routing

## Phase 1 — Specification

- [x] T01 — Write `spec.md`, `plan.md`, and `tasks.md` before application code.
- [x] T02 — Add the human mirror and update docs index, log, questions, API
      changelog, CLI guide, and watcher runbook.

## Phase 2 — Contracts and persistence

- [x] T03 — Add `IUiPlugin` metadata/route contracts and a runtime registry.
  - **Acceptance:** duplicate IDs/routes fail deterministically and disabled
    plugins are omitted from runtime configuration.
- [x] T04 — Add notification route and routing suppression domain contracts.
  - **Acceptance:** old `JobWatch` objects remain valid.
- [x] T05 — Add the default-empty Prisma JSON column and repository mappings.
  - **Acceptance:** Prisma and in-memory repositories round-trip routes and
    existing rows map to an empty array.

## Phase 3 — Routing and destination secrets

- [x] T06 — Implement the pure notification routing matcher.
  - **Acceptance:** tier/type/score truth table, catch-all, unknown-tier, disabled,
    and overlap-deduplication tests pass.
- [x] T07 — Integrate routes with dispatch, retry, and suppression.
  - **Acceptance:** routes take precedence when enabled, legacy fallback remains,
    no-match is suppressed as routing, and idempotency is unchanged.
- [x] T08 — Implement local/environment Discord secret resolution.
  - **Acceptance:** deterministic aliases, environment precedence, URL
    validation, mtime reload, atomic writes, masking, and redaction are tested.

## Phase 4 — Operator APIs

- [x] T09 — Add destination list/create-rotate/delete/test endpoints.
  - **Acceptance:** endpoints are admin-authenticated, never return secrets, and
    reject deletion while referenced.
- [x] T10 — Add optimistic safe watch apply.
  - **Acceptance:** stale update is 409; behavior changes atomically pause and
    return baseline targets; metadata/routing-only changes retain state.
- [x] T11 — Add preset list/preview/apply REST endpoints.
  - **Acceptance:** responses and pause rules match `WatchPresetService`.
- [x] T12 — Add bounded source comparison and operator overview/status APIs.
  - **Acceptance:** partial failures preserve successes and error text is
    sanitized.

## Phase 5 — Local web application

- [x] T13 — Scaffold the React/Vite `apps/web` host and `ui-operator` plugin.
  - **Acceptance:** TypeScript build succeeds and runtime plugin configuration
    controls navigation.
- [x] T14 — Implement shell, session API-key handling, overview, and health.
- [x] T15 — Implement watches, profile builder, JSON import/export, diff/apply,
      baseline review, and explicit resume.
- [x] T16 — Implement notification destinations, route builder, tests, and
      delivery history.
- [x] T17 — Implement matches, observed jobs, run detail, metrics, and coverage.
- [x] T18 — Implement search, analytics, comparison, job detail, and JSON/CSV
      downloads.
- [x] T19 — Complete responsive and accessible interaction states.

## Phase 6 — Packaging and operations

- [x] T20 — Add Nx projects, package/path/Jest wiring, and root `gui:dev`/`gui`
      TypeScript launchers.
- [x] T21 — Add optional Docker Compose GUI service/secret mount and environment
      examples without renaming compatibility resources.

## Phase 7 — Validation

- [x] T22 — Add backend unit and integration tests.
- [ ] T23 — Add React component and Playwright end-to-end tests with fake source
      and Discord endpoints.
  - **Partial evidence:** 6 Vitest files / 19 tests and one route-mocked
    Playwright scenario pass. The full PostgreSQL plus fake-source/fake-Discord
    end-to-end scenario remains outstanding.
- [ ] T24 — Run lint, typecheck/build, watcher/API/CLI/integration/e2e suites,
      docs lint, migration validation, and `git diff --check`; record exact evidence
      in this ledger and `docs/log.md`.
  - **Partial evidence:** 18 focused Jest suites / 103 tests, 6 web Vitest files /
    19 tests, the 14-test CLI
    suite, API/web/watcher TypeScript checks and builds, Prisma validation,
    desktop/mobile browser inspection, and `git diff --check` pass.
  - **Remaining blockers:** ESLint cannot run because the repository has no
    ESLint configuration. Documentation lint reaches only pre-existing
    repository failures; neither gate is recorded as passing for Spec 6002.
- [ ] T25 — Perform local operational smoke: one-command startup, legacy watch,
      safe apply/baseline/resume, tier routing, worker interruption status, restart,
      and duplicate protection.
  - **Blocked:** Docker is unavailable and local PostgreSQL port 5432 is closed,
    so the real-stack operational acceptance scenario has not run.
