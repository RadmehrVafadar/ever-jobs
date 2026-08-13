# Spec 6002 - Local Operator GUI and Notification Routing

> Status: implementation in progress. This document describes the operator and
> compatibility contract. It does not record validation results. The
> authoritative requirements, implementation plan, and task ledger live in the
> [Spec Kit directory](../../.specify/specs/6002-local-operator-gui/spec.md).

## Problem and outcome

rad.ar can search and analyze jobs through its API, CLI, and MCP server, and it
can run durable scheduled watches through the watcher worker. Operating those
surfaces currently requires command knowledge and, for watch configuration,
manually maintained JSON. The local operator GUI adds a browser layer over the
same services and PostgreSQL records so an operator can configure, run, and
understand the system without creating a second execution path.

The completed local stack serves the GUI at `http://127.0.0.1:3000`, the API at
`http://127.0.0.1:3001`, and watcher health at
`http://127.0.0.1:3002`. A single root command starts all three processes. The
browser never creates or restarts an operating-system process: its Start/Resume
control updates the selected persisted watch, while the worker remains an
independently observable long-running service.

PostgreSQL remains the source of truth. The GUI keeps an unsaved draft only in
the active browser session, validates it through the API, previews a field-level
diff, and writes the same watch contract used by CLI callers. Advanced users
can still import, inspect, copy, and download API-compatible JSON, excluding
runtime fields and secrets.

## Scope and non-goals

The first release includes:

- overview health and activity;
- watch creation, cloning, editing, deletion, preset management, pause/resume,
  manual runs, initialization, metrics, coverage, and run history;
- profile forms for sources, company context, tier/cadence/result limits,
  query scope, search/filter terms, workplace and employment types, score
  thresholds, scoring weights, schedule, and timezone;
- named Discord destination administration and conditional notification routes;
- match, observed-job, score-explanation, delivery, and workflow-status views;
- job search, job details, analytics, company intelligence, source comparison,
  and browser JSON/CSV downloads;
- responsive, keyboard-operable, labeled interaction states suitable for a
  single local operator.

The first release does not add accounts, remote/public hosting, cloud secret
administration, automatic applications, MCP session management, or browser
equivalents for terminal-only stdout/stderr, verbose logging, and arbitrary
filesystem output paths. It does not replace or remove the CLI, MCP server, API,
worker, database, source plugins, notification outbox, or compatibility machine
identifiers.

## Operator experience

### Overview

The Overview distinguishes service state from watch state. It reports API,
database, worker, scheduler, Discord, and source-coverage health; active and
paused watches; next-run times; recent runs, matches, failures, and deliveries;
and Tier 1 degradation warnings. An unreachable worker is shown as unavailable,
not as a paused watch, and a paused watch does not imply that the worker is
stopped.

### Watches and profile builder

The watch area allows an operator to create a blank watch or the safe default,
clone an existing watch, inspect it, delete it after confirmation, pause or
resume scheduling, run immediately, and baseline all or selected enabled
targets. Preset list, preview, and apply use the server's existing
`WatchPresetService`; preset merge logic is never duplicated in React.

The structured profile builder covers the user-editable `CreateWatchDto`
contract:

- name and description;
- schedule, interval, and timezone;
- source targets, source site, company slug/name, priority tier, per-target
  interval, `resultsWanted`, enabled state, and query scope;
- countries, locations, search terms, required terms, preferred terms, and
  excluded terms;
- allowed workplace and employment types;
- minimum, urgent, and digest thresholds plus scoring weights;
- legacy destinations and conditional notification routes.

Runtime-owned identifiers, timestamps, initialization state, health counters,
lease state, run history, and webhook values are never editable through JSON
import and are absent from exported profiles.

### Safe Apply workflow

An edit remains a browser draft until Apply. Apply sends the `updatedAt` value
from the version originally loaded. If another API, CLI, MCP, or GUI caller has
changed the watch, the API returns HTTP 409 without mutation; the operator must
reload and reconcile the new version.

The preview identifies every changed field and classifies its operational
impact:

| Change class      | Examples                                                                                                                                  | Apply behavior                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Live-safe         | Name, description, schedule, interval, timezone                                                                                           | Preserve the current enabled state.                                                                     |
| Notification-only | Legacy destinations and notification routes                                                                                               | Preserve the current enabled state; do not replay history.                                              |
| Behavior-changing | Sources/targets, company scope, locations/countries, search/filter terms, workplace/employment eligibility, score thresholds, and weights | Atomically pause the watch and return every enabled target key as requiring a no-notification baseline. |

A no-op apply does not alter timestamps, pause state, or initialization. A
behavior-changing apply never resumes automatically. The GUI guides the
operator through initialization, displays baseline target results and failures,
and exposes Resume only as an explicit follow-up action.

### Matches, deliveries, search, and analysis

