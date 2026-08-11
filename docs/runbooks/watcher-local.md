# Local Watcher Operations Runbook

This runbook takes a clean rad.ar checkout to a continuously running local
watcher for software internships and co-ops. It covers the dry-run-first
Canadian Tech Internships preset, per-target baseline, 10/30/60 cadence,
Toronto/GTA geography, Discord,
Docker, the Spec 6002 localhost operator GUI, named Discord routing,
target-health alerts, rollback, and failure recovery.

The detailed component reference is in the
[watcher application guide](../../apps/watcher/README.md). The base functional
contract is [Spec 016](../../.specify/specs/016-realtime-job-watcher/spec.md);
[Spec 6000](../../.specify/specs/6000-prestige-internship-coverage-expansion/spec.md)
defines the target-aware coverage expansion and takes precedence only for its
listed amendments. [Spec 6002](../../.specify/specs/6002-local-operator-gui/spec.md)
defines the additive GUI, safe-apply, named-destination, and notification-routing
contracts.
[Spec 6003](../../.specify/specs/6003-canadian-tech-internships/spec.md)
replaces the selectable preset and geography with the Toronto/GTA-only profile.

## 1. Operating model

The watcher is a long-running NestJS HTTP process with an in-process scheduler. PostgreSQL provides persistence, due-watch discovery, and distributed execution leases. The worker invokes the existing rad.ar source plugins; it does not call the rad.ar REST API to search.

There are three independently due source tiers:

| Tier | Default interval | Eligibility geography | Purpose |
| ---- | ---------------- | --------------------- | ------- |
| Tier 1 | 10 minutes (Wellfound: 30) | Toronto/GTA, Canada | Fixture-backed direct company and complete ATS targets |
| Tier 2 | 30 minutes | Toronto/GTA, Canada | Canada Job Bank and validated Google Jobs redundancy |
| Tier 3 | 60 minutes | Toronto/GTA, Canada | Validated unauthenticated LinkedIn public guest redundancy |

The scheduler polls PostgreSQL every 15 seconds by default. Therefore, the normal start delay after a tier becomes due is up to one scheduler poll, subject to another run holding the lease, database availability, process load, and jitter. The interval is a target cadence rather than an end-to-end notification guarantee.

### Default source readiness

`canadian-tech-internships` carries the intended target inventory, but its preview
and source-audit record are authoritative for enablement. A plugin being
registered is not an unattended-readiness claim.

| Target | Tier | Intended path | Shipped preset state and remaining gate |
| ------ | ---- | ------------- | --------------------------------------- |
| Google Careers | 1 | Official Careers results/details, Toronto/GTA query scope | **target-enabled inside the disabled/uninitialized watch**; deterministic validation passed and live smoke returned two Canadian roles; baseline and two observation cycles remain |
| Shopify | 1 | Official server-rendered careers pages | **target-enabled inside the disabled/uninitialized watch**; deterministic validation passed and live board was marker-validated empty; baseline and two observation cycles remain |
| Wealthsimple | 1 | `ashby:wealthsimple`, branded through the maintained Ashby plugin | **enabled target** inside the disabled preset watch; baseline before resume |
| Plaid | 1 | `ashby:plaid` through the maintained Ashby plugin | **enabled target** inside the disabled preset watch; baseline before resume |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel, Meta, Wellfound | 1 | retained direct-company inventory with Toronto/GTA post-filter scope | **enabled by operator request**; baseline each before resume; Microsoft's earlier live smoke timed out |
| Uber, Notion, Ramp, Netflix, IBM | 1 | complete official boards; Notion/Ramp delegate to registered Ashby by fixed slug | **enabled targets inside the disabled/uninitialized watch**; 10-minute Toronto/GTA scope, `resultsWanted: 500`, disabled live smoke, baseline, and two observation cycles remain |
| Canada Job Bank | 2 | Structured Canadian query source | **enabled target** inside the disabled preset watch; 12 of 209 matrix requests every 30 minutes |
| Google Jobs | 2 | Toronto/GTA query redundancy | **disabled**; fixtures/failure handling pass, but live smoke returned an enable-JavaScript shell |
| LinkedIn public guest | 3 | Toronto/GTA newest-first 72-hour query | **target-enabled inside the disabled/uninitialized watch**; listing/detail fixtures and unauthenticated live smoke pass; baseline and operator review remain |
| RBC, TD, Scotiabank, BMO, CIBC | — | deferred official bank adapters | **uncovered by design for Phase 13** and visible in the coverage report |

The target-enabled set is `google_careers`, `shopify`, `ashby:wealthsimple`,
`ashby:plaid`, all 13 legacy direct-company targets, `uber`, `notion`, `ramp`,
`netflix`, `ibm`, `canadajobbank`, and `linkedin`. Target-enabled does not start
polling or notifications while the watch is paused. Only Google Jobs remains
target-disabled.

The target-company inventory has one auditable classification per company: 21 names
have an exact branded company/ATS target and five banks are explicitly deferred.
Generic LinkedIn, Canada Job Bank, and Google Jobs results are redundancy and do
not turn an uncovered company into covered status.

