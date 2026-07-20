# Plan: 6000 — Prestige Internship Coverage Expansion

| Field        | Value            |
| ------------ | ---------------- |
| Spec         | [spec.md](spec.md) |
| Status       | in-progress      |
| Owner        | Ever Jobs maintainers |
| Created      | 2026-07-19       |
| Last updated | 2026-07-20       |

## 1. Approach

Implement this as an additive evolution of `@ever-jobs/watcher`, the existing
source plugin contracts, and the current PostgreSQL/in-memory repositories. No
parallel watcher or source registry is introduced. Begin with public TypeScript
contracts and a location/geography utility so sources and pipeline code share one
representation. Preserve singular location behavior at every boundary and treat
the new array as the lossless representation.

Make target context the execution unit. The persisted watch target owns its tier,
scope, company branding, cadence, next-run time, and baseline. The planner derives
effective values from target fields first and watch-level legacy fields second,
uses plugin metadata for board/query mode, and constructs a stable matrix. The
executor returns target-attributed results/errors so pipeline scoring and health
never infer context from a job's source string.

Move geography from a scoring prerequisite hidden inside generic text matching
to an explicit eligibility decision. A shared parser returns normalized
locations, country candidates, regional-remote meaning, confidence, and reason.
The scoring service consumes that decision, requires title/structured internship
evidence, and applies Toronto/GTA/Waterloo only as positive ranking signals.

Extend fingerprinting into two identities: the existing source observation
fingerprint and a canonical episode key. The repository retains observations,
upserts a watch match by canonical episode, and makes delivery uniqueness use the
canonical episode plus destination. A later observation can enrich the shared
match while the delivery unique key prevents resends.

Repair sources only through official/public surfaces and the shared HTTP client.
Google Careers, Shopify, Google Jobs, and LinkedIn receive sanitized listing and
detail fixtures plus explicit blocked/malformed fixtures. Wealthsimple stays an
Ashby target. A source is enabled in the v2 preset only when tests demonstrate
stable identity, location fidelity, bounds, and hard-failure propagation.

Finish with per-target health persistence, targeted initialization, preset
preview/apply, documentation, migration validation, and focused-to-broad tests.
Operational live smoke is recorded separately from deterministic CI. The final
source pass completed six deterministic suites (59 tests) and disabled live
smokes: Google Careers returned two Canadian roles, Shopify returned a
marker-validated valid empty board, Wealthsimple returned 37 public roles with a
capped mapped sample, and LinkedIn public guest passed. Google Jobs was correctly
classified blocked by an enable-JavaScript shell, and Microsoft timed out.

The shipped preset is globally disabled and uninitialized. Google Careers,
Shopify, Ashby `wealthsimple`, Ashby `plaid`, Canada Job Bank, and LinkedIn are
target-enabled inventory; Google Jobs, Microsoft, and the remaining unproven
legacy direct sources are target-disabled. Target-enabled does not enable polling
or notifications while the watch is paused. Targeted baselines and two
no-notification observation cycles remain required before resume.

The 2026-07-20 policy refinement stays inside the existing watcher package and
does not add a new source or runtime dependency. The preset narrows query terms
to Summer 2027. The scoring eligibility phase adds deterministic season and
degree gates, then applies a post-breakdown LinkedIn cap when the normalized
employer is not represented by a Tier 1 target company name. Component scores
remain explainable; only the final aggregator priority is bounded.

## 2. Phases

### Phase 1 — Specification and audit

- Goal: establish collision-free feature identity and map current contracts,
  source behavior, persistence, health, CLI/API, and documentation.
- Deliverables: Spec Kit artifacts, mirror, questions entry, index/log updates,
  source/Tier 1 audit record.
- Exit criteria: `spec.md`, `plan.md`, and `tasks.md` are complete before code.

### Phase 2 — Additive contracts and location model

- Goal: define metadata mode, target scope/context, location arrays, geography
  results, and compatible validation/serialization.
- Deliverables: model/plugin/watcher types, shared parser, unit tests.
- Exit criteria: legacy and new documents both validate and round-trip.

### Phase 3 — Persistence, canonical identity, and target health

- Goal: store new target/job state and deduplicate cross-source episodes.
- Deliverables: additive Prisma migration, repository parity, canonical key and
  outbox identity changes, health counters and tests.