The GUI uses the existing paginated watch, match, observed-job, and delivery
queries. Operators can filter matches, inspect score and eligibility
explanations, open normalized job details, and assign the existing workflow
statuses: `new`, `reviewed`, `applied`, `dismissed`, `interview`, `rejected`, or
`offer`.

Search exposes normal `ScraperInputDto` controls. Search results and analysis
come from the existing jobs and analytics services. Source comparison executes
the requested sources with bounded concurrency and `Promise.allSettled`: a
failed source contributes a sanitized failure row while successful sources and
their comparison statistics remain visible. Browser downloads replace CLI
stdout/file flags with explicit JSON and CSV downloads.

## Notification routing contract

`JobWatch` gains an additive `notificationRoutes` JSON field while retaining
`notificationChannels`. Existing rows and watch documents that omit routes load
an empty route array and continue broadcasting through their legacy channels.

```ts
type RoutedNotificationType = "urgent" | "standard" | "digest";

interface NotificationRoute {
  id: string;
  name: string;
  enabled: boolean;
  provider: "discord";
  destinationRef: string;
  sourceTiers?: Array<1 | 2 | 3>;
  notificationTypes?: RoutedNotificationType[];
  minimumScore?: number;
  maximumScore?: number;
}
```

The route editor obtains masked aliases from the destination-management API and
uses a provider-filtered select for `destinationRef`; it does not accept a
free-typed alias. Configured aliases are selectable. An unconfigured alias or
an already-saved reference missing from the current inventory remains visible
as unavailable so an existing route is never silently rewritten and the
operator can choose an explicit replacement.

The rules are deterministic:

1. Disabled routes never match.
2. Different condition fields use AND semantics.
3. Multiple values within `sourceTiers` or `notificationTypes` use OR
   semantics.
4. Score bounds are inclusive.
5. An enabled route with no conditions is a catch-all.
6. Source tier comes from `WatchMatch.sourceTargetKey` matched against the
   watch's current source targets. An unresolved tier cannot satisfy a
   tier-constrained route.
7. Every distinct matching provider/destination pair receives a delivery.
   Overlapping routes to the same pair are collapsed before outbox enqueue.
8. A non-empty route set is authoritative and legacy channels are not also
   broadcast, even if every route is disabled. Legacy channels retain their
   existing behavior only when the route array is absent or empty.
9. A route-configured match with no destination becomes suppressed with
   `notificationSuppressionReason: "routing"`. A later route edit does not
   replay it.
10. A retry uses the provider and destination already persisted on its outbox
    row. It does not re-run the current route set.

Delivery identity remains a hash of watch, canonical episode, provider/channel,
and destination reference. Neither route ID nor notification type enters that
identity, so an overlapping rule, score-band change, process restart, or route
rename cannot resend the same episode to the same destination.

Examples:

```json
[
  {
    "id": "tier-1-urgent",
    "name": "Tier 1 urgent",
    "enabled": true,
    "provider": "discord",
    "destinationRef": "tier-one",
    "conditions": {
      "sourceTiers": [1],
      "notificationTypes": ["urgent"]
    }
  },
  {
    "id": "tier-2-standard",
    "name": "Tier 2 standard",
    "enabled": true,
    "provider": "discord",
    "destinationRef": "tier-two",
    "conditions": {
      "sourceTiers": [2],
      "notificationTypes": ["standard"],
      "minimumScore": 60,
      "maximumScore": 79
    }
  }
]
```

The example's first route requires both Tier 1 and urgent type. The second
requires Tier 2, standard type, and an inclusive score from 60 through 79.

## Destination and secret contract

A watch or route stores only `destinationRef`; it never stores a webhook URL.
The special `default` reference continues to resolve `DISCORD_WEBHOOK_URL`.
Custom lowercase slugs map deterministically to environment keys:

| Destination reference | Environment key                   |
| --------------------- | --------------------------------- |
| `default`             | `DISCORD_WEBHOOK_URL`             |
| `tier-one`            | `DISCORD_WEBHOOK_TIER_ONE`        |
| `tier-2-standard`     | `DISCORD_WEBHOOK_TIER_2_STANDARD` |

GUI-managed custom values are written only to the repository-root ignored
`.env.local`. Writes validate an HTTPS Discord webhook host and path, create a
same-directory temporary file, and atomically rename it so interruption cannot
leave a partial secret file. API and worker resolvers use a small mtime cache so
changes become available without restarting either service.

Non-empty process environment values take precedence over `.env.local`. The GUI
reports those aliases as configured and read-only. Listing returns only alias,
provider, source (`environment`, `local`, or `unconfigured`), and configured
status. The GUI infers read-only state from an `environment` source.
Create/rotate responses are equally masked. Deletion is rejected while a watch
channel or route references the alias. Test sends a non-persistent provider test
and does not create a fake job, match, or delivery row.

Webhook values must not appear in API responses, validation messages, provider
responses, request logs, application logs, database rows, profile JSON,
downloads, browser screenshots, or test snapshots. URL and sensitive-field
redaction applies to error paths as well as successful paths.

