# rad.ar Watcher

The watcher is the long-running rad.ar worker for persistent, low-latency job
monitoring. It stores watches, target state, observations, canonical episodes,
matches, and notification deliveries in PostgreSQL. It invokes source plugins
directly and sends durable notifications only after database persistence
succeeds.

The `canadian-tech-internships` preset (revision 1) targets Summer 2027
technology internships and co-op roles in Toronto and the Greater Toronto Area.
Every source tier uses `CA` and the same GTA location list. Its first activation
is deliberately safe: a new seeded watch is
globally disabled/uninitialized and every target baseline is unset. Target-level
enabled flags describe validated inventory only; they cannot poll or notify
while the watch is paused.

The retained inventory classifies every target company explicitly: 21 have at least one
first-class company/ATS target, while RBC, TD, Scotiabank, BMO, and CIBC remain
visible as deferred, uncovered companies. Generic LinkedIn, Canada Job Bank, and
Google Jobs targets provide redundancy but never count as company coverage.

Spec 6004 adds a separate disabled preset,
`canadian-tech-adjacent-internships` (revision 1). It keeps the original preset
unchanged while requiring branded first-party coverage for 41 employer groups:
the existing 21 technology companies plus 20 banks, consulting firms, Canadian
retail/consumer brands, insurers, and telecoms. It enables nine role families:
software engineering, data/AI, cybersecurity, cloud/platform/infrastructure,
QA/automation, technical product, UX/product design, systems/business analysis,
and technology risk/IT audit.

For copy-and-paste operating procedures, use the [local runbook](../../docs/runbooks/watcher-local.md). For the supported Google Cloud shape and its constraints, use the [Google Cloud runbook](../../docs/runbooks/watcher-google-cloud.md).

## Runtime architecture

```text
PostgreSQL due-watch query and lease
  -> due source tiers
  -> target-aware query matrix or term-only board-search plan
  -> existing rad.ar source plugins
  -> normalized JobPostDto location arrays
  -> source observation and canonical-episode upsert
  -> target-aware geography eligibility and explainable ranking
  -> durable, canonical-episode-idempotent Discord delivery
  -> run history, target health, latency data, and metrics
```

The scheduler polls PostgreSQL every 15 seconds by default. A PostgreSQL lease
prevents two replicas from executing the same watch concurrently; a process-local
guard prevents overlap within one replica. Query targets build a bounded,
deterministically rotating term × location matrix. Source requests use bounded
concurrency, timeouts, retries with jitter, hard-failure classification, and
partial-failure accounting. Redis is not required by this scheduler.

Large ATS targets may instead use `board-search`. Those targets rotate a
bounded term-only slice (at most two requests per ten-minute Spec 6004 cycle)
and apply strict GTA filtering after normalization; they do not build a
term-by-location matrix. New Spec 6004 employer-board searches cap normalized
results at 25 per request so bounded detail enrichment fits the source
deadline while all four terms rotate across successive runs. An optional
target `companyUrl` carries an official
vanity career listing URL to the adapter. `mode`, `companyUrl`, and search scope
are material preset fields and trigger target reinitialization when changed.

The worker listens on `0.0.0.0:${WATCHER_HEALTH_PORT}` and exposes only operational endpoints:

- `GET /health` returns application, database, scheduler, Discord-configuration,
  and aggregate Tier 1 coverage status.
- `GET /metrics` returns Prometheus metrics.

Worker health exposes `coverage.status`, `coverage.tier1Degraded`,
`coverage.degradedTargets`, and `coverage.watches`. The API's separate `/health`
response exposes `watcherCoverage.status`, `watcherCoverage.tier1Degraded`, and
`watcherCoverage.watches`.

Watch management remains in the existing authenticated REST API and CLI. The watcher does not expose management endpoints itself.

## Safe local quick start

Prerequisites are Node.js/npm, Docker with Compose, and a Discord webhook URL. On Windows PowerShell, use `Copy-Item .env.example .env` in place of `cp`.

```bash
cp .env.example .env
docker compose up -d postgres
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run start:watcher:dev
```

