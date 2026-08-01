# Tasks: 6001 — rad.ar Product Branding

> Status legend: `[ ]` pending • `[~]` in-progress • `[x]` done • `[-]` dropped

## Phase 1 — Naming contract and documentation

- [x] T01 — Specify the display-name and compatibility boundary
  - **Files:** `spec.md`, `plan.md`, `tasks.md`, `AGENTS.md`
  - **Acceptance:** `rad.ar` is canonical; stable identifiers are enumerated.
  - **Estimate:** 0.25 day

- [x] T02 — Refresh current public documentation
  - **Files:** `README.md`, current app guides, `docs/index.md`, mirror
  - **Acceptance:** Current entry points use `rad.ar` and link to canonical docs.
  - **Estimate:** 0.25 day

## Phase 2 — Runtime presentation

- [x] T03 — Rename user-visible runtime and metadata strings
  - **Files:** API/MCP/watcher presentation strings, package and tool metadata
  - **Acceptance:** Display strings use `rad.ar`; identifiers and routes are unchanged.
  - **Estimate:** 0.25 day

- [x] T04 — Update presentation regression assertions
  - **Files:** focused API and watcher tests
  - **Acceptance:** Notification branding is asserted as `rad.ar`.
  - **Estimate:** 0.25 day

## Phase 3 — Validation

- [x] T05 — Validate compatibility and documentation
  - **Files:** changed files
  - **Acceptance:** JSON parses, tests/type checks pass, links resolve, and diff is clean.
  - **Estimate:** 0.25 day

## Notes

- Historical specs, logs, generated source notes, package scopes, environment
  prefixes, metrics, protocol IDs, and deployment service names remain unchanged.