Pre-Phase-13 source evidence was six deterministic suites/59 tests; Google Careers
two live Canadian roles; Shopify valid empty; Wealthsimple 37 live Ashby roles
with a capped mapped sample; LinkedIn public listing/detail pass; Microsoft
timeout; and Google Jobs classified blocked by the enable-JavaScript shell.

The preset has 19 search terms and 11 Toronto/GTA locations, producing 209
term/location entries for each generic query target. The rotating per-run caps
are 1, 12, 12, and 8 respectively. Google Careers therefore makes one rotating
request every 10 minutes.

Every preset target sets `strictLocations: true`. At least one advertised job
location must match the configured GTA list, and its explicit `CA` country scope
is enforced during scoring even for Tier 2/3 results.

Do not enable a target to make the matrix look complete. Perform the source live
smoke before target enablement, then keep the global watch paused. Inspect all
normalized locations and employer application URLs, apply the preset, targeted-
baseline added/materially changed targets, and run two additional
no-notification observation cycles before resume.

For Uber, Notion, Ramp, Netflix, and IBM, the operator-authorized disabled smoke
must inspect source-prefixed stable IDs, official job and application URLs, every
advertised location, posting dates, employment types, and the source's validated
jobs-collection or empty-board marker. A transport error, non-success response,
malformed payload, missing delegated Ashby plugin, or blocked HTML shell is a
hard failure and cannot establish an empty baseline.

Every scheduled run follows this order:

1. Acquire the watch's PostgreSQL execution lease.
2. Determine which source tiers are due.
3. Build each query target's bounded rotating term × location request slice.
4. Query sources with bounded concurrency, timeout, retry, and jitter.
5. Normalize all locations and persist source observations plus canonical episodes.
6. Apply target-tier geography eligibility separately from preference ranking.
7. Persist explainable matches and canonical-episode-idempotent deliveries.
8. Persist run totals, target success/empty/partial/hard-failure outcomes,
   duration, and latency.
9. Release the lease and schedule the next tier due time.

## 2. Prerequisites

- A checkout of this repository.
- Node.js 22 or newer for parity with the production Docker image.
- Docker Desktop or another Docker Engine with Compose.
- A Discord server where you can create a channel webhook.
- Network access to the configured public career sources.

PostgreSQL is required. Redis is not required for the watcher scheduler.

## 3. Create local configuration

Copy the example file from the repository root:

```bash
cp .env.example .env
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env
```

At minimum, verify these entries in `.env`:

```dotenv
DATABASE_URL=postgresql://ever_jobs:ever_jobs@localhost:5432/ever_jobs
WATCHER_ENABLED=true
WATCHER_HEALTH_PORT=3002
WATCHER_DEFAULT_TIMEZONE=America/Toronto
WATCHER_DEFAULT_INTERVAL_MINUTES=3
WATCHER_SCHEDULER_POLL_MS=15000
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/REDACTED/REDACTED
DIGEST_ENABLED=true
DIGEST_DEFAULT_HOUR=8
DIGEST_DEFAULT_MINUTE=0
```

Treat `DISCORD_WEBHOOK_URL` as a password. Put it only in an untracked local environment file or a secret manager. Do not put it in watch JSON, a CLI argument, source code, documentation examples with real values, screenshots, issue reports, or commits. The database stores `destinationRef: "default"`, not the full webhook URL.

Spec 6002 also supports GUI-managed custom Discord aliases in the ignored
repository-root `.env.local`. Do not add `.env.local` to Git. A custom reference
such as `tier-one` maps to `DISCORD_WEBHOOK_TIER_ONE`; watches and routes still
store only `destinationRef: "tier-one"`. Non-empty process-environment values
take precedence over the local file and appear read-only in the GUI.

The application accepts only an HTTPS Discord webhook on an approved Discord host and webhook path. It strips query parameters before adding its own `wait=true`, disables Discord mentions, and applies bounded payload and timeout handling.

## 4. Start PostgreSQL and prepare the schema

Start only PostgreSQL first:

```bash
docker compose up -d postgres
docker compose ps postgres
```

Install dependencies from the lock file and prepare Prisma:

```bash
npm ci
npm run db:generate
npm run db:migrate
```

`db:migrate` uses `prisma migrate deploy`; it applies checked-in migrations and does not create an ad hoc development migration.

Seed the default watch:

```bash
npm run db:seed
```

On a database with no watches, the seed creates `Canadian Tech Internships`
from `canadian-tech-internships`. It is globally disabled,
uninitialized, has no `nextRunAt`, uses `baseline` initialization, and points its
Discord channel at the environment reference `default`. If any watch already
exists, the seed returns the first existing watch without creating, upgrading,
or overwriting legacy/custom configuration, initialization state, or timestamps.

Keep the printed watch ID. If it scrolls out of view, retrieve it later:

```bash
npm run cli -- watch list --json
```

## 5. Start and verify the worker

Start the development worker in its own terminal:

```bash
npm run start:watcher:dev
```