Set `DISCORD_WEBHOOK_URL` in `.env` before testing notifications. Keep it out of watch JSON, logs, screenshots, commits, and command history. Watch records store the destination reference `default`; the provider resolves the complete secret from the environment at send time.

In a second terminal, get the seeded watch ID and preview the preset. Preview
is side-effect free; applying requires the explicit `--apply` flag and the watch
must remain paused:

```bash
npm run cli -- watch list --json
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id> --apply
npm run cli -- watch coverage --id <watch-id> --json
```

To use the separate expanded preset, substitute these dry-run/apply commands:

```bash
npm run cli -- watch preset apply canadian-tech-adjacent-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-adjacent-internships --watch <watch-id> --apply
```

The apply result identifies added and materially changed targets. Baseline only
those target keys; `--target` may be repeated. Omit it only when intentionally
initializing every enabled target:

```bash
npm run cli -- watch initialize <watch-id> \
  --target uber \
  --target notion \
  --target ramp \
  --target netflix \
  --target ibm \
  --json
# Repeat the same targeted initialize command for two additional
# no-notification observation cycles while the watch remains paused.
npm run cli -- watch notifications-test <watch-id> --json
npm run cli -- watch resume <watch-id> --json
```

An individual target receives `initializedAt` only after its own successful
baseline. A blocked, malformed, schema-invalid, or HTTP-failed source remains
uninitialized even when sibling targets succeed. Keep the watch paused, resolve
the failure, and initialize that target again. A valid parsed empty board is a
success with an empty-run counter; an adapter failure must never be reported as
a successful zero-result baseline.

The five bounded board targets set `resultsWanted: 500`. This optional
per-target field accepts integers from 1 through 1000, is stored in the existing
target JSON, participates in material preset diffs, and is forwarded to the
scraper. Legacy watch JSON that omits it keeps the executor's configured default.

Before baselining the expanded preset, run its opt-in live endpoint smoke. This
command is excluded from normal CI:

```bash
npm run smoke:canadian-employers
npm run smoke:canadian-employers -- --company KPMG --json
```

Review every `fail` and `empty` row, official HTTPS application host, parsed
count, GTA count, and Summer 2027 count. A positive advertised count followed
by zero parsed jobs is an extraction failure, not an empty board.

The dated 2026-08-12 full-cohort run completed all 22 endpoints with exit code
0: 18 returned parsed jobs, four authoritatively advertised zero (Loblaw main,
PC Financial, Shoppers Drug Mart, and Bell), none failed, and no direct URL
failed official-host validation. KPMG produced four combined GTA + Summer 2027
+ role matches in the bounded sample. Deloitte's endpoint passed with 109
advertised and 25 parsed GTA jobs, but none had Summer 2027 evidence. Treat the
run as endpoint/parsing evidence, not a claim that every employer currently has
a qualifying opening; repeat it before operational baseline.

Confirm the worker and the first scheduled runs:

```bash
curl http://localhost:3002/health
curl http://localhost:3002/metrics
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
```

Inspect normalized location arrays, external employer application URLs, and
target health, then run two no-notification observation cycles before resuming
the watch and enabling notifications.

The complete setup, verification, pause/resume, and troubleshooting sequence is in the [local runbook](../../docs/runbooks/watcher-local.md).

## Source cadence

Source tiers define both cadence and target-specific eligibility geography.

| Tier | Default cadence | Eligible geography | Intended sources |
| ---- | --------------- | ------------------ | ---------------- |
| Tier 1 | 10 minutes (Wellfound: 30) | Toronto/GTA, Canada | Fixture-backed direct company sources and complete ATS boards |
| Tier 2 | 30 minutes | Toronto/GTA, Canada | Canada Job Bank and validated Google Jobs redundancy |
| Tier 3 | 60 minutes | Toronto/GTA, Canada | Validated unauthenticated LinkedIn public guest search |

The ten-minute cadence means a normal Tier 1 target becomes due every ten minutes; Wellfound uses a 30-minute override. It is not a publication-to-notification service-level guarantee: source runtime, source outages, missing publication timestamps, retries, PostgreSQL availability, and process restarts can add latency. A second run never starts while the same watch still holds its execution lease.

