# Tasks: 6003 — Canadian Tech Internships

## Phase 1 — Specification

- [x] T01 — Write `spec.md`, `plan.md`, and `tasks.md` before code changes.
- [x] T02 — Add the docs mirror, index, log, API changelog, CLI guide, README,
      manifest, watcher guides, and upgrade notes.

## Phase 2 — Preset implementation

- [x] T03 — Add the canonical `canadian-tech-internships` preset with retained
      companies and term filters.
  - **Acceptance:** one disabled revision-1 preset has the exact required name,
    terms, target inventory, scoring, and cadence.
- [x] T04 — Make every preset-owned scope Toronto/GTA and CA-only.
  - **Acceptance:** neither `US`, `United States`, broad `Canada`, nor Waterloo
    appears in canonical watch or target geography, and unexpected U.S. results
    are ineligible even on Tier 2/3 targets.
- [x] T05 — Register and seed only the new template while retaining deprecated
      TypeScript compatibility aliases.
  - **Acceptance:** preset list exposes one canonical ID; fresh seed uses the new
    name; old imports compile.
- [x] T06 — Add preset geography replacement and removal-diff behavior.
  - **Acceptance:** applying to a paused legacy watch removes U.S. geography,
    retains operator-owned non-geographic configuration, and requires baseline
    initialization for materially changed enabled targets.

## Phase 3 — Examples and surfaces

- [x] T07 — Add and validate the canonical JSON example; mark legacy examples
      deprecated without deleting them.
- [x] T08 — Update the GUI preset wording and API description.
- [x] T09 — Update current README, CLI, watcher, runbook, upgrade, manifest, and
      changelog guidance.

## Phase 4 — Verification

- [x] T10 — Update and pass preset, seeder, coverage, scoring, and API tests.
- [x] T11 — Pass watcher/API/web TypeScript checks or builds.
- [x] T12 — Run documentation lint and `git diff --check`; document any
      unrelated pre-existing failures.

## Validation evidence

- Focused watcher Jest: 7 suites, 105 tests passed.
- Focused API Jest: 2 suites, 21 tests passed.
- Web Vitest: 6 files, 19 tests passed.
- Watcher and API TypeScript checks passed; the web TypeScript/Vite production
  build passed.
- `git diff --check` passed.
- Documentation lint recognizes the Spec 6003 metadata and links. The command
  remains non-zero only for four pre-existing duplicate 2026-07-20 log entries
  and the pre-existing Spec 5024 files missing metadata tables.