- Exit criteria: migration applies; three observations create one match/delivery.

The URL/date-less canonical fallback is a first-observation-anchored rolling
14-day episode persisted with the match; it is not a UTC calendar bucket.
Delivery uniqueness is watch + canonical episode + channel/destination and
deliberately excludes notification type, so score-band changes cannot resend.

### Phase 4 — Planner, execution, eligibility, and initialization

- Goal: make target context and bounded location/term matrices authoritative.
- Deliverables: planner rotation, attributed executor results, explicit geography
  eligibility, scoring explanation, targeted REST/CLI initialization.
- Exit criteria: required geography scenarios and partial failure behavior pass.

### Phase 5 — Official company/ATS sources

- Goal: repair Google Careers, add Shopify, and configure Wealthsimple.
- Deliverables: plugin code/registration, fixtures, mapping/failure tests, Tier 1
  Canada-wide audit and enablement decisions.
- Exit criteria: no enabled Tier 1 source relies on Toronto-only behavior or
  silently converts failures to empty success.

### Phase 6 — Redundant Google Jobs and LinkedIn sources

- Goal: provide public, bounded Tier 2/3 redundancy.
- Deliverables: hardened plugins, external apply URL extraction, newest/recent
  LinkedIn behavior, fixture/block/failure tests.
- Exit criteria: CA/US forwarding and hard failure propagation are verified.

### Phase 7 — Preset, health, metrics, and operations

- Goal: make expansion safely deployable and observable.
- Deliverables: v2 preset, Canada/USA example, deprecated old example, dry-run
  preset apply, target health endpoint/run/metrics/Prometheus output, alerts.
- Exit criteria: upgrade preserves operator state and degraded Tier 1 is visible.

### Phase 8 — Validation and rollout record

- Goal: verify deterministic behavior and document live rollout gates.
- Deliverables: docs lint, focused suites/builds, repo lint/build, migration check,
  diff review, disabled smoke record when network is authorized.
- Exit criteria: all in-scope checks pass or exact external/pre-existing blockers
  are documented; notification enablement remains operator-controlled.

Deterministic source validation and source smokes are complete. Repository-wide
validation and the target baselines/two observation cycles remain the open exit
work; Google Jobs and legacy-source live failures remain safely target-disabled.

### Phase 9 — Summer 2027 and LinkedIn priority refinement

- Goal: make the production preset season-specific and keep non-Tier-1 LinkedIn
  discoveries out of the urgent/max band while retaining useful lower-band matches.
- Deliverables: amended Spec Kit contracts, preset/example query terms, contextual
  PhD gate, Summer 2027 gate, Tier 1 company derivation, LinkedIn cap, tests, and
  watcher/operator documentation.
- Exit criteria: focused watcher tests prove every positive/negative policy case;
  preset/example parity and TypeScript compilation pass; the changed LinkedIn
  target is baselined after deployment before the watch resumes.

## 3. Packages and files touched

| Area | Change |
| ---- | ------ |
| `.specify`, `docs` | Spec/plan/tasks, mirror, index/log/questions, watcher/runbook/source-matrix updates. |
| `packages/models` | `JobPostDto.locations`, `Site.SHOPIFY`, shared exports/tests. |
| `packages/plugin` | optional `watchMode` metadata contract and discovery tests. |
| `packages/common` | shared location parsing only if no suitable models/watcher utility exists; HTTP remains the only external I/O path. |
| `packages/watcher` | target/search/health contracts, planner, executor, scoring, identity, repositories, presets, metrics, tests. |
| `prisma` | additive columns/indexes/migration for target JSON-derived state or normalized watcher entities. |
| `packages/plugins/source-company-google` | official results/detail repair and fixtures. |
| `packages/plugins/source-company-shopify` | new source package and fixtures. |
| `packages/plugins/source-google` | Google Jobs repair and fixtures. |
| `packages/plugins/source-linkedin` | public guest hardening and fixtures. |
| `packages/plugins/source-ats-ashby` | compatibility/fixture assertion for Wealthsimple target, not a forked implementation. |
| `packages/plugins/index.ts`, `tsconfig.base.json`, `jest.config.js` | Shopify source registration. |
| `apps/api` | targeted initialization DTO/controller and target health serialization. |
| `apps/cli` | repeatable initialize targets and dry-run-first preset apply. |
| `apps/watcher` | aggregate health output and runbook-facing metrics. |
| `examples`, `README.md`, `tool_manifest.json`, `.env.example` | preset/example/source/contract/operator documentation. |