The preset selects explicit targets rather than querying every registered plugin.
Plugin metadata declares whether a source is a complete `board` or a search
`query`; Google Careers and Microsoft declare their actual behavior explicitly.
Query targets build the complete configured Summer 2027 term × location matrix and process a
rotating slice capped by `maxRequestsPerRun`, so a permanently fixed first
country/location cannot starve the remaining matrix. The preset has 19 terms
and 11 Toronto/GTA locations, producing 209 matrix entries for each query
target. Their request caps are 1, 12, 12, and 8 per run respectively. Google Careers therefore makes only one
rotating search per 10-minute run.

## Default source readiness

The v2 inventory separates a registered implementation from permission to poll
it unattended:

| Target | Tier | Production path | Shipped preset state and gate |
| ------ | ---- | --------------- | ----------------------------- |
| Google Careers | 1 | Official Careers results and public detail pages; Toronto/GTA scope | **Target-enabled inside the disabled/uninitialized watch.** Six-suite deterministic validation includes this source; baseline and two observation cycles remain. |
| Shopify | 1 | Official server-rendered careers listing/detail pages; no guessed Ashby slug | **Target-enabled inside the disabled/uninitialized watch.** Deterministic validation passed and the live board was marker-validated as a legitimate empty result. Baseline and two observation cycles remain. |
| Wealthsimple | 1 | Generic Ashby target `ashby:wealthsimple`, branded with `companyName` | **Enabled target** inside the disabled preset watch; baseline before resuming. |
| Plaid | 1 | Generic Ashby target `ashby:plaid` | **Enabled target** inside the disabled preset watch; baseline before resuming. |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel, Meta, Wellfound | 1 | Retained direct-company inventory with Toronto/GTA post-filter scope | **Enabled by operator request.** Baseline every target before resuming; Microsoft's earlier live smoke timed out. |
| Uber, Notion, Ramp, Netflix, IBM | 1 | Complete official company boards; Notion/Ramp delegate to registered Ashby by fixed slug | **Enabled targets inside the disabled/uninitialized watch.** Each is Toronto/GTA-scoped at 10 minutes with `resultsWanted: 500`; disabled live smoke, targeted baseline, and two observation cycles remain operator gates. |
| Canada Job Bank | 2 | Structured Canadian query source | **Enabled target** inside the disabled preset watch; 12 of 209 matrix requests every 30 minutes. |
| Google Jobs | 2 | Toronto/GTA query source with employer application URL extraction | **Disabled.** Fixture/failure gates pass, but the live smoke returned an enable-JavaScript shell; require a successful smoke and baseline. |
| LinkedIn public guest | 3 | Toronto/GTA newest-first 72-hour public search | **Target-enabled inside the disabled/uninitialized watch.** Listing/detail fixtures and unauthenticated live smoke pass; baseline and operator review remain required. |
| RBC, TD, Scotiabank, BMO, CIBC | — | Deferred official bank adapters | **Uncovered by design in this phase.** They remain in the configured company inventory and appear as `uncovered` in coverage reports. |

The target-enabled set is `google_careers`, `shopify`, `ashby:wealthsimple`,
`ashby:plaid`, all 13 legacy direct-company targets listed above,
`uber`, `notion`, `ramp`, `netflix`, `ibm`, `canadajobbank`, and `linkedin`.
Only Google Jobs remains target-disabled. The inventory invariant requires every
target company to have an exact branded target or an explicit deferral; adding an
unclassified name fails validation.

The preset preview is the authoritative report of which targets are enabled in
the installed revision. Do not change a gate to enabled merely because the
package is registered. A successful source fixture proves deterministic parsing;
the separate operator-authorized smoke proves the current public surface is
reachable from the deployment environment.

## Company coverage report

Use the authenticated API endpoint `GET /api/watches/:id/coverage` or the CLI:

```bash
npm run cli -- watch coverage --id <watch-id>
npm run cli -- watch coverage --id <watch-id> --json
```