The command should remain running. In another terminal, verify health:

```bash
curl http://localhost:3002/health
```

Inspect `coverage.status`, `coverage.tier1Degraded`,
`coverage.degradedTargets`, and `coverage.watches`. When checking the separately
deployed API health endpoint, the equivalent summary is
`watcherCoverage.{status,tier1Degraded,watches}`.

PowerShell equivalent:

```powershell
Invoke-RestMethod http://localhost:3002/health
```

Expected health properties are:

- `status` is healthy.
- `database` reports healthy.
- the scheduler reports enabled and started.
- `notifications.discordConfigured` is `true`.

If `WATCHER_ENABLED=false`, the process can be healthy for diagnostics but will not run scheduled watches. If scheduling is enabled and failed to start because PostgreSQL is unavailable, `/health` returns an unhealthy response.

## 6. Baseline before enabling alerts

Do not resume a fresh or upgraded watch before preset review and baseline. The
baseline records current jobs without notifying them and is tracked separately
for each source target.

Identify the watch and inspect it:

```bash
npm run cli -- watch list --json
npm run cli -- watch show <watch-id> --json
```

Preview the versioned preset. This command emits a JSON diff and changes no
state:

```bash
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
```

Confirm the watch is paused and inspect targets classified as unchanged, added,
materially changed, disabled, or operator-only. Applying requires an explicit
flag:

```bash
npm run cli -- watch preset apply canadian-tech-internships \
  --watch <watch-id> \
  --apply
```

Preset apply preserves notification destinations, score thresholds, history,
terms, companies, and unrelated operator edits, while replacing top-level
locations and country codes so stale U.S. geography cannot survive. It rejects
an enabled watch. Material target
changes include site, company slug/name, tier, interval, `resultsWanted`, or
search scope. `resultsWanted` accepts only integers from 1 through 1000, is
stored in the existing target JSON, and is forwarded to the scraper. Omitting it
from legacy watch JSON retains the executor default.

Run initialization only for target keys reported as added or materially changed:

```bash
npm run cli -- watch initialize <watch-id> \
  --target uber \
  --target notion \
  --target ramp \
  --target netflix \
  --target ibm \
  --json
```

`--target` is repeatable. Omit it to force every enabled target now rather than
waiting for its configured cadence. Unknown, disabled, or duplicate keys are
validated errors. Depending on target count, query-matrix budgets, and timeouts,
initialize-all can take longer than a normal Tier 1 run.

For an upgrade from revision 2, the preview should report exactly `uber`,
`notion`, `ramp`, `netflix`, and `ibm` as added and requiring initialization.
For a fresh watch, initialize every key that the preview reports; do not assume
only those five need a baseline.

Review the returned and persisted run summary, especially:

- `sourcesRequested`, `sourcesSucceeded`, and `sourcesFailed`;
- `jobsFetched`, `jobsNormalized`, and `newJobsDetected`;
- run status and error summary;
- each target's hard-failure versus valid-empty classification and
  `initializedAt` value, including partial request outcomes;
- normalized `locations`, matched country/confidence, geography decision, and
  external employer application URL samples;
- that `notificationsSent` is zero.

Repeat the same targeted initialization command for two additional observation
cycles while the watch remains paused. Both runs must send zero notifications;
inspect their target outcomes before considering resume.

Inspect run history when needed:

```bash
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch coverage --id <watch-id> --json
```

If a required target hard-failed, leave it disabled or correct the source and run
targeted initialization again while the watch remains paused. Successful sibling
targets keep their baseline. A hard-failed target never receives
`initializedAt`, and a blocked/malformed response must not be accepted as an
empty success.

If one of the five new sources fails its disabled live smoke or baseline,
disable that target individually and rerun the coverage report. Its company must
remain visible as `disabled`; the failure must not block healthy sibling targets
or be reclassified as a valid empty board.

Baseline mode prevents an initial flood; it cannot infer jobs from a target that
never completed. A valid parsed empty board may initialize successfully, but its
empty-run count and last non-empty time remain visible for collapse monitoring.

### Inspect company coverage

The CLI and authenticated API expose the same company-level projection:

```bash
npm run cli -- watch coverage --id <watch-id> --json
curl -H "x-api-key: $EVER_JOBS_API_KEY" \
  http://localhost:3001/api/watches/<watch-id>/coverage
```

`CompanyCoverageReport.summary` contains `configured`, `active`, `disabled`,
`uncovered`, `initialized`, and `degraded` counts. Its `companies[]` rows contain
the configured company name, coverage status, matching target keys,
initialization state, last attempt/success/non-empty timestamps, consecutive hard
failures, and degradation flag.

Matching normalizes case, Unicode, punctuation, and common legal suffixes, then
requires an exact company name match against `sourceTargets[].companyName`. An enabled matching
target yields `active`, only disabled matching targets yield `disabled`, and no
matching branded target yields `uncovered`. Generic job boards do not count.
Before baselines or runtime failures affect the health counts, the Canadian
Tech Internships preset should show 21 active companies and the five deferred
banks as uncovered.

