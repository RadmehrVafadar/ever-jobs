# Spec 6004 — Canadian Employer Internship Coverage

| Field | Value |
| --- | --- |
| Status | Implemented |
| Owner | rad.ar |
| Date | 2026-08-12 |
| Related specs | 6000, 6003 |

## Problem

The `canadian-tech-internships` preset covers a strong technology-company cohort but leaves Canada's Big Five banks explicitly deferred, omits high-volume employers such as KPMG, and admits only a narrow set of engineering titles. Large official employer boards can therefore publish relevant GTA Summer 2027 internships without rad.ar observing or matching them.

## Goals

- Add a separate, disabled `canadian-tech-adjacent-internships` preset without changing the version-1 preset.
- Give 21 existing technology companies and 20 Canadian employer groups an enabled, branded first-party source target.
- Match GTA Summer 2027 internships across nine explicit technology role families.
- Prefer reusable ATS integrations and official employer feeds over one plugin per brand.
- Preserve direct application URLs and make parser drift observable as a source failure.

## Scope

The first cohort adds RBC, TD, Scotiabank, BMO, CIBC, KPMG, PwC, Deloitte Canada, EY Canada, Accenture Canada, Aritzia, Loblaw, Canadian Tire, Canada Goose, Manulife, Sun Life, Intact, Bell, Rogers, and TELUS. Loblaw may use multiple branded board targets but counts as one employer group.

The preset is strictly limited to the Greater Toronto Area and Summer 2027. Eligible families are software engineering, data/AI, cybersecurity, cloud/platform/infrastructure, QA/automation, technical product, UX/product design, systems/business analysis, and technology risk/IT audit.

## Non-goals

- Do not alter the existing `canadian-tech-internships` preset.
- Do not track all internship disciplines or all Canadian locations.
- Do not implement the researched second employer cohort.
- Do not automate logins, CAPTCHAs, private university portals, or third-party scraping services.
- Do not create bespoke company plugins where a stable official ATS tenant is sufficient.

## Contracts

- `WatchSourceTarget` adds optional `companyUrl` and `mode: "board" | "board-search" | "query"`.
- `board-search` produces a bounded, rotating list of term-only requests and applies geography after normalization.
- `JobWatch` adds persisted `roleFamilies: InternshipRoleFamily[]`; legacy watches receive the existing engineering-family defaults.
- `Site` adds `YELLO` and `ACCENTURE`, with registered source packages.
- A positive advertised result count followed by zero parsed jobs is a typed extraction failure; an explicit upstream zero remains a successful empty run.
- Generic discovery sources do not count toward branded company coverage.

## Eligibility

A job must have internship/co-op evidence in its title or structured employment type, explicit Summer 2027 or equivalent May–August 2027 evidence, a configured role-family match, and at least one strict GTA location. Generic product or business-analyst titles require explicit technical evidence. General audit, tax, accounting, finance, marketing, store, pharmacy, manufacturing, merchandising, recruiting-event, talent-community, and campus-ambassador postings are ineligible. Existing seniority, experience, PhD, and US-only exclusions remain.

## Performance and Safety

- Large official boards use at most two `board-search` requests per ten-minute run, capped at 25 normalized results per request so detail enrichment fits the watcher source deadline.
- Workday filters server-side before bounded detail enrichment.
- HTTP remains routed through `@ever-jobs/common`, with existing timeout, retry, redaction, and concurrency controls.
- New presets start disabled and use baseline initialization.

## Acceptance Criteria

- The new preset contains exactly 41 company names: 21 existing technology companies and 20 new employer groups.
- Every company has enabled first-class branded coverage and the coverage assertion reports zero uncovered companies.
- Existing preset snapshots remain unchanged.
- Fixture tests cover all changed/new adapters; network smoke tests are opt-in.
- Lint, build/typecheck, unit, integration, e2e, and smoke validation complete in repository order.

## Test Plan

Test target validation/diffing, bounded deterministic `board-search`, `companyUrl` propagation, role-family defaults and persistence, GTA/season/role eligibility, cross-request deduplication, baseline notification suppression, direct URLs, extraction failures, and target degradation. Add deterministic fixtures for Workday, KPMG iCIMS, vanity SuccessFactors, EY Yello, and Accenture. Add an opt-in TypeScript smoke command for official endpoints.