## REST additions

All mutation endpoints use the existing admin API-key guard.

| Endpoint                             | Contract                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/watches/:id/apply`        | Accept `{ expectedUpdatedAt, patch }`; return applied watch, field diff, pause decision, and target keys requiring initialization; stale versions return 409. |
| Preset list/preview/apply endpoints  | Delegate to `WatchPresetService`; preview is non-mutating and apply retains the service's pause and merge rules.                                              |
| `GET /api/notification-destinations` | Return masked named Discord destination metadata.                                                                                                             |
| Create/rotate destination endpoint   | Validate alias and webhook, atomically update `.env.local`, and return masked metadata.                                                                       |
| Delete destination endpoint          | Delete a GUI-managed, unreferenced alias; reject environment-owned or referenced aliases.                                                                     |
| Destination test endpoint            | Send a non-persistent test through the selected alias.                                                                                                        |
| `POST /api/jobs/compare`             | Run selected sources with bounded concurrency and return successes plus sanitized per-source failures.                                                        |

Existing watch CRUD, run, initialization, pause/resume, run history, matches,
metrics, coverage, observed-job, delivery, notification-test, search, and analyze
endpoints remain compatible. All new fields are additive and optional to
existing clients. CLI watch JSON may opt into `notificationRoutes`; MCP behavior
does not change.

## Local security and process boundaries

- GUI launch scripts bind the local stack to `127.0.0.1`; container and cloud
  binding remains independently configurable.
- The browser stores the admin API key only in `sessionStorage`. It is cleared
  when the tab session ends and is never copied into watch state, route state,
  local storage, IndexedDB, cookies, URLs, or downloads.
- Browser requests use the local web proxy instead of embedding deployment
  origins into UI code.
- Read failures for API, database, worker, scheduler, notification, or source
  coverage are presented independently and never mutate a watch.
- The launcher runs checked-in migrations before starting the three services,
  prints the canonical GUI URL, forwards termination, and tears down sibling
  processes when one startup fails.

## Migration, rollout, and rollback

The forward-only Prisma migration adds
`JobWatch.notificationRoutes Json @default("[]")`. It removes or rewrites no
existing column or row. Prisma and in-memory repositories map the new field in
the same way. Secrets remain outside PostgreSQL and need no data migration.

Rollout order is migration, API/watcher contracts, then GUI. An operator keeps a
watch paused while adding aliases and routes, tests each destination, applies
behavior changes, baselines required targets, reviews the resulting jobs and
health, and resumes explicitly. Routes do not replay historical suppressed
matches.

Rollback disables the UI plugin or local web service. Existing CLI, MCP, API,
worker, and legacy channel behavior remain available. The additive route column
and route documents remain intact for a later re-enable; webhook secrets remain
outside the database. Old binaries continue to use retained legacy channels.

## Acceptance and test coverage

Implementation acceptance requires:

- unit coverage for routing boundaries, condition combinations, unknown tiers,
  disabled/catch-all rules, overlapping-route deduplication, legacy fallback,
  routing suppression, retry behavior, and unchanged idempotency;
- unit coverage for alias normalization/collisions, URL validation, environment
  precedence, atomic writes, mtime reload, reference checks, masking, and
  redaction;
- safe-apply coverage for live-safe and behavior-changing fields, no-ops,
  atomic pause, baseline target keys, validation, and stale-version conflicts;
- authenticated API integration coverage for existing and new watch, preset,
  destination, notification, comparison, and history endpoints;
- React component coverage for forms, provider-filtered destination selection,
  unavailable saved route references, routes, validation, diffs, tables,
  filters, dialogs, keyboard behavior, downloads, and session-only credentials;
- a Playwright flow with PostgreSQL and fake source/Discord services that
  creates and edits a watch, routes Tier 1 and Tier 2 matches to the intended
  aliases, initializes, resumes, runs, checks history, changes status, performs
  search/analysis/comparison, and downloads JSON/CSV;
- lint, typecheck/build, watcher, API, CLI, integration, end-to-end,
  documentation, migration, and diff-hygiene gates;
- an operational smoke proving one-command startup, clear worker interruption,
  legacy-watch compatibility, durable restart recovery, and no duplicate or
  secret disclosure.

No validation result is recorded in this mirror until the corresponding task
has actually run and its evidence has been added to the Spec 6002 task ledger
and documentation log.

## References

- [Authoritative specification](../../.specify/specs/6002-local-operator-gui/spec.md)
- [Implementation plan](../../.specify/specs/6002-local-operator-gui/plan.md)
- [Task ledger](../../.specify/specs/6002-local-operator-gui/tasks.md)
- [Real-time watcher specification](../../.specify/specs/016-realtime-job-watcher/spec.md)
- [Prestige coverage expansion](../../.specify/specs/6000-prestige-internship-coverage-expansion/spec.md)
- [Local watcher runbook](../runbooks/watcher-local.md)