## 7. Test Discord without creating a fake match

Run the configuration test while the watch is still disabled:

```bash
npm run cli -- watch notifications-test <watch-id> --json
```

This sends a provider configuration test directly. It does not insert a fake observed job, watch match, or production delivery record.

If it fails:

1. Confirm `DISCORD_WEBHOOK_URL` is available to the CLI process.
2. Confirm the webhook still exists and targets the intended Discord channel.
3. Confirm the URL starts with `https://discord.com/api/webhooks/` or an accepted Discord canary/PTB host.
4. Confirm the machine can reach Discord over HTTPS.
5. Rotate the webhook if it may have been exposed.

Do not print the environment variable or include the URL in diagnostic output.

## 8. Enable the reviewed 10/30/60 pipeline

After a satisfactory baseline and Discord test, resume the watch:

```bash
npm run cli -- watch resume <watch-id> --json
```

Resume sets `enabled=true` and makes the watch schedulable. The next scheduler
poll picks up a due watch; subsequent normal Tier 1 executions follow the ten-minute
interval. Tier 2 and Tier 3 run only when independently due. Unproven targets
must still be disabled; resuming the watch does not waive a target smoke gate.

Allow at least two Tier 1 intervals, then inspect operations:

```bash
npm run cli -- watch show <watch-id> --json
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch matches <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
npm run cli -- watch metrics <watch-id> --json
```

No Discord message is expected when no newly observed canonical episode exceeds
the immediate threshold. That is a successful quiet run only when run history
shows the expected target succeeded or returned a valid empty result. A hard
failure, stale last-success time, or degraded Tier 1 state is not a successful
zero-result cycle.

Use a manual normal run when you need an immediate check without changing scheduling:

```bash
npm run cli -- watch run <watch-id> --json
```

A manual run after initialization uses normal new-job and notification semantics. Do not use `initialize` as an ordinary refresh because it intentionally suppresses notifications.

## 9. Pause, resume, and shutdown

Pause future scheduled execution:

```bash
npm run cli -- watch pause <watch-id> --json
```

Pausing does not delete observations, matches, deliveries, or run history. A currently executing run may finish; the lease prevents a replacement run from overlapping it.

Resume later:

```bash
npm run cli -- watch resume <watch-id> --json
```

Stop the development worker with `Ctrl+C`. It stops scheduler polling and waits for active runs for up to the configured shutdown window before the process exits. Restarting is safe: due state and leases live in PostgreSQL, and notification idempotency lives in the database.

## 10. Health and Prometheus metrics

Read health:

```bash
curl http://localhost:3002/health
```

Read Prometheus text:

```bash
curl http://localhost:3002/metrics
```

Important series include:

- `ever_jobs_watcher_runs_total`
- `ever_jobs_watcher_source_requests_total`
- `ever_jobs_watcher_jobs_fetched_total`
- `ever_jobs_watcher_new_jobs_total`
- `ever_jobs_watcher_matches_total`
- `ever_jobs_watcher_notifications_total`
- `ever_jobs_watcher_duplicates_suppressed_total`
- `ever_jobs_watcher_run_duration_seconds`
- `ever_jobs_watcher_source_duration_seconds`
- `ever_jobs_watcher_detection_latency_seconds`
- `ever_jobs_watcher_notification_latency_seconds`
- `ever_jobs_watcher_scheduler_last_poll_timestamp_seconds`
- `ever_jobs_watcher_scheduler_active_runs`
- `ever_jobs_watcher_target_runs_total{watch,target,tier,outcome}`
- `ever_jobs_watcher_target_consecutive_hard_failures{watch,target,tier}`
- `ever_jobs_watcher_target_degraded{watch,target,tier}`
- `ever_jobs_watcher_target_last_success_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_target_last_non_empty_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_tier1_coverage_degraded{watch}`
- `ever_jobs_watcher_company_coverage{watch_id,status}` with bounded `status`
  values `configured`, `active`, `disabled`, `uncovered`, `initialized`, and
  `degraded`

Retain the target key/tier labels in alerts. Alert operationally when:

- health is unavailable, the database/scheduler is unhealthy, or poll freshness
  exceeds two expected polling periods;
- aggregate Tier 1 coverage reports degraded;
- a Tier 1 target reaches three consecutive hard failures;
- a target has no success for more than two of its expected intervals plus
  normal run duration;
- a normally non-empty target's result count collapses unexpectedly across
  consecutive successful runs;
- notification terminal failures or retry exhaustion accumulate.

A valid parsed empty result increments the empty-run counter and is not a hard
failure. Investigate it against `lastNonEmptyAt` and the target's historical
baseline rather than paging on every naturally empty board. One target failure
does not erase successful siblings or make the whole worker unavailable, but a
degraded Tier 1 signal is an explicit coverage incident.

The API's `ever_jobs_sources_total` gauge is set from the plugin registry's
actual discovered size during application initialization. Do not compare it to
the old hard-coded value of 160; alert on unexpected changes relative to the
deployment's enabled plugin configuration.

