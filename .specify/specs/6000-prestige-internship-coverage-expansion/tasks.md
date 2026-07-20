# Tasks: 6000 — Prestige Internship Coverage Expansion

> Status legend: `[ ]` pending • `[~]` in-progress • `[x]` done • `[-]` dropped

## Phase 1 — Specification and repository audit

- [x] T01 — Allocate the fork feature range and audit current implementation
  - **Files:** `.specify/ranges.json`, `docs/questions.md`, watcher/source/persistence/API/CLI files
  - **Acceptance:** allocator returns 6000; current gaps and Tier 1 source evidence are mapped; ambiguities are logged with defaults.
  - **Estimate:** 0.5 day

- [x] T02 — Complete Spec Kit and documentation discovery artifacts
  - **Files:** `.specify/specs/6000-prestige-internship-coverage-expansion/{spec,plan,tasks}.md`, `docs/specs/6000-prestige-internship-coverage-expansion.md`, `docs/index.md`, `docs/log.md`
  - **Acceptance:** problem, scope/non-goals, contracts, source/geography/identity rules, migration/rollback, full test plan, and ordered tasks are documented before code.
  - **Estimate:** 0.5 day

## Phase 2 — Contracts and shared location behavior

- [x] T03 — Extend source plugin metadata with explicit watch mode
  - **Files:** `packages/plugin/src/interfaces/plugin-metadata.interface.ts`, affected source decorators, plugin tests
  - **Acceptance:** optional board/query mode is discoverable; legacy plugins retain heuristic compatibility; Google Careers and Microsoft explicitly declare mode.
  - **Estimate:** 0.5 day

- [x] T04 — Extend job and watch target contracts additively
  - **Files:** `packages/models/src/dtos/job-post.dto.ts`, `packages/watcher/src/interfaces/watch.types.ts`, exports and tests
  - **Acceptance:** locations, company name, nested search scope, target baseline and health context compile; legacy values remain valid.
  - **Estimate:** 0.5 day

- [x] T05 — Implement shared multi-location normalization and geography classification
  - **Files:** `packages/watcher/src/services/location-normalization.service.ts` (or established shared utility), tests
  - **Acceptance:** all CA provinces/territories, US states/DC, aliases, regional remote, ambiguity, exclusions, and multi-location cases are deterministic.
  - **Estimate:** 1 day

- [x] T06 — Update validation and serialization for new optional fields
  - **Files:** watcher validation, API DTO/helpers, repository mappers, tests
  - **Acceptance:** nested scopes are bounded/validated; dates round-trip; old watch documents inherit watch-level fields.
  - **Estimate:** 0.5 day

## Phase 3 — Persistence, identity, and health state

- [x] T07 — Add additive watcher persistence migration
  - **Files:** `prisma/schema.prisma`, new `prisma/migrations/*/migration.sql`
  - **Acceptance:** normalized location arrays, canonical episode key, target context/baseline/health state and indexes are additive and deployable.
  - **Estimate:** 1 day

- [x] T08 — Keep Prisma and in-memory repository parity
  - **Files:** watcher persistence adapters and their tests
  - **Acceptance:** new fields round-trip, legacy defaults work, target health updates are atomic enough for one completed run.
  - **Estimate:** 1 day

- [x] T09 — Implement source-independent canonical episode identity
  - **Files:** `job-fingerprint.service.ts`, pipeline/repository tests
  - **Acceptance:** employer-URL, publication-date, and observation-anchored rolling 14-day fallback algorithms are deterministic across source/location order; UTC calendar boundaries do not split an episode.
  - **Estimate:** 0.5 day

- [x] T10 — Key matches and deliveries by canonical episode
  - **Files:** watch execution, repositories, dispatcher, migration/indexes, tests
  - **Acceptance:** multiple observations produce one match/destination delivery; richer observations and notification-type changes update without resending.
  - **Estimate:** 1 day

- [x] T11 — Persist and expose per-target health transitions
  - **Files:** execution/repositories/metrics contracts and tests
  - **Acceptance:** success/failure/empty/partial counters, timestamps, non-hard-outcome reset, and three-failure Tier 1 degradation survive restart.
  - **Estimate:** 1 day

## Phase 4 — Planning, execution, eligibility, and initialization

- [x] T12 — Make metadata/target context authoritative in planning
  - **Files:** `watch-source-planner.service.ts`, tests
  - **Acceptance:** explicit mode, target scope/name/baseline/tier context and legacy inheritance are preserved in derived targets.
  - **Estimate:** 0.5 day

- [x] T13 — Build bounded rotating search-term × location matrices
  - **Files:** planner and scheduler/run-state tests
  - **Acceptance:** full matrix, budgets, stable request IDs, country forwarding, rotation completeness, and no permanent starvation are tested.
  - **Estimate:** 1 day

