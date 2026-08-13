# Spec: 6002 — Local Operator GUI and Notification Routing

| Field         | Value                       |
| ------------- | --------------------------- |
| Status        | Approved for implementation |
| Owner         | rad.ar                      |
| Date          | 2026-08-04                  |
| Related specs | 016, 6000, 6001             |

## Problem statement

rad.ar exposes job search and persistent-watch functionality through REST,
GraphQL, MCP, and CLI surfaces, but operating a watch still requires knowledge
of command syntax and large JSON documents. A local operator needs a safe,
visual way to create and change watches, understand worker health and history,
review matches, and route different classes of notifications to different
Discord channels without weakening the existing persistence, initialization,
idempotency, or secret-handling contracts.

## Goals

- Provide a TypeScript-only GUI at `http://127.0.0.1:3000` for the complete
  user-facing CLI surface: search, analysis, source comparison, watch CRUD,
  presets, manual execution, initialization, pause/resume, matches, runs,
  coverage, metrics, observed jobs, notification testing, and deliveries.
- Keep PostgreSQL as the watch source of truth while replacing manual watch JSON
  authoring with validated forms and optional JSON import/export.
- Start the API, watcher worker, and GUI with one local command. The GUI controls
  persisted watch state; it never spawns the worker from a browser request.
- Support named Discord destinations and deterministic conditional routing by
  source tier, notification type, and score range.
- Store webhook URLs only in process environment or an ignored local secret
  file. Never persist or return webhook URLs in watch JSON, PostgreSQL, logs,
  errors, exports, or screenshots.
- Preserve legacy `notificationChannels`, CLI, MCP, machine identifiers,
  database history, delivery idempotency, and cloud environment configuration.
- Make behavior-changing watch edits safe through diff preview, optimistic
  concurrency, pause, baseline, review, and explicit resume.

## Non-goals

- User accounts, multi-user authorization, remote/public hosting, or cloud secret
  administration.
- Browser-controlled operating-system process creation or restart.
- Replacing REST, CLI, MCP, PostgreSQL, the worker scheduler, source plugins, or
  the existing notification outbox.
- Replaying previously suppressed or delivered matches after a route edit.
- Terminal concepts with no browser equivalent, including stdout/stderr,
  verbose terminal logging, or arbitrary filesystem output paths.

## Functional requirements

### Web application

1. `apps/web` MUST be a React/Vite TypeScript application on loopback port 3000.
2. The product UI MUST be provided by a replaceable `ui-operator` feature plugin
   registered through a minimal `IUiPlugin` contract.
3. A root `gui:dev` command MUST launch API port 3001, watcher port 3002, and the
   web app port 3000; a production-style local `gui` command MUST build/launch
   the same surfaces and print the exact URL.
4. Browser API requests MUST use relative URLs through the local web proxy.
5. The API key MAY be stored only in `sessionStorage`; it MUST NOT use
   `localStorage`, IndexedDB, cookies, query strings, or watch data.
6. The application MUST contain Overview, Watches, Notifications, Matches,
   Search, Compare/Analysis, and Settings surfaces with accessible loading,
   empty, error, and destructive-confirmation states.
7. Watch profiles MUST support structured editing of all user-relevant
   `CreateWatchDto` fields plus validated JSON import/export. Runtime fields and
   secrets MUST be absent from exported configuration.
8. The GUI MUST expose existing watch CRUD, default creation, preset
   preview/apply, run, initialize selected targets, pause/resume, runs, matches,
   match status, metrics, coverage, observed jobs, deliveries, and notification
   tests.
9. Search MUST expose the normal `ScraperInputDto` user fields and provide
   paginated results, details, analysis, JSON, and CSV download.
10. Compare MUST allow a selected subset or all registered sources and display
    successful metrics alongside sanitized per-source failures.

### Safe apply

11. The GUI MUST keep edits as an unsaved browser draft until Apply.
12. Apply MUST include the watch's last observed `updatedAt`; a stale write MUST
    return HTTP 409 without mutation.
13. Apply MUST return a field-level diff and classify whether initialization is
    required.
14. Name, description, schedule, interval, timezone, and notification-only edits
    MAY retain the current enabled state.
15. Changes to sources, source targets, companies, search terms, eligibility
    filters, score thresholds, or weights MUST atomically disable the watch and
    return every enabled target key as requiring a no-notification baseline.
16. Apply MUST NOT automatically resume a behavior-changed watch. The operator
    reviews baseline results and invokes Resume explicitly.

### Notification routes

17. `JobWatch` MUST add `notificationRoutes` as a separate JSON-backed field.
    `notificationChannels` remains the legacy fallback only when the route
    array is absent or empty. A non-empty route array is authoritative even if
    every route in it is disabled.
18. A route MUST contain `id`, `name`, `enabled`, `provider`, `destinationRef`,
    and optional `sourceTiers`, `notificationTypes`, `minimumScore`, and
    `maximumScore` conditions.
    The GUI route editor MUST choose `destinationRef` from masked destination
    records filtered to the selected provider instead of accepting arbitrary
    text. Configured aliases are selectable; an already-saved alias that is
    missing or unconfigured remains visible as unavailable until the operator
    explicitly replaces it.
19. Conditions across fields use AND semantics; entries within an array use OR
    semantics; score bounds are inclusive; an enabled route without conditions
    is a catch-all.