Prometheus in-process counters reset on restart. PostgreSQL run and delivery history is durable and remains the audit source.

## 11. Docker worker path

Use this path when the worker itself should run in Compose rather than through the development command.

Build and start the watcher container from the repository root:

```bash
docker compose up -d --build ever-jobs-watcher
docker compose ps --all postgres watcher-migrate ever-jobs-watcher
docker compose logs -f ever-jobs-watcher
```

Compose starts healthy PostgreSQL, runs `watcher-migrate` as a one-shot `prisma migrate deploy`, and starts `ever-jobs-watcher` only after migration succeeds. The worker publishes `${WATCHER_HEALTH_PORT:-3002}:3002` and checks `/health`. With `WATCHER_SEED_DEFAULT=true`, bootstrap creates the missing default watch in disabled baseline mode and leaves existing watches untouched.

Install host dependencies and generate the client before using the host CLI:

```bash
npm ci
npm run db:generate
```

Run CLI management commands from the host against the same local database:

```bash
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id> --apply
npm run cli -- watch initialize <watch-id> --target <target-key> --json
# Repeat targeted initialization for the full enabled set for two additional
# no-notification observation cycles; inspect both before continuing.
npm run cli -- watch notifications-test <watch-id> --json
npm run cli -- watch resume <watch-id> --json
```

Compose overrides the worker's `DATABASE_URL` with `COMPOSE_DATABASE_URL`, which uses the `postgres` service hostname. Host CLI commands use `DATABASE_URL`, normally with `localhost`. `npm run db:seed` is available for an explicit host-side seed but is not required for a fresh Compose worker while bootstrap seeding is enabled.

Rebuilding reruns migration deployment safely and idempotently; it does not regenerate or roll back migrations. Restarting never resets watch state, and the bootstrap seeder never updates an existing named watch.

Do not leave `npm run start:watcher:dev` running while the Compose watcher is active unless testing multiple replicas intentionally. Multiple replicas are correctness-safe because of PostgreSQL leases, but both poll the database and produce logs.

## 12. Authenticated REST management

The watcher HTTP process exposes only `/health` and `/metrics`. To manage watches over REST, run the existing API separately:

```bash
npm run start:dev
```

Use the repository's API-key authentication convention for watcher management endpoints. The API provides watch CRUD, default creation, manual run, initialization, pause/resume, run history, matches, metrics, company coverage (`GET /api/watches/:id/coverage`), observed-job queries, delivery history, and notification tests.

For a single local operator, the CLI is the simplest path and does not require the API process. The CLI loads the watcher module with scheduling disabled, so commands cannot create a second scheduler.

## 13. Troubleshooting

### Health says database is unhealthy

Check PostgreSQL, credentials, port, and migrations:

```bash
docker compose ps postgres
npm run db:migrate
```

For a host process, `DATABASE_URL` normally uses `localhost:5432`. Inside Compose, the watcher must use the `postgres` service hostname; the checked-in Compose service supplies that override.

### Scheduler is not running

Verify `WATCHER_ENABLED=true`, restart the worker, and inspect startup logs. The scheduler deliberately refuses to start when its initial database health check fails.

### The watch has no scheduled runs

Verify that the watch is enabled and initialized:

```bash
npm run cli -- watch show <watch-id> --json
```

If it is paused, resume it. If it was never baselined, initialize it before resuming. Also check that a stale-looking run is not actually still active and holding a valid lease.

### Runs complete but there are no Discord messages

This is normal when there are no new matches above the immediate score threshold. Inspect `newJobsDetected`, matches, and delivery history. Run `notifications-test` to isolate provider configuration from job matching.

Medium-quality matches are held for the daily digest; low scores are persisted silently. Hard exclusions do not notify.

### A source repeatedly fails

Inspect the target result's `status`, `outcome`, request success/failure counts,
sanitized error, duration, `consecutiveHardFailures`, and `degraded`. A target with
zero successful requests is a hard failure. A fully successful target with zero
jobs is a valid empty run; investigate repeated empties against
`lastNonEmptyAt` and historical `jobsFetched` rather than rewriting the result as
a failure. A partial target has at least one successful request and at least one
failed request; it increments `partialRunCount`. Success, valid empty, and
partial outcomes all reset `consecutiveHardFailures` because none is a target
hard failure.

Do not shorten intervals, add credentials, reuse cookies, bypass access controls,
or enable a target merely to remove a warning. Disable the individual target,
repair its public path, rerun fixtures and failure cases, perform the disabled
smoke, and baseline that target before enabling it again. Keep the company
visible as disabled coverage while its target is off. Wealthsimple and Plaid use
Ashby slugs `wealthsimple` and `plaid`; Notion and Ramp delegate through the
plugin registry using their fixed official Ashby slugs. No private or guessed
board endpoint is allowed.

### A duplicate Discord message appears