`CompanyCoverageReport` returns summary counts for `configured`, `active`,
`disabled`, `uncovered`, `initialized`, and `degraded`, followed by one row per
configured company. Each row includes its `active | disabled | uncovered`
status, matching target keys, initialization state, latest attempt/success/
non-empty timestamps, consecutive hard failures, and degradation flag.

Coverage uses normalized exact matching between `watch.companies[]` and
`sourceTargets[].companyName`. A company with an enabled branded target is
active; a company with only disabled branded targets is disabled; a company
with no branded target is uncovered. Generic discovery boards do not satisfy
first-class company coverage even when their query or score allowlist names the
company. For the Canadian Tech Internships preset, the expected summary is 21 active and five
uncovered before considering initialization and runtime degradation.

For Canadian Tech + Adjacent Internships, require exactly 41 configured and 41
active companies, zero uncovered companies, and successful initialization for
every enabled first-party target before resume. Loblaw has three board targets
but one company-coverage row.

## Score and delivery bands

Eligibility is evaluated before ranking. A job requires software/engineering
internship or co-op evidence in the title or structured employment type. A
description-only mention of students, universities, or interns does not qualify a
full-time role. Tier 1 requires at least one Canadian location; Tier 2/3 require
at least one Canadian or US location. Unknown geography is persisted and
suppressed. A hard exclusion or missing condition prevents notification
regardless of numeric score. The match records whether suppression came from a
target baseline or current eligibility. Baseline suppression is permanent for
that episode; eligibility suppression may promote to pending if a later richer
source observation becomes eligible and no delivery exists.

The expanded preset replaces the narrow software-title gate with configured
role families. Generic product and business-analysis titles require explicit
software, digital, platform, data, systems, IT, or technology evidence. General
audit, tax, accounting, finance, marketing, store, pharmacy, manufacturing,
merchandising, office-tour, recruiting-event, talent-community, information-
session, and campus-ambassador postings remain ineligible.

The v2 preset requires explicit Summer 2027 evidence in the title or description.
It recognizes `Summer 2027`, `Summer of 2027`, `Summer '27`, `Summer 27`, and
`2027 Summer`; other or seasonless postings persist with `not-summer-2027`
suppression. PhD/doctoral terms in titles suppress immediately. Descriptions
suppress only when degree language is tied to student, candidate, enrollment,
pursuit, applicant, internship, or program eligibility, so incidental mentions
of PhD colleagues do not remove otherwise eligible roles.

LinkedIn remains Tier 3. A LinkedIn employer matches the Tier 1 company set only
when it matches a `companyName` on a configured Tier 1 source target. Other
LinkedIn totals are capped at one point below the watch's `urgentScore`; those
jobs can still be standard or digest matches but cannot be urgent or display as
`100/100` under the default thresholds. Direct/ATS observations and LinkedIn
observations for Tier 1 companies keep normal scoring.

Google Careers uses the stable official results URL (including Google's numeric
posting ID) for canonical job and notification identity. Its Apply URL is kept
for the notification button but is not identity-bearing because Google decorates
it with the rotating search term, location, locale, and page. After deploying a
canonical-identity change, pause the watch and baseline `google_careers` before
resuming so the corrected identity cannot generate a migration-time alert.

Eligibility is limited to Toronto and the GTA municipality scopes configured by
the preset. Every target sets `strictLocations: true`, and explicit `CA` source
scope is enforced again when results are scored. U.S. results and Canadian
postings outside the configured GTA list are ineligible.

| Default score | Behavior                                             |
| ------------- | ---------------------------------------------------- |
| 80 or higher  | Immediate `urgent` Discord notification              |
| 60–79         | Immediate `standard` Discord notification            |
| 40–59         | Eligible for the 08:00 `America/Toronto` digest pass |
| Below 40      | Persisted silently                                   |

The current digest pass sends up to 25 eligible matches as individual, idempotent digest-typed notifications. It does not yet combine them into one Discord message.

## Discord configuration

Create a webhook in the desired Discord server/channel and set only this environment variable:

```dotenv
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/REDACTED/REDACTED
```

The provider accepts HTTPS Discord webhook hosts and paths, disables mentions,
bounds message fields, and applies a request timeout. Retryable rate-limit,
server, timeout, and network failures are recorded for durable retry. The
idempotency key uses watch + canonical episode + channel and destination. It
deliberately excludes notification type, so a standard/urgent/digest band change
cannot resend. The same posting found on a company board, Google Jobs, and
LinkedIn is delivered once while every source observation remains queryable.
An already-sent episode never reopens. A stable source ID reposted after the
14-day fallback window receives a new episode-scoped observation and may create
one new delivery; a UTC boundary alone cannot do so.

If the URL is exposed, delete or rotate the Discord webhook immediately and update the environment. Never put the URL in the example watch configuration or a database field.

Telegram is not an enabled delivery path in this release. A generic webhook provider exists, but Discord is the documented and tested path for this deployment.

## Main configuration

The defaults are shown in [.env.example](../../.env.example).

| Variable                           | Purpose                                                        | Typical local value                                         |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                     | Prisma/PostgreSQL connection string                            | `postgresql://ever_jobs:ever_jobs@localhost:5432/ever_jobs` |
| `WATCHER_ENABLED`                  | Starts scheduler polling when `true`                           | `true`                                                      |
| `WATCHER_HEALTH_PORT`              | Worker health/metrics port                                     | `3002`                                                      |
| `WATCHER_DEFAULT_TIMEZONE`         | Default watch and digest timezone                              | `America/Toronto`                                           |
| `WATCHER_DEFAULT_INTERVAL_MINUTES` | Default Tier 1 interval for newly created watches              | `3`                                                         |
| `WATCHER_MAX_CONCURRENT_WATCHES`   | Per-process watch concurrency                                  | `2`                                                         |
| `WATCHER_MAX_CONCURRENT_SOURCES`   | Global source concurrency per execution                        | `5`                                                         |
| `WATCHER_SOURCE_TIMEOUT_MS`        | Per-source execution timeout                                   | `12000`                                                     |
| `WATCHER_RETRY_ATTEMPTS`           | Retry ceiling for retryable operations                         | `3`                                                         |
| `WATCHER_RETRY_BASE_DELAY_MS`      | Initial retry delay                                            | `500`                                                       |
| `WATCHER_SCHEDULER_LOCK_TTL_MS`    | PostgreSQL execution-lease lifetime                            | `180000`                                                    |
| `WATCHER_SCHEDULER_POLL_MS`        | Due-watch polling interval                                     | `15000`                                                     |
| `WATCHER_INSTANCE_ID`              | Optional stable replica label for logs/leases                  | generated when omitted                                      |
| `WATCHER_SEED_DEFAULT`             | Safely create the missing disabled default on worker bootstrap | `true`                                                      |
| `DISCORD_WEBHOOK_URL`              | Complete Discord webhook secret                                | set outside source control                                  |
| `DIGEST_ENABLED`                   | Enables scheduled medium-score digests                         | `true`                                                      |
| `DIGEST_DEFAULT_HOUR`              | Digest hour in watch timezone                                  | `8`                                                         |
| `DIGEST_DEFAULT_MINUTE`            | Digest minute in watch timezone                                | `0`                                                         |

The worker reports unhealthy when PostgreSQL is unavailable or when scheduling
is enabled but failed to start. Target history distinguishes a hard failure from
a valid empty result. Three consecutive hard failures on a Tier 1 target mark
coverage degraded in health and metrics without erasing successful sibling
results or pretending the whole run failed. Any non-hard target outcome—success,
valid empty, or partial—resets the consecutive hard-failure streak.

## CLI operations

The CLI imports the same watcher services with its scheduler disabled, so an administrative CLI invocation does not create a competing scheduler.

