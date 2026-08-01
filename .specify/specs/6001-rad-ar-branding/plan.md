# Plan: 6001 — rad.ar Product Branding

| Field        | Value |
| ------------ | ----- |
| Spec         | spec.md |
| Created      | 2026-08-01 |
| Last updated | 2026-08-01 |

## 1. Approach

Apply the rename only where a human sees the product name: current overview and
reference docs, descriptive metadata, API documentation, MCP descriptions,
watcher startup messages, and Discord presentation. Keep established machine
identifiers intact and explain that boundary in AGENTS.md and README.md.

Historical specs/log entries and generated source comments remain unchanged
because they are audit evidence rather than current branding contracts.

## 2. Phases

### Phase 1 — Naming contract and documentation

- Add Spec 6001 and its mirror.
- Update the root overview, contributor guidance, documentation index, and
  current application guides.
- Exit criteria: current entry points name `rad.ar` and explain compatibility.

### Phase 2 — Runtime presentation

- Update API, MCP, watcher, notification, and descriptive metadata strings.
- Keep routes, package names, prefixes, and service identifiers unchanged.
- Exit criteria: runtime display strings use `rad.ar` without contract changes.

### Phase 3 — Validation

- Run focused tests, TypeScript checks, JSON parsing, branding scans, and diff
  hygiene.
- Exit criteria: changed surfaces are consistent and backward compatible.

## 3. Packages Touched

| Package | Change |
| ------- | ------ |
| `apps/api` | OpenAPI, startup, and notification-test display strings |
| `apps/mcp` | Current documentation and server/tool display strings |
| `apps/watcher` | Guide and startup display string |
| `packages/watcher` | Discord and metric-help display strings |
| root/docs | Canonical naming contract, overview, metadata, index, and log |

## 4. Dependencies

No dependency changes.

## 5. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Breaking imports or automation | M | H | Preserve all compatibility identifiers |
| Mixed branding remains | M | M | Search selected current surfaces after edits |
| Historical audit text is altered | L | M | Exclude specs, logs, probes, and generated notes |

## 6. Rollback Plan

Revert display-string and documentation changes. No schema, data, or machine-ID
migration is involved.

## 7. Migration Plan

No consumer action is required. Existing `@ever-jobs/*` imports and
`EVER_JOBS_*` configuration continue to work.

## 8. Open Questions for Plan

None.
