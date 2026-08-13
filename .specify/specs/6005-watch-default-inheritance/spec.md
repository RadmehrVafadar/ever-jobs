# Spec 6005 — Watch Default Inheritance

| Field         | Value                                         |
| ------------- | --------------------------------------------- |
| Status        | Implemented (compatibility hardening amended) |
| Owner         | rad.ar                                        |
| Date          | 2026-08-13                                    |
| Related specs | 016, 6002, 6003, 6004                         |

## Problem Statement

Watch JSON repeats watch-wide country codes, locations, and polling intervals in
every `sourceTargets` entry. A large generated watch can therefore contain
dozens of copies of the same geography. Operators must edit every copy to make
a global change, and an unchanged copy is indistinguishable from a deliberate
source-specific override.

The watch object already has authoritative watch-wide `countryCodes`,
`locations`, and `intervalMinutes` fields. Source targets need sparse overrides:
absence means inheritance from those watch fields, while presence means a
deliberate source-specific value.

## Goals

- Make watch-level `intervalMinutes`, `countryCodes`, and `locations` the single
  defaults for every source target.
- Allow each target to override any one of those fields independently without
  copying the other defaults.
- Preserve target-only search terms, strict-location behavior, and request
  budgets without forcing duplicated geography into the same `searchScope`.
- Generate compact preset and exported JSON in which inherited values are
  omitted and explicit overrides remain present.
- Keep existing watch documents with explicit target values behaviorally
  unchanged.
- Make the GUI clearly distinguish inherited values from custom overrides and
  allow either state to be selected intentionally.

## Scope

This change covers configured watch documents, preset output, API create/patch
validation, watcher planning and scheduling, target cadence advancement, the
operator GUI source-target editor, JSON import/export, examples, and watcher/web
tests. The inheritance contract applies to:

- `sourceTargets[].intervalMinutes` → `intervalMinutes`;
- `sourceTargets[].searchScope.countryCodes` → `countryCodes`;
- `sourceTargets[].searchScope.locations` → `locations`.

`sourceTargets[].searchScope.searchTerms` continues to inherit from top-level
`searchTerms` when omitted. `strictLocations` and `maxRequestsPerRun` remain
optional target-only settings with their existing meanings.

## Non-goals

- Do not remove or rename existing watch-level fields.
- Do not automatically reinterpret an explicit target value as inherited merely
  because it currently equals the watch default; explicit presence remains an
  override for compatibility and user intent.
- Do not rewrite persisted user watches or delete user-authored JSON files.
- Do not introduce a separate nested `defaults` object or a JSON `$ref`-style
  mechanism.
- Do not change source tiers, source modes, result limits, scoring, notification
  routing, or initialization behavior.
- Do not make empty arrays mean inheritance. Omission means inheritance; an
  explicitly supplied geography array must still satisfy validation.

## Contracts

### Configured target contract

```ts
interface WatchSearchScope {
  countryCodes?: string[];
  locations?: string[];
  strictLocations?: boolean;
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}

interface WatchSourceTarget {
  site: Site | string;
  tier: 1 | 2 | 3;
  intervalMinutes?: number;
  searchScope?: WatchSearchScope;
  // existing fields unchanged
}
```

For each inheritable field, property absence is authoritative inheritance and
property presence is authoritative override. Partial `searchScope` objects are
valid. For example, a target may specify only `searchTerms` and inherit both
geography arrays.

### Resolution contract

Before request planning, configured targets resolve into the existing complete
runtime target shape:

```text
effective interval = target.intervalMinutes ?? watch.intervalMinutes
effective countries = target.searchScope.countryCodes ?? watch.countryCodes
effective locations = target.searchScope.locations ?? watch.locations
effective terms = target.searchScope.searchTerms ?? watch.searchTerms
```

The existing safe geography fallbacks (`CA` and `Canada`) remain last-resort
runtime defaults when both the target and watch arrays resolve empty. The
effective interval must be a validated positive integer; legacy/internal data
that bypassed validation falls back to the positive watch interval and then the
existing tier cadence.

Every cadence consumer must use the same effective interval, including due
selection, request rotation, `nextRunAt` advancement, and next-watch-run
calculation. A sparse target must not produce `NaN` dates.

### Persistence and compatibility

API validation preserves omission and does not materialize inherited values
into `sourceTargets`. Existing documents whose targets contain explicit
intervals or geography retain those overrides exactly. No data migration is
required because the persisted JSON target shape only becomes less strict.