- [x] T14 — Preserve request target context through executor results
  - **Files:** `jobs-service-watch.executor.ts`, jobs service bridge, execution tests
  - **Acceptance:** successes, empty results and failures remain attributable per target/request; partial failures cannot become zero-success runs.
  - **Estimate:** 1 day

- [x] T15 — Separate internship/geography eligibility from ranking
  - **Files:** `job-scoring.service.ts`, execution pipeline, tests
  - **Acceptance:** title/structured-type role gate, Tier geography, unknown suppression, discipline families, senior exclusions, and preference-only city score pass.
  - **Estimate:** 1 day

- [x] T16 — Extend score explanations and persisted match context
  - **Files:** watcher types/scoring/persistence/public DTOs and tests
  - **Acceptance:** target key, country, confidence and geography decision are visible through stored/API/CLI match output.
  - **Estimate:** 0.5 day

- [x] T17 — Add per-target baseline initialization to REST and CLI
  - **Files:** watches controller/DTO, watch command, execution/repository logic, tests
  - **Acceptance:** repeatable target keys initialize only successful selected targets; omitted keys preserve current all-target behavior.
  - **Estimate:** 1 day

## Phase 5 — Tier 1 company and ATS sources

- [x] T18 — Repair Google Careers official listing/detail integration
  - **Files:** `packages/plugins/source-company-google`, fixtures/tests
  - **Acceptance:** official URLs, stable IDs, real dates, all locations, Canadian search inputs, bounds, pagination and hard failures are fixture-tested.
  - **Estimate:** 1 day

- [x] T19 — Add and register Shopify company source
  - **Files:** `packages/plugins/source-company-shopify`, Site enum, plugin index, TS/Jest aliases, fixtures/tests
  - **Acceptance:** all four registrations exist; official server-rendered listings/details map JID, disciplines, locations/remote and failure states.
  - **Estimate:** 1 day

- [x] T20 — Add Wealthsimple Ashby target and regression fixture
  - **Files:** default preset, Ashby tests/fixtures as needed
  - **Acceptance:** `ashby:wealthsimple` carries official slug/name, uses maintained plugin, preserves locations, and remains Canada-post-filtered.
  - **Estimate:** 0.5 day

- [x] T21 — Audit and gate every v2 Tier 1 target for Canada-wide coverage
  - **Files:** preset, source fixtures/tests, docs audit table
  - **Acceptance:** each enabled target demonstrates Canada-wide query or post-filter behavior; every unproven target is disabled with reason.
  - **Estimate:** 1 day

## Phase 6 — Tier 2/3 redundant sources

- [x] T22 — Repair Google Jobs public search integration
  - **Files:** `packages/plugins/source-google`, fixtures/tests
  - **Acceptance:** CA/US search inputs, stable mapping, external employer URLs, pagination/bounds and blocked/malformed hard failures pass.
  - **Estimate:** 1 day

- [x] T23 — Harden LinkedIn public guest integration
  - **Files:** `packages/plugins/source-linkedin`, fixtures/tests
  - **Acceptance:** unauthenticated newest/recent CA/US search, coarse detail gating, external URL extraction, bounds, block/malformed hard failures pass.
  - **Estimate:** 1 day

- [x] T24 — Validate redundancy and partial failure end-to-end
  - **Files:** watcher integration/e2e tests
  - **Acceptance:** direct/Google/LinkedIn duplicate creates one notification; eligibility-suppressed matches can promote once on richer evidence; sent/baseline matches cannot reopen; same-fingerprint 14-day rollover creates a new episode; failed source produces partial run without losing siblings.
  - **Estimate:** 1 day

## Phase 7 — Preset, observability, and documentation

- [x] T25 — Create the versioned v2 preset and safe seeding behavior
  - **Files:** watcher preset/default/seeder services and tests
  - **Acceptance:** specified tier/cadence/source/scope set seeds disabled/uninitialized; legacy seed compatibility remains.
  - **Estimate:** 0.5 day

- [x] T26 — Add dry-run-first paused-watch preset apply CLI
  - **Files:** watch command, preset merge service, CLI tests
  - **Acceptance:** preview is side-effect free; apply requires paused watch and preserves destinations/thresholds/history/operator edits while identifying changed baselines.
  - **Estimate:** 1 day

- [x] T27 — Extend health endpoints, run summaries, and Prometheus metrics
  - **Files:** watcher metrics, app health controller, API metrics/helpers, tests
  - **Acceptance:** per-target counters/timestamps and aggregate Tier 1 degraded state are public and secret-safe.
  - **Estimate:** 1 day

