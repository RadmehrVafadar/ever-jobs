# Watch Default Inheritance

**Status:** Implemented with persistence and concurrency hardening

**Spec:** [Spec 6005](../../.specify/specs/6005-watch-default-inheritance/spec.md)

**Plan:** [Implementation plan](../../.specify/specs/6005-watch-default-inheritance/plan.md)

**Tasks:** [Task ledger](../../.specify/specs/6005-watch-default-inheritance/tasks.md)

## Purpose

Watch JSON now stores shared cadence and geography once. Top-level
`intervalMinutes`, `countryCodes`, and `locations` are defaults for every source
target. A target contains one of those properties only when the operator wants
that source to behave differently.

This makes a global edit genuinely global. Changing the watch-level interval or
geography changes all inheriting targets on their next plan/run; custom targets
keep their explicit values.

## JSON Contract

The compact form is:

```json
{
  "intervalMinutes": 20,
  "countryCodes": ["CA", "US"],
  "locations": ["Toronto", "Remote"],
  "searchTerms": ["software intern"],
  "sourceTargets": [
    {
      "site": "google_careers",
      "tier": 1,
      "enabled": true
    },
    {
      "site": "google",
      "tier": 2,
      "intervalMinutes": 60,
      "enabled": true,
      "searchScope": {
        "countryCodes": ["CA"],
        "searchTerms": ["data intern"],
        "maxRequestsPerRun": 2
      }
    }
  ]
}
```

The first target inherits all four shared fields. The second target overrides
cadence, countries, terms, and request budget but still inherits the watch's
locations. Each field resolves independently; creating a target-only search-term
override never copies country codes or locations into the target.

Omission means inheritance. Explicit presence means a custom override even when
the explicit value currently equals the default. Existing expanded JSON remains
valid and behaviorally unchanged. Empty geography arrays are invalid rather than
an alternate inheritance marker.

## Effective Runtime Values

The watcher resolves a complete target before execution:

```text
target.intervalMinutes          ?? watch.intervalMinutes
target.searchScope.countryCodes ?? watch.countryCodes
target.searchScope.locations    ?? watch.locations
target.searchScope.searchTerms  ?? watch.searchTerms
```

The effective interval is used consistently for due checks, request rotation,
target `nextRunAt`, and watch `nextRunAt`. The source executor continues to
receive complete arrays and a concrete interval.

## GUI Behavior

The source-target editor shows the effective watch defaults and labels inherited
cadence and geography. Entering a target value makes only that value custom.
“Use watch default” actions remove individual overrides. “Use defaults for all”
removes interval, country, and location overrides from every target at once,
while preserving target-only strict-location settings, search terms, request
budgets, company configuration, modes, and result limits.

Advanced JSON import accepts old expanded and new compact documents. Download
does not expand inherited values. The migrated 47-target example is
[`examples/canadian-tech-adjacent-internships.watch.json`](../../examples/canadian-tech-adjacent-internships.watch.json).

## Compatibility and Rollout

The public API and downloaded documents remain sparse. PostgreSQL internally
materializes an inherited interval with an inheritance marker, allowing the
immediately preceding worker release to read the target during a rolling or
incomplete restart. Current readers remove that internal value before returning
the watch, so changing the watch default remains global.

Target decoding is atomic. If even one persisted target is malformed, the watch
read fails with `WATCH_SOURCE_TARGETS_INVALID` instead of returning a shortened
list that a later run could save over the complete configuration.

Run completion also treats the latest operator configuration as authoritative.
A run no longer writes the entire target snapshot it loaded at startup. It
optimistically merges runtime state into the latest watch; if a backup restore,
target edit, pause, or other configuration change occurred during the run, that
configuration wins and remains ready for a clean baseline.

Deploy the API, CLI, and watcher from the same build before restoring a watch
that was already shortened by the earlier mixed-version failure.

No database migration is required because source targets are already stored as
JSON. Persistence now round-trips missing target interval/geography properties.
Existing saved watches are not rewritten automatically. Applying a current
Canadian internship preset while paused, or deliberately choosing “Use defaults
for all” and applying the reviewed draft, performs the compacting change and
therefore follows the existing baseline-required workflow.