```bash
npm run cli -- watch show <watch-id> --json
npm run cli -- watch run <watch-id> --json
npm run cli -- watch pause <watch-id> --json
npm run cli -- watch resume <watch-id> --json
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch matches <watch-id> --json
npm run cli -- watch metrics <watch-id> --json
npm run cli -- watch coverage --id <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
npm run cli -- watch initialize <watch-id> --target <target-key> --json
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id> --apply
npm run cli -- watch preset apply canadian-tech-adjacent-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-adjacent-internships --watch <watch-id> --apply
```

Use `watch run` for a manual post-initialization run. Use `watch initialize`
for a no-notification baseline; repeat `--target` to select several target keys,
or omit it for all enabled targets. Preset apply is a dry-run JSON diff unless
`--apply` is present, and mutation rejects an enabled watch.

Target `resultsWanted`, mode, company URL, search scope, site, company identity,
role families, tier, and interval
are material preset configuration. When upgrading an existing watch, pause it,
preview/apply the current template, and baseline the enabled target keys
reported in `targetKeysRequiringInitialization` before resuming. Applying to a
legacy Canada/USA watch replaces its top-level geography and materially changes
each preset-owned target scope.

To migrate an older watch, keep it paused through preview, apply, coverage
inspection, and a no-notification baseline of every reported target:

```bash
node dist/apps/cli/main.js watch pause <watch-id> --json
node dist/apps/cli/main.js watch preset apply canadian-tech-internships --watch <watch-id>
node dist/apps/cli/main.js watch preset apply canadian-tech-internships --watch <watch-id> --apply
node dist/apps/cli/main.js watch coverage --id <watch-id> --json
node dist/apps/cli/main.js watch initialize <watch-id> --json
```

Inspect every target result. Retry failures or disable a failing target before
running `watch resume`; do not treat a partial baseline as complete. A fresh
watch must baseline every enabled target reported by its preset diff.

The current example is
[Canadian Tech Internships](../../examples/canadian-tech-internships.watch.json).
The older Canada/USA and broad-Canada example paths remain only as deprecated
compatibility artifacts.

The authenticated API supplies the equivalent watch CRUD, initialization, run, pause/resume, run history, match, metric, company-coverage, observed-job, and notification-delivery endpoints. Company coverage is available at `GET /api/watches/:id/coverage`. Run the API separately with `npm run start:dev`; it is not required when managing a local worker exclusively through the CLI.

## Docker

The Compose watcher uses the `watcher-runtime` Docker target, publishes port 3002, and has its own `/health` check. Its dependency graph starts PostgreSQL, runs the one-shot `watcher-migrate` service, and starts `ever-jobs-watcher` only after migration succeeds. With `WATCHER_SEED_DEFAULT=true`, worker bootstrap creates the missing default as a disabled baseline watch; it never resets an existing watch.

```bash
docker compose up -d --build ever-jobs-watcher
docker compose ps --all postgres watcher-migrate ever-jobs-watcher
docker compose logs -f ever-jobs-watcher
```

For host-side CLI management, install dependencies and generate the Prisma client with `npm ci` and `npm run db:generate`. Host commands use `DATABASE_URL` with `localhost`; Compose uses `COMPOSE_DATABASE_URL` with the `postgres` service hostname. `npm run db:seed` remains available when an explicit host-side seed is preferred, but it is not required for a fresh Compose worker while safe bootstrap seeding is enabled.

Rebuilding reruns `prisma migrate deploy`, which is idempotent for already-applied migrations. Bootstrap seeding only creates a missing named watch. Do not start both the host worker and the Compose worker unless you intentionally want a multi-replica test. PostgreSQL leases make that safe, but both processes will poll and emit logs.

## Metrics

The Prometheus endpoint includes counters, gauges, and histograms for watch runs, target
requests and duration, hard failures versus valid empty runs, fetched and newly
detected jobs, matches, notification outcomes, canonical duplicate suppression,
execution duration, detection/notification latency, scheduler poll time, active
runs, and aggregate Tier 1 degradation. Key series use the
`ever_jobs_watcher_` prefix.

Durable target health records attempts, successes, hard failures, valid empty
runs, partial runs, consecutive hard failures, last success, last non-empty time,
degradation time, and baseline time. Run history remains the per-execution audit
record; provider attempts remain the notification-delivery record. Prometheus
process metrics reset when the worker restarts.

