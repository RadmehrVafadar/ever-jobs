# Plan 6005 — Watch Default Inheritance

| Field | Value |
| --- | --- |
| Spec | `spec.md` |
| Created | 2026-08-13 |
| Last updated | 2026-08-13 |

## Phase 1 — Sparse Contracts and Validation

Make configured target cadence optional and target geography independently
optional. Update Zod validation without materializing defaults. Add unit tests
for compact and legacy expanded watch documents.

## Phase 2 — Effective Runtime Resolution

Centralize effective target interval resolution and use it consistently in
source planning, due checks, target `nextRunAt` advancement, request rotation,
and next watch scheduling. Retain a complete resolved planner target type so
source executors do not handle optional runtime values.

## Phase 3 — Compact Presets

Refactor Canadian internship preset helpers so shared interval, country codes,
and locations live at watch level. Keep only intentional target overrides and
target-local term/request settings. Prove effective plans and company coverage
remain unchanged.

## Phase 4 — Operator GUI and JSON Round-trip

Update browser types/import validation and source-target editing. Present
watch-level defaults to the target editor, allow independent overrides and
reset-to-default actions, and keep JSON import/download sparse.

## Phase 5 — Documentation and Verification

Update the human spec mirror, watch runbook/example, documentation index,
append-only log, and ambiguity ledger. Run focused unit/component/API tests,
watcher and web builds, broader affected suites where practical, docs lint, and
`git diff --check`.

## Risks and Mitigations

- **Cadence divergence:** multiple scheduling paths currently read target cadence
  directly. Use one effective-interval helper and add advancement/due-date tests.
- **Accidental compatibility compaction:** never remove explicit values from
  persisted user watches merely because they match current defaults. Compact
  only generated preset definitions and values the GUI explicitly restores to
  inheritance.
- **Partial-scope regressions:** keep the resolved planner shape complete and
  test a target that supplies only search terms/request budget.
- **Concurrent worktree edits:** preserve the existing Spec 6002/notification
  editor changes and limit overlapping documentation edits to additive entries.
- **Spec numbering:** this fork has no range entry; Q-080 records the use of the
  next collision-free local 6000-series number.

## Rollback

The contract is additive. If runtime issues appear, explicit values remain
accepted and can be restored to generated presets without a database migration.
Reverting GUI inheritance controls does not invalidate expanded legacy JSON.