- [x] T28 — Add/deprecate examples and update public contracts
  - **Files:** `examples`, `README.md`, `tool_manifest.json`, `.env.example`
  - **Acceptance:** Canada/USA v2 example exists, Toronto example remains with deprecation, source matrix and initialize/preset contracts are accurate.
  - **Estimate:** 0.5 day

- [x] T29 — Update watcher guides and alert runbooks
  - **Files:** `apps/watcher/README.md`, local/cloud runbooks, docs index/log/spec mirror
  - **Acceptance:** disabled smoke, baseline/two-cycle rollout, degraded/collapse alerts, per-target rollback and LinkedIn limitations are executable and indexed.
  - **Estimate:** 0.5 day

## Phase 8 — Validation and rollout record

- [x] T30 — Run focused deterministic validation
  - **Files:** affected package/API/CLI tests and TypeScript projects
  - **Acceptance:** Prisma validation/generation, focused source/watcher/API/CLI tests and relevant builds pass; no live dependency exists in CI.
  - **Estimate:** 0.5 day

- [x] T31 — Run repository validation and diff checks
  - **Files:** repository lint/build/docs-lint and git diff/status
  - **Acceptance:** docs lint, lint, build, relevant suites and diff hygiene pass or exact pre-existing failures are recorded.
  - **Estimate:** 0.5 day

- [~] T32 — Complete disabled operational smoke and observation gate
  - **Files:** runtime validation record only
  - **Acceptance:** authorized live smoke classifies every source result/failure, normalized locations/URLs are inspected, changed targets baseline, and two Tier 1 cycles complete before notifications.
  - **Estimate:** 0.5 day

## Notes

- No CI test performs live third-party I/O.
- T32 source smokes are recorded: Google Careers two Canadian roles, Shopify
  valid empty board, Wealthsimple 37 roles/capped sample, LinkedIn public pass,
  Microsoft timeout, and Google Jobs classified blocked. Target baselines and
  two no-notification observation cycles remain pending before resume.
- T31 broad validation is recorded exactly: the Nx lint command exited zero
  with no configured lint tasks; two repository-wide Nx build attempts (normal
  and daemon/cache-disabled) produced no task output and stalled until bounded
  termination. Direct TypeScript compilation passed for every affected app,
  package, and source, Prisma validate/generate passed, focused tests passed,
  and `git diff --check` passed. Documentation lint reports only the two
  pre-existing Spec 5024 H1/metadata defects.
- Final edge validation passed both persistence suites (9 tests) and the watcher
  execution pipeline (11 tests). Direct watcher, Google Jobs, and LinkedIn
  TypeScript checks passed, and the independent re-review found no remaining
  high/medium issue in rollover or suppression-promotion behavior.
- Update `docs/log.md` newest-first and mark tasks accurately as work completes.

## Phase 9 — Summer 2027 and LinkedIn priority refinement

- [x] T33 — Amend the policy specification before code
  - **Files:** Spec 6000 `spec.md`, `plan.md`, `tasks.md`, mirror, `docs/questions.md`
  - **Acceptance:** Summer 2027, contextual PhD suppression, Tier 1 company derivation, LinkedIn cap, non-goals, risks, and test plan are explicit before implementation.
  - **Estimate:** 0.25 day

- [x] T34 — Implement season and degree eligibility
  - **Files:** `job-scoring.service.ts`, `job-scoring.service.spec.ts`
  - **Acceptance:** Summer 2027 spellings qualify; other/missing terms suppress; PhD titles and explicit degree enrollment requirements suppress; incidental PhD colleague text remains eligible.
  - **Estimate:** 0.5 day

- [x] T35 — Implement Tier 1-aware LinkedIn score cap
  - **Files:** `job-scoring.service.ts`, `job-scoring.service.spec.ts`
  - **Acceptance:** non-Tier-1 LinkedIn totals are at most `urgentScore - 1`; Tier 1 LinkedIn and non-LinkedIn results retain uncapped totals; explanations identify the cap.
  - **Estimate:** 0.5 day

- [x] T36 — Narrow and mirror the v2 preset
  - **Files:** `prestige-internships-v2.preset.ts`, preset tests, Canada/USA example
  - **Acceptance:** all 19 query families explicitly target Summer 2027, PhD exclusions are visible, and parsed example equals the factory.
  - **Estimate:** 0.25 day

- [x] T37 — Update operator documentation and validate
  - **Files:** watcher README, Spec 6000 mirror, docs index/log/questions, focused tests/build/diff
  - **Acceptance:** deployment/baseline behavior is documented; focused suites and TypeScript checks pass; remaining external/pre-existing blockers are recorded.
  - **Estimate:** 0.5 day
