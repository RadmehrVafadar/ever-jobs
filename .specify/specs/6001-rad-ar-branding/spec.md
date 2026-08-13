# Spec: 6001 — rad.ar Product Branding

| Field         | Value |
| ------------- | ----- |
| Spec ID       | 6001 |
| Slug          | `rad-ar-branding` |
| Status        | done |
| Owner         | rad.ar maintainers |
| Created       | 2026-08-01 |
| Last updated  | 2026-08-01 |
| Supersedes    | (none) |
| Related specs | 001, 002, 016, 6000 |

## 1. Problem Statement

The repository's canonical product name is now `rad.ar`, but current public
documentation, API descriptions, MCP copy, watcher notifications, and package
descriptions still present the former Ever Jobs name. A blind rename would also
change established npm scopes, environment variables, metrics, protocol
identifiers, and deployment resource names, breaking existing integrations.

## 2. Goals

- Make `rad.ar` the canonical user-facing project and product name.
- Update current public documentation, runtime display strings, notification
  branding, and descriptive package metadata.
- Preserve existing compatibility-sensitive machine identifiers.
- Record the naming boundary for future contributors and agents.

## 3. Non-Goals

- Renaming the `@ever-jobs/*` npm scope or package import paths.
- Renaming `EVER_JOBS_*` environment variables, `ever_jobs_*` metrics, existing
  CLI/MCP identifiers, database objects, Docker services, or deployment resources.
- Rewriting historical specs, changelogs, logs, probes, or generated plugin
  implementation notes.
- Changing API routes, payloads, persistence, scraping, or watcher behavior.

## 4. User / Caller Stories

> As a user, I want every current product surface to identify the project as
> `rad.ar`, so the repository has one clear name.

> As an existing integrator, I want machine identifiers to remain stable, so a
> branding update does not break imports, configuration, metrics, or automation.

## 5. Functional Requirements

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-1 | Current public project headings and descriptions use `rad.ar`. | must |
| FR-2 | OpenAPI, MCP, watcher startup, and Discord display strings use `rad.ar`. | must |
| FR-3 | AGENTS.md declares `rad.ar` as canonical and documents retained identifiers. | must |
| FR-4 | Tool/package descriptive metadata uses `rad.ar` while stable IDs remain unchanged. | must |
| FR-5 | Historical records retain their original wording. | must |

## 6. Non-Functional Requirements

| ID | Requirement | Target |
| -- | ----------- | ------ |
| NFR-1 | Backward compatibility | No machine identifier or route changes |
| NFR-2 | Documentation consistency | No former display name in selected current surfaces |
| NFR-3 | Runtime safety | Existing focused API/watcher/MCP tests remain green |

## 7. Contracts

### 7.1 Naming contract

```text
Canonical display name: rad.ar
Retained compatibility namespace: @ever-jobs/*
Retained environment prefix: EVER_JOBS_
Retained metric prefix: ever_jobs_
Retained protocol/deployment identifiers: existing values
```

### 7.2 Errors

No new runtime errors or public error codes are introduced.

## 8. Test Plan

- Parse changed JSON metadata.
- Run focused watcher notification and API watch-management tests.
- Run the MCP tool suite and TypeScript checks for affected applications.
- Search current branding surfaces for remaining former display-name references.
- Validate relative README links and run `git diff --check`.

## 9. Open Questions

None. Compatibility identifiers are retained by explicit decision.

## 10. Decisions

- D-1: The exact display spelling is lowercase `rad.ar`.
- D-2: This is a display-brand migration, not a package/protocol migration.
- D-3: Historical records and generated source notes are not rewritten.

## 11. References

- [Implementation plan](plan.md)
- [Task ledger](tasks.md)
- [Human-readable mirror](../../../docs/specs/6001-rad-ar-branding.md)