Check whether it is a distinct canonical episode, destination, or channel.
Normal delivery identity is watch + canonical episode + channel/destination,
independent of source observation and notification type. A standard, urgent, or
digest band change cannot resend the same episode to the same destination.
Inspect the canonical key, normalized sorted locations, external employer
application URL, and `canonicalEpisodeStartedAt`. A URL/date-less fallback
episode is anchored at first observation and reused for a rolling 14 days; UTC
calendar boundaries do not split it. Preserve the database when restarting; a
fresh database has no canonical or delivery history.

### Initialization reported source failures

Keep the watch paused. Successful targets retain their baseline; failed targets
remain uninitialized. Resolve or explicitly disable each failed target and rerun
`watch initialize <id> --target <key>`. Never treat a partial overall run as
evidence that every target was baselined.

### The ten-minute target is missed

Check scheduler poll freshness, previous run duration, source timeouts/retries, lease state, PostgreSQL health, and process uptime. The scheduler does not overlap a slow run of the same watch. A source publication timestamp can also be delayed or absent; rad.ar does not fabricate it.

## 14. Readiness checklist

- [ ] `.env` exists locally and is not committed.
- [ ] `.env.local`, when used for GUI-managed destination aliases, is ignored and
      contains no committed or copied secret material.
- [ ] PostgreSQL is healthy.
- [ ] Prisma client generation and migrations completed.
- [ ] The seed printed the newly created or already-existing intended watch.
- [ ] `/health` reports healthy database and started scheduler.
- [ ] Discord configuration is reported as present.
- [ ] `watch preset apply canadian-tech-internships --watch <id>` was reviewed as a dry run before `--apply`.
- [ ] The preset was applied only while the watch was paused.
- [ ] Preview confirms `US`, `United States`, broad Canada, and Waterloo are absent from the applied watch and target scopes.
- [ ] `watch coverage --id <id>` reports all 26 target companies, with 21 active and RBC, TD, Scotiabank, BMO, and CIBC uncovered before health-state changes.
- [ ] Every added/materially changed enabled target has its own successful `initializedAt` and baseline sent zero notifications.
- [ ] Hard-failed targets were repaired and re-baselined or explicitly left disabled.
- [ ] Every enabled Tier 1 target has fixture-backed Toronto/GTA query/post-filter evidence.
- [ ] New/repaired targets completed an operator-authorized live smoke while disabled; normalized locations and employer application URLs were inspected.
- [ ] The Discord configuration test reached the correct channel.
- [ ] The watch was resumed only after baseline and provider testing.
- [ ] Two additional no-notification observation runs appear in history for the
      target-enabled set, including both Tier 1 cycles.
- [ ] `ever_jobs_watcher_tier1_coverage_degraded{watch}` is zero and no enabled Tier 1 target is degraded.
- [ ] `ever_jobs_watcher_company_coverage{watch_id,status}` reflects the coverage report counts.
- [ ] Delivery and match queries work.
- [ ] The webhook URL exists only in local environment/secret storage.

## 15. Local operator GUI workflow (Spec 6002)

The GUI is an additive operator surface over the same PostgreSQL records and
services used above. Use it when you want validated forms, visible diffs,
health/history dashboards, and notification routing instead of issuing every
CLI command manually. The CLI remains available for automation and recovery.

### Start the localhost stack

Install dependencies and ensure PostgreSQL is reachable through `DATABASE_URL`.
Then start the development stack from the repository root:

```bash
npm run gui:dev
```

For the built local stack, use:

```bash
npm run gui
```

The launcher deploys checked-in Prisma migrations, starts the API on
`127.0.0.1:3001`, starts the watcher health service on `127.0.0.1:3002`, starts
the web application on `127.0.0.1:3000`, and prints the canonical URL:

```text
http://127.0.0.1:3000
```

All three listeners bind to loopback in this local mode. The web development
proxy forwards relative API and watcher-health requests; browser code does not
embed a second deployment URL. If a child process fails during startup, the
launcher terminates its siblings rather than leaving a partial stack. `Ctrl+C`
forwards shutdown to all three processes.

The launcher does not seed a production watch implicitly. On an empty database,
use New watch and choose the safe default preset, or run `npm run db:seed`
explicitly. The default remains paused and baseline-required.

### Authenticate the browser session

Open Settings and enter the existing `EVER_JOBS_API_KEY` value. The GUI keeps it
only in browser `sessionStorage`. It is cleared when the tab session ends. It is
never copied into a watch, route, PostgreSQL row, `.env.local`, local storage,
IndexedDB, cookie, query string, screenshot, or download.

An absent or invalid key leaves protected calls unauthorized. Do not weaken or
disable the API guard to make the GUI work. Health and connection errors remain
visible separately from authentication errors.

### Read Overview correctly

Overview separates:

- API reachability and database health;
- watcher process reachability;
- scheduler enabled/started state;
- Discord configured state;
- source and Tier 1 coverage health;
- each watch's enabled/paused state, initialization, next run, recent matches,
  recent failures, and recent delivery status.

The browser never starts or restarts the worker. A button labeled Start watcher
or Resume calls the existing persisted-watch Resume behavior. If the worker is
unavailable, resuming a watch makes it eligible for later scheduling but cannot
make an absent process run. Conversely, pausing one watch does not stop the
worker or other watches.

