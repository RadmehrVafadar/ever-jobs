# Plan 6004 — Canadian Employer Internship Coverage

| Field | Value |
| --- | --- |
| Spec | `spec.md` |
| Created | 2026-08-12 |
| Last updated | 2026-08-12 |

## Phase 1 — Watch Contracts

Add source modes and company URLs to watcher targets, propagate both through validation/planning/execution, implement bounded term-only `board-search`, and persist role families with legacy defaults. Add the new preset while sharing existing technology-company target definitions.

## Phase 2 — Shared ATS Coverage

Make Workday honor `searchText`; harden iCIMS for KPMG student listings; add vanity-domain, pagination, search, detail, and direct-URL support to SuccessFactors. Surface positive-count/zero-parse conditions as typed extraction errors.

## Phase 3 — New Sources

Add a reusable Yello ATS package for EY and a dedicated official-feed Accenture Canada package. Register both in the enum, global source module list, TypeScript aliases, and Jest mappings.

## Phase 4 — Product Surface and Operations

Expose target modes, company URLs, and role families in API/web types. Add the opt-in live smoke command and update manifest, README, CLI examples, runbook, documentation index, log, and company slug directory where appropriate.

## Phase 5 — Verification and Rollout

Run deterministic adapter, watcher, API, persistence, and preset tests. Then run lint, build, integration/e2e, and opt-in smoke checks. Apply the new preset only through explicit operator action, initialize all new target keys in baseline mode, inspect health, and leave it disabled until enabled by an operator.

## Risks

- ATS layout drift: fixtures plus extraction-count failures prevent silent false-empty success.
- Large boards: server-side search, two-request rotation, and a 25-result per-request cap bound traffic and enrichment within the watcher deadline.
- Compatibility: all additions are optional and legacy defaults retain existing scoring behavior.
- Multi-board brands: stable site+slug keys preserve independent health while companyName groups coverage.