The public/API model and exported JSON remain sparse, but PostgreSQL's internal
JSON representation must remain readable by a worker from the immediately
preceding expanded-target release. An inherited interval is therefore stored
with a numeric compatibility value plus an internal inheritance marker. Current
readers remove that physical value from the public model when the marker is
present. This prevents a rolling or partially restarted deployment from
silently treating compact targets as malformed and filtering them out.

Persistence decoding must be all-or-nothing for `sourceTargets`. A malformed
target array or target entry raises a watch-specific corruption error; a reader
must never return only the entries it happened to understand. In particular,
runtime execution must not persist a partially decoded target list.

### Concurrent execution and configuration edits

A watch run operates on a snapshot, but that snapshot is not authoritative for
configuration when the run completes. Runtime completion may update only
runtime-owned target fields (`initializedAt`, `lastRunAt`, and `nextRunAt`) on
the latest target configuration. It must preserve targets added during the run,
preserve edits to target cadence/scope/identity, and leave targets removed
during the run removed.

Completion uses the repository's optimistic `updatedAt` contract and retries a
bounded number of times when an operator edit wins the race. The execution
heartbeat is stopped before this merge so the worker does not conflict with its
own lease-renewal updates. If the bounded merge cannot succeed, the run fails
without replacing the latest configuration.

### Presets and exports

Preset builders must place shared geography and cadence in watch-level fields
and omit the corresponding target properties unless a target intentionally
differs. Target-specific terms, request budgets, strict-location policy, company
identity, modes, and result limits remain target-local.

JSON download serializes the sparse configuration as stored in the editor. It
must not expand inherited fields. Import accepts both legacy expanded JSON and
new compact JSON.

### Operator GUI

The source-target editor receives the watch-wide default interval, country
codes, and locations. It displays effective values alongside an inherited or
custom state. An operator can:

- leave a new target inherited by default;
- enter a custom target interval and later restore inheritance;
- add or remove country and location overrides independently;
- edit target-only scope settings without creating geography overrides;
- review/download JSON where only custom values are present on the target.

Changing a watch-wide field immediately changes the effective display for all
targets that inherit it and leaves explicit overrides unchanged.

## Error Handling

- Present target intervals remain integers from 1 through 1,440 minutes.
- Present target `countryCodes` remain arrays of 1–25 normalized two-letter
  codes.
- Present target `locations` remain arrays of 1–100 non-empty strings.
- An empty `searchScope` object is accepted but compacted away by GUI editing
  helpers when it has no remaining custom field.
- Invalid imported JSON receives a field-specific client validation message;
  invalid API input receives the existing `BadRequestException` format.

## Performance and Security

Inheritance is resolved in memory once per target during planning and adds no
network I/O. Array handling remains bounded by existing schema maxima. This
change introduces no secret-bearing fields and does not alter the shared HTTP
client requirement.

## Test Plan

### Unit

- Validation accepts omitted target interval and partial search scopes while
  rejecting invalid present overrides.
- Planning resolves each field independently, prefers explicit target values,
  and retains safe final fallbacks.
- Scheduling and target advancement use the effective watch interval for sparse
  targets and explicit cadence for overrides.
- Presets omit duplicated geography/cadence while resolving to the same runtime
  requests and coverage.
- Draft import accepts legacy expanded and compact documents; target editing
  removes empty override containers.
- GUI component tests cover inherited displays, independent geography toggles,
  interval override/reset, and target-only settings without copied defaults.

### Integration and regression

- Watch create/patch round-trips sparse source targets without expansion.
- Existing explicit source targets remain behaviorally unchanged.
- Physical PostgreSQL JSON for inherited intervals remains readable by the
  preceding release while current API reads remain sparse.
- A malformed persisted target entry fails the entire watch read instead of
  returning a shortened list.
- An operator edit or full backup restore made during a long run survives that
  run's completion; only runtime-owned fields are merged into matching targets.
- Watcher and web project builds pass, followed by focused watcher/API/web test
  suites and repository diff checks.

## Acceptance Criteria

- A watch with 47 identical target geography blocks can express the geography
  once at watch level and omit all 47 copies.
- Editing watch-level geography or cadence affects every inheriting target on
  the next plan/run without editing those targets.
- A manually customized target retains its explicit value across API, database,
  GUI, import, and export round-trips.
- Partial target scope settings never cause unrelated defaults to be copied.
- Generated Canadian internship preset JSON is compact and its effective runtime
  behavior remains covered by tests.
- Rolling deployment between the expanded and compact target releases cannot
  delete inherited targets merely because one process still uses the older
  reader.
- Completing a run that started before a watch edit cannot roll back the edit
  or shrink the source-target list.
- Documentation, index, changelog, and task ledger describe the new contract.