### Create or edit a watch

Use Watches to create a blank watch, create the safe default, clone an existing
watch, or open a saved watch. The profile builder edits the public watch
configuration:

- name and description;
- schedule, interval, and timezone;
- source, company slug/name, source tier, target interval, result limit, enabled
  state, and search scope;
- countries, locations, search terms, required/preferred/excluded terms;
- workplace and employment types;
- minimum, urgent, and digest score thresholds plus weights;
- legacy destinations and conditional notification routes.

Advanced JSON accepts and exports the same API-compatible configuration used by
CLI watch JSON. Preview and validate pasted/selected JSON before replacing the
draft. Exports omit IDs and other runtime-only state, target health and
initialization timestamps, leases, histories, API keys, and webhook values.

The browser draft is not durable until Apply. Navigation away from an unsaved
draft requires confirmation.

### Review and apply changes safely

Apply sends the `updatedAt` value that was loaded with the draft. It validates
the patch and shows a field-level diff before mutation.

- Name, description, schedule, interval, timezone, legacy-destination, and
  routing-only changes preserve the current watch enabled state.
- Source/target, company, query-scope, location/country, term/filter,
  workplace/employment eligibility, score-threshold, and weight changes
  atomically set `enabled=false` and return all enabled target keys as requiring
  a no-notification baseline.
- A no-op does not pause, initialize, or rewrite the watch.
- HTTP 409 means another API, CLI, MCP, or GUI caller changed the watch since the
  draft was loaded. No part of the stale patch was applied. Reload the current
  record, compare the new diff, and deliberately reapply the intended edits.

After a behavior-changing Apply, do not bypass the activation panel:

1. Confirm the watch is paused.
2. Initialize the returned target keys without notifications.
3. Inspect baseline target outcomes, normalized jobs, company/application URLs,
   coverage, and any hard failures.
4. Repair, re-baseline, or disable failed targets.
5. For the Canadian Tech Internships rollout, retain the two additional no-notification
   observation cycles required earlier in this runbook.
6. Select Resume explicitly.

Apply never resumes a behavior-changed watch. Editing routes never replays a
historical match that was already sent or suppressed.

### Configure named Discord destinations

Open Notifications / Destinations. The `default` row represents
`DISCORD_WEBHOOK_URL`. Add a custom lowercase alias such as `tier-one`; the
server maps it deterministically to `DISCORD_WEBHOOK_TIER_ONE` and writes a
GUI-managed value only to ignored `.env.local`.

For each alias:

1. Paste the HTTPS Discord webhook URL into the create/rotate form.
2. Save it. The response shows only alias, provider, configuration source, and
   configured status. A source of `environment` is rendered read-only by the
   GUI.
3. Run the non-persistent destination test against the intended watch.
4. Confirm the test arrived in the correct Discord channel.
5. Discard any clipboard history or screenshot containing the original URL.

The server accepts approved Discord webhook hosts and webhook paths only. It
writes a same-directory temporary file and atomically renames it, then API and
worker reload the change through an mtime cache without a process restart.

A process-environment destination overrides `.env.local` and is read-only. To
rotate it, update the process environment or external secret manager and restart
the owning process through normal operations. A GUI-managed alias cannot be
deleted while any watch's legacy channel or notification route references it;
remove or replace those references first.

Never inspect a destination by printing `.env.local` into logs or a shared
terminal. Destination APIs, provider results, delivery history, exports, and
errors must remain masked. If a webhook was ever exposed, rotate it in Discord
and replace the local value.

### Route tiers, notification types, and scores

Build rules under Notifications / Routing. A route has a name, enabled flag,
Discord destination alias, and optional source tier, notification type, minimum
score, and maximum score conditions.

Conditions across fields use AND semantics. Values within `sourceTiers` or
`notificationTypes` use OR semantics. Minimum and maximum score are inclusive.
An enabled rule without conditions is a catch-all. A tier restriction uses the
match's `sourceTargetKey`; it does not match if that target/tier cannot be
resolved.

For example:

| Route | Destination | Conditions | Result |
| --- | --- | --- | --- |
| Tier 1 urgent | `tier-one` | Tier 1 AND urgent | Only urgent matches produced by a Tier 1 target. |
| Tier 2 standard | `tier-two` | Tier 2 AND standard AND score 60 through 79 | Standard Tier 2 matches inside the inclusive band. |
| Daily digest | `digest` | digest | Digest messages from any tier. |

Every distinct matching destination receives a message. If two rules match the
same provider/destination, the dispatcher enqueues one outbox row. Delivery
identity remains watch + canonical episode + provider/destination; route ID and
notification type are deliberately excluded.

When the route array is non-empty, routes replace legacy broadcast selection
for that watch. They do not send in addition to `notificationChannels`. Only a
missing or empty route array retains the prior legacy behavior. If configured
routes are disabled or none match, the match is persisted as suppressed with reason
`routing`; a later rule edit does not replay it. Pending retries use the
destination saved on the delivery row, not the latest route set.