## 4. Dependencies

| Library | Version | Rationale |
| ------- | ------- | --------- |
| Existing Cheerio | repository version | Parse official server-rendered listing/detail HTML. |
| Existing Zod | repository version | Validate embedded/public payload shapes before mapping. |
| Existing Axios/common HTTP client | repository version | Required timeout/retry/UA/redaction path. |
| Existing Prisma | repository version | Additive durable watcher state and migration. |
| Existing Jest/Supertest | repository version | Fixture/unit/integration/API/CLI validation. |

No new runtime dependency is planned. If an official surface requires one, use
the latest stable version and record the change in `docs/log.md`.

## 5. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Official HTML/embedded schema changes | H | H | Required structure validation, sanitized fixtures, classified hard failures, disabled smoke gate. |
| Query matrix causes excessive requests | M | H | Per-target cap, bounded global concurrency, deterministic rotation, max results/detail budget. |
| Location false positive admits wrong geography | M | H | Structured parser, confidence, explicit exclusions, unknown suppression, extensive jurisdiction tests. |
| Location false negative drops Canadian role | M | H | Multi-location parsing, full province/territory aliases, Canada-wide fixtures, preference/eligibility separation. |
| Cross-source identity merges distinct roles | M | H | Company/title/location/employer URL composition; publication/episode fallback; collision tests. |
| Cross-source identity fails to merge tracking/redirect variants | M | M | Canonical external employer URL extraction and tracking normalization. |
| Schema migration disrupts existing rows | L | H | Nullable/additive columns, deterministic backfill-on-read/write, no destructive constraints. |
| Preset overwrites operator changes | M | H | Paused-watch requirement, dry-run default, field-level merge, explicit preservation tests. |
| LinkedIn blocks guest requests | H | M | Best-effort classification, no bypass/auth, degraded visibility, Tier 3 redundancy only. |
| Empty board mistaken for block | M | H | Validate page/payload markers before accepting `[]`; separate empty vs hard failure fixtures. |
| Generic postings omit the season while representing Summer 2027 | M | M | Persist with explicit `not-summer-2027` suppression; operators can inspect the observation and revise Q-076 if broader recall is preferred. |
| Incidental PhD text causes false suppression | M | M | Titles use a direct degree gate; descriptions require student/candidate/enrollment/pursuit/program context and have negative tests. |
| Company aliases evade Tier 1 matching | M | M | Normalize case/punctuation and accept a configured Tier 1 brand only at the start of the source company name; retain a deterministic cap when uncertain. |

## 6. Rollback plan

- Pause the watch and disable an individual failing target through normal watch
  configuration; do not delete observations, matches, health, or migrations.
- Reapply the prior target set using preset preview or manual PATCH while
  preserving target baseline/history.
- Leave additive columns/types and singular-location compatibility in place.
- If a source surface regresses, keep its package registered but disabled and
  document the failure; do not fall back to stale/private endpoints.
- Notifications remain disabled until the operator completes baseline and two
  Tier 1 observation cycles.

## 7. Migration plan

1. Deploy additive schema and generated Prisma client before enabling v2 targets.
2. Existing rows read missing arrays/keys/health fields with compatibility
   defaults; new writes populate both singular and array location forms.
3. Apply `prestige-internships-v2` in dry-run mode to a paused watch.
4. Review target diff and keep any unproven Tier 1 source disabled.
5. Apply explicitly, targeted-initialize only added/materially changed enabled
   targets, inspect jobs/URLs/health, then run two no-notification observation
   cycles (including both Tier 1 cycles).
6. Resume and enable notifications only after operator approval.
7. For this policy refinement, deploy/build first, preview the preset while paused,
   apply the materially changed Summer 2027 search scopes, baseline the changed
   enabled query targets, inspect suppressed examples, and only then resume.

## 8. Open questions for plan

- The fork range ambiguity is recorded as Q-073 with default A proceeding.
- Any live source divergence or incomplete Tier 1 evidence discovered during
  implementation is added to `docs/questions.md`; the safe default is disabled.
- Summer strictness, PhD description context, and LinkedIn Tier 1 score treatment
  are recorded as Q-076 through Q-078 with the documented defaults proceeding.
