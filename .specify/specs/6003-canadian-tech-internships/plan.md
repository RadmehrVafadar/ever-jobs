# Plan: 6003 — Canadian Tech Internships

| Field | Value |
| --- | --- |
| Spec | `spec.md` |
| Created | 2026-08-10 |
| Last updated | 2026-08-10 |

## Approach

Replace the single registered watcher preset with a canonical Toronto/GTA-only
implementation. Keep the old source module as a deprecated alias layer, so
existing imports remain build-compatible, but expose only the new ID through
runtime preset discovery. Add explicit preset field-application policies so
geography can be replaced while all other operator-owned list fields retain the
existing merge behavior.

## Phase 1 — Specification and contracts

1. Add Spec 6003 `spec.md`, `plan.md`, and `tasks.md` before source changes.
2. Add the human-readable spec mirror, documentation index entry, and newest
   changelog entry.
3. Extend `WatchPresetDefinition` with optional location/country-code apply
   policies that default to merge.
4. Extend preset field diffs with removed locations and country codes.

## Phase 2 — Canonical preset

1. Add `canadian-tech-internships.preset.ts` as the canonical factory.
2. Reuse the existing target-company, search-term, required/preferred/excluded
   term, scoring, notification, source target, cadence, and request-cap data.
3. Replace every broad Canada/USA location scope with the ordered Toronto/GTA
   list and replace all target country scopes with `CA`.
4. Register only the new preset in `WatchPresetService`.
5. Update default seeding and default-watch exports to use the new factory.
6. Convert the old preset module to deprecated aliases without registering its
   former string ID.

## Phase 3 — Apply behavior and examples

1. Make `WatchPresetService` honor field-specific replacement policy.
2. Report geography removals in preview results.
3. Preserve term/company merges, watch identity, notifications, thresholds,
   operator-only targets, and existing pause/baseline safety.
4. Add the canonical API-compatible JSON example.
5. Retain legacy example paths as deprecated compatibility files, aligned to
   the safe Canadian configuration where practical.

## Phase 4 — User-facing surfaces

1. Add `npm run gui:dev` near the README introduction and update current preset
   documentation to Canadian Tech Internships.
2. Update GUI labels, OpenAPI summaries, CLI reference, watcher guides,
   runbooks, upgrade guide, API changelog, and machine-readable manifest.
3. Preserve historical changelog/spec language where it describes the former
   release rather than current instructions.

## Phase 5 — Tests and verification

1. Update preset, seeder, coverage, scoring, and API controller fixtures to use
   canonical names.
2. Add assertions for exact GTA locations, CA-only target scopes, old-ID
   rejection, and removal diffs/apply behavior.
3. Run focused watcher/API/web tests and TypeScript builds.
4. Run documentation validation and whitespace checks, recording any unrelated
   pre-existing failures without changing their scope.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Applying the preset leaves `US` in an old watch | Explicit replace policy plus removed-field tests |
| Existing imports break after file/name change | Deprecated aliases in the former module and default-watch barrel |
| Existing database watches change unexpectedly | Seeder remains fresh-install-only; no automatic migration |
| Narrow location names cause more target requests | Existing per-target request caps remain; planner tests verify bounded behavior |
| Docs continue advertising the retired template | Focused repository search and current-surface updates; historical records retained |

## Rollout

1. Deploy code without database migration.
2. Fresh installations seed the new disabled watch.
3. Existing operators preview and apply the new preset to a paused watch.
4. Initialize all changed enabled targets without notification.
5. Review partial failures and baseline matches, then explicitly resume.

## Rollback

Restore the former preset registration and documentation. No schema rollback is
needed. Existing Canadian-only watches remain valid and may be edited or
re-applied by an operator.