20. Source tier MUST be resolved from `WatchMatch.sourceTargetKey` and the
    watch's current `sourceTargets`. An unresolved tier does not match a
    tier-constrained route.
21. All matching provider/destination pairs MUST receive a notification, but
    overlapping routes for the same pair MUST enqueue at most one delivery.
22. Delivery identity MUST remain watch + canonical episode + provider/channel
    - destination reference. Route IDs and notification type MUST NOT enter the
      idempotency key.
23. When routes are configured but none match, the match MUST become suppressed
    with reason `routing`; later route changes MUST NOT replay it.
24. Retries MUST use the destination persisted on the delivery row and MUST NOT
    re-evaluate current routes.

### Local destination secrets

25. `default` MUST continue resolving `DISCORD_WEBHOOK_URL`.
26. A custom slug such as `tier-one` MUST map deterministically to
    `DISCORD_WEBHOOK_TIER_ONE` and accept only a bounded lowercase slug.
27. Process environment MUST take precedence over `.env.local`; destination
    responses expose only alias, provider, configuration source, and configured
    status. The GUI treats source `environment` as read-only, and no response
    includes an environment-key name or secret value.
28. GUI-managed values MUST be written atomically to the ignored `.env.local`,
    validated against approved Discord HTTPS hosts and webhook paths, and
    reloaded by API and worker without a process restart.
29. Destination APIs MUST support masked list, create/rotate, delete only when
    unreferenced, and a non-persistent test. They MUST be admin-authenticated.
30. Request logging, validation, errors, provider results, and tests MUST redact
    webhook URLs and sensitive fields.

### Public APIs

31. Add an atomic `POST /api/watches/:id/apply` endpoint accepting
    `{ expectedUpdatedAt, patch }`.
32. Add authenticated preset list, preview, and apply endpoints that delegate to
    `WatchPresetService`.
33. Add authenticated destination-management endpoints under
    `/api/notification-destinations`; retain `/api/notifications/test`.
34. Add `POST /api/jobs/compare` with configured bounded concurrency and
    `Promise.allSettled` partial-result semantics.
35. Existing API shapes MUST remain source compatible; new fields are optional
    for clients and existing database rows.

## Data and migration contract

- Add `JobWatch.notificationRoutes Json @default("[]")` through a forward-only
  Prisma migration. No existing column is removed or rewritten.
- In-memory and Prisma repositories MUST map the new field equivalently.
- Existing rows load `notificationRoutes: []` and continue through
  `notificationChannels`.
- A route-configured watch may retain legacy channels for rollback, but the new
  dispatcher MUST use routes exclusively whenever the route array is non-empty
  so disabled routing cannot accidentally reactivate legacy broadcast.
- Secret values are not database entities and require no database migration.

## Security and failure contract

- All GUI mutations use the existing admin API-key guard.
- Local services launched by GUI commands bind to `127.0.0.1`; existing
  container/cloud bind behavior remains configurable.
- API and worker secret resolvers cache only parsed aliases and reload after
  file mtime changes. Writes use a same-directory temporary file and atomic
  rename; failed writes leave the prior file intact.
- An unhealthy/unreachable API, worker, database, or notification destination
  is shown independently. Read failures never imply that a watch was stopped.
- Partial compare and watch runs preserve successful results and sanitized
  failure summaries.

## Test plan

### Unit

- Routing truth table: catch-all, tier/type arrays, score endpoints, unknown
  tier, disabled rules, overlapping rules, legacy fallback, suppression, and
  unchanged idempotency.
- Secret aliases: normalization, collisions, invalid URL/host/path, environment
  precedence, atomic writes, reload, reference protection, masking, and log/error
  redaction.
- Apply: change classification, atomic pause, initialization keys, stale writes,
  validation errors, and no-op updates.
- UI: profile fields, provider-filtered route destination selection (including
  unavailable saved aliases), route builder, diff, tables, filters, dialogs,
  keyboard behavior, downloads, and session-only API key storage.

### Integration and end-to-end

- Authenticated watcher, preset, destination, apply, comparison, and legacy API
  contracts using in-memory and PostgreSQL repositories where appropriate.
- Playwright local stack with fake sources and Discord: create/edit/apply,
  initialize, resume, run, verify tier-specific routing, inspect history, update
  status, search/analyze/compare, and download JSON/CSV.
- Regression suites for CLI, MCP, watcher scheduler/outbox, API, build, lint,
  docs lint, and migrations.

## Acceptance criteria

- One command serves a usable GUI at `127.0.0.1:3000` and reports the worker
  independently from watch pause/resume state.
- A watch can be created and fully managed without manually authoring JSON.
- Tier 1, Tier 2, urgent, standard, digest, and bounded score routes can target
  different Discord aliases with no duplicate for overlapping rules, and the
  GUI cannot introduce a misspelled destination alias through the route form.
- Existing legacy watches behave unchanged.
- No test, response, export, log, database row, or UI rendering exposes a webhook
  URL.
- Behavior-changing edits remain paused until baseline review and explicit
  resume.

## Rollout and rollback

Deploy the additive migration, API/watcher changes, then GUI. Keep existing
legacy channels during the first rollout, configure aliases, test each
destination, preview/apply routes while paused, baseline affected targets, and
resume explicitly. Rollback disables the UI plugin and old binaries ignore the
new JSON column; legacy channels continue to function and route secrets remain
outside the database.