Before Resume, use the route preview where available, test every destination,
and inspect the displayed diff. A routing-only Apply does not force baseline,
but keeping a production watch paused while first establishing routes is the
safer operational rollout.

### Search, analysis, matches, and downloads

Search exposes the normal CLI search fields and renders paginated normalized
jobs. Analysis shows the existing summary, company intelligence, and source
statistics. Compare runs selected or all registered sources with bounded
concurrency. One source error appears as a sanitized failure row while
successful comparisons remain usable.

Matches exposes score and eligibility explanations plus the existing workflow
statuses: `new`, `reviewed`, `applied`, `dismissed`, `interview`, `rejected`, and
`offer`. Jobs and Notifications expose durable observations and delivery
history using the API's existing filters.

Use explicit JSON or CSV Download actions in place of CLI stdout or
`--output <path>`. The browser does not write an arbitrary server-side path.
Verbose process diagnostics remain in the API/watcher terminals and are not a
GUI feature.

### GUI troubleshooting

#### The GUI does not open

Read the launcher terminal and identify which child failed. Confirm ports 3000,
3001, and 3002 are available, PostgreSQL is reachable, migrations succeeded,
and dependencies are installed. Do not start a second `gui:dev` stack on the
same ports.

#### Overview shows API unavailable

Confirm `http://127.0.0.1:3001/health` responds and inspect the API terminal.
Because the browser uses the web proxy, do not solve this by placing an API key
or arbitrary remote origin in the URL.

#### Overview shows worker unavailable

Confirm `http://127.0.0.1:3002/health` responds and inspect the worker terminal.
Resume controls only persisted watch state; clicking Resume cannot launch a
missing worker.

#### Apply reports a conflict

Another client changed the watch. Reload it, preserve any needed draft outside
secret fields, review the new diff, and reapply. Do not use a blind PATCH to
overwrite the newer version.

#### A destination is read-only

Its resolved environment key is present in the process environment and takes
precedence. Rotate it through that environment/secret manager. The GUI must not
overwrite it in `.env.local`.

#### A destination cannot be deleted

Remove it from every legacy channel and route, then Apply those watch edits.
The API rechecks references during deletion and returns a conflict until none
remain.

#### A routed match sent nowhere

Inspect the match's notification type, total score, `sourceTargetKey`, resolved
tier, route enabled flags, inclusive score bounds, and destination configured
state. A route-configured no-match is intentionally terminal `routing`
suppression and is not replayed after the rule is changed.

#### A webhook value appears in output

Treat this as a security incident. Stop sharing the output, rotate the webhook
in Discord, replace the local/environment value, preserve only a redacted
reproduction, and report the redaction defect. Do not add the leaked value to an
issue, test fixture, screenshot, or log sample.

### GUI readiness additions

Before treating the GUI path as ready, verify all of the following in addition
to the watcher checklist above:

- [ ] One command starts the three loopback services and prints
      `http://127.0.0.1:3000`.
- [ ] Overview distinguishes API, database, worker, scheduler, Discord, coverage,
      and watch state.
- [ ] The admin API key disappears with the browser session and is absent from
      exports and persisted storage.
- [ ] A legacy watch with no routes continues using its legacy destination.
- [ ] Each named destination test reaches only its intended channel.
- [ ] Tier 1 and Tier 2 route simulations select only their intended aliases,
      and overlapping routes do not duplicate a delivery.
- [ ] A behavior-changing edit pauses, returns baseline targets, completes a
      no-notification baseline, and requires explicit Resume.
- [ ] Worker interruption is shown as unavailable without changing watch state.
- [ ] Restart recovers PostgreSQL state and pending delivery work without a
      duplicate.
- [ ] API responses, database rows, logs, errors, screenshots, JSON, and CSV
      contain no webhook value.

Do not mark this GUI checklist complete until the implementation's automated
and operational validation has actually run. Spec 6002 validation remains
separate from this documentation update.

## 16. Limitations and safety boundaries

- The system improves early discovery but cannot promise a job will be detected within exactly three minutes or that the user will be the first applicant.
- External career sites can change schemas, throttle requests, block an IP, omit publication dates, or stop responding.
- Source terms of service and rate limits remain the operator's responsibility. The watcher does not bypass authentication, CAPTCHAs, or access controls.
- LinkedIn public guest search uses no account, cookies, or authenticated browser
  session, defaults to a 72-hour recent window, and cannot exactly reproduce a
  personalized LinkedIn alert.
- Every source observation is retained. Equivalent cross-source discoveries map
  to one canonical episode. When employer URL/publication date are unavailable,
  a first-observation-anchored rolling 14-day episode may later permit a genuine
  repost; UTC calendar boundaries never split the active episode.
- Result-count collapse has no hard-coded universal threshold. Operators compare
  successful `jobsFetched` history and `lastNonEmptyAt` to a target-specific
  baseline and alert on a material sustained drop.
- Discord outages can delay notifications; retry attempts and terminal failures are persisted.
- The default daily digest is scheduled at 08:00 `America/Toronto`, including daylight-saving transitions.
- No application is submitted automatically.
