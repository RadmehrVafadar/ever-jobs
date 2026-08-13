# Tasks 6004 — Canadian Employer Internship Coverage

- [x] T01 Add target `companyUrl`/`mode` contracts, validation, material diffing, planner support, and executor propagation; accept when unit tests prove bounded term-only rotation.
- [x] T02 Add `InternshipRoleFamily` and `JobWatch.roleFamilies` across watcher, Prisma migration, repositories, API DTOs, and web types; accept when legacy defaults round-trip.
- [x] T03 Refactor eligibility into role-family matching with Summer 2027 and strict GTA safeguards; accept when positive and negative matrices pass.
- [x] T04 Add the disabled 41-company tech-adjacent preset and register it without modifying preset v1; accept when coverage is active/zero-uncovered.
- [x] T05 Make Workday pass server-side search text and add pagination/detail tests.
- [x] T06 Harden iCIMS for KPMG student listings, pagination, fields, direct URLs, and extraction failures.
- [x] T07 Add vanity-domain SuccessFactors support for Scotiabank, Deloitte, Bell, Rogers, and TELUS with deterministic fixtures.
- [x] T08 Add and fully register `source-ats-yello`, with EY fixtures and bounded official-board parsing.
- [x] T09 Add and fully register `source-company-accenture`, using only its official Canadian feed and direct URLs.
- [x] T10 Add extraction-error semantics shared by affected adapters and verify target-health degradation.
- [x] T11 Add TypeScript live smoke tooling for all employer targets; keep it opt-in and network-free in normal CI.
- [x] T12 Update public docs, manifests, runbooks, examples, source directory, docs index/log/questions, and the human spec mirror.
- [x] T13 Complete repository lint, build, unit, integration, e2e, and smoke validation and record environmental blockers. The production build, 15-suite watcher package, 14-suite API package, focused adapter/preset regressions, deterministic smoke helpers, and 22-endpoint live smoke passed. Nx has no configured lint tasks; docs lint reaches only four pre-existing duplicate log entries and missing metadata in Spec 5024. Prisma schema validation passed, while client regeneration was skipped because running local rad.ar processes held the already-current Windows query-engine DLL open.