Persisted `targetHealth[targetKey]` contains `targetKey`, `tier`, `successCount`,
`hardFailureCount`, `emptyRunCount`, `partialRunCount`,
`consecutiveHardFailures`, `lastAttemptAt`, `lastSuccessAt`, `lastNonEmptyAt`, and
`degradedAt`. Each run's `targetResults[]` records target/tier, request/job/time
counts, `status` (`succeeded`, `partial`, or `failed`), `outcome` (`success`,
`empty`, `partial`, or `hard_failure`), empty/hard/degraded flags, streak, and
success/non-empty timestamps. Run-level `coverageDegraded` summarizes Tier 1.

Target coverage series are:

- `ever_jobs_watcher_target_runs_total{watch,target,tier,outcome}`
- `ever_jobs_watcher_target_consecutive_hard_failures{watch,target,tier}`
- `ever_jobs_watcher_target_degraded{watch,target,tier}`
- `ever_jobs_watcher_target_last_success_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_target_last_non_empty_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_tier1_coverage_degraded{watch}`
- `ever_jobs_watcher_company_coverage{watch_id,status}` where `status` is one of
  `configured`, `active`, `disabled`, `uncovered`, `initialized`, or `degraded`

The separate API metrics registry initializes `ever_jobs_sources_total` from
the discovered plugin registry at application startup. It is no longer a
hard-coded catalog total, so enabling or disabling discovered plugins changes
the gauge without a source-count code edit.

Any non-hard outcome (`success`, valid `empty`, or `partial`) resets the target's
hard-failure streak. A fully successful zero-job target increments
`emptyRunCount`; a partial target increments `partialRunCount`; neither is a hard
failure.
Count-collapse alert thresholds remain an operator policy based on historical
`jobsFetched` and `lastNonEmptyAt`, not a hard-coded runtime heuristic.

## Production deployment

The current production recommendation is a private Cloud Run service with instance-based billing, one minimum instance, one maximum instance, and `WATCHER_HEALTH_PORT=8080`. Request-based CPU is not suitable for this in-process background scheduler. Store `DATABASE_URL` and `DISCORD_WEBHOOK_URL` in Secret Manager, attach Cloud SQL securely, and run migrations/seed before enabling the watch.

See the [Google Cloud runbook](../../docs/runbooks/watcher-google-cloud.md) before deploying. It explains why Cloud Run Jobs are not appropriate for this long-running process, when a Cloud Run worker pool may be used, and which always-on settings create cost.

## Honest limitations

- The watcher improves discovery speed but cannot guarantee that a posting is observed within exactly three minutes or that the user is the first applicant.
- Live source plugins can change, throttle, fail, or return incomplete data; source-specific terms and rate limits still apply.
- Cross-source canonical episodes suppress duplicate matches and deliveries, but
  deliberately retain separate source observations for provenance.
- A URL/date-less fallback episode is anchored at first observation and reused
  for a rolling 14 days; UTC calendar boundaries do not split it.
- Publication time is not fabricated. When a source omits it, latency begins at rad.ar's first observation instead.
- Target baseline is independent. A failed target remains uninitialized; never
  resume until every required changed target has either succeeded or been
  explicitly left disabled.
- Discord availability and rate limits can delay delivery, although retry state is persisted.
- The default digest is 08:00 in `America/Toronto`; watch timezone and daylight-saving changes affect the corresponding UTC instant.
- This release does not submit applications, bypass access controls, automate logins, solve CAPTCHAs, or guarantee source coverage.
- LinkedIn public guest results are best effort and cannot exactly reproduce a
  personalized account alert. No login, cookies, authenticated browser session,
  or CAPTCHA/challenge bypass is used.
- Registration or fixture coverage alone never permits unattended polling.
  Target-enabled sources remain inert inside the paused watch until their
  targeted baseline and two no-notification observation cycles pass.
- The digest pass sends individual digest notifications rather than one grouped daily summary.
- A Cloud Run minimum instance and Cloud SQL incur ongoing charges even when no jobs are found.
