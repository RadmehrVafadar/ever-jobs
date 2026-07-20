# Local Watcher Operations Runbook

This runbook takes a clean Ever Jobs checkout to a continuously running local
watcher for software internships and co-ops. It covers the dry-run-first v2
preset, per-target baseline, 3/15/60 cadence, Canada/US geography, Discord,
Docker, target-health alerts, rollback, and failure recovery.

The detailed component reference is in the
[watcher application guide](../../apps/watcher/README.md). The base functional
contract is [Spec 016](../../.specify/specs/016-realtime-job-watcher/spec.md);
[Spec 6000](../../.specify/specs/6000-prestige-internship-coverage-expansion/spec.md)
defines the target-aware coverage expansion and takes precedence only for its
listed amendments.

## 1. Operating model

The watcher is a long-running NestJS HTTP process with an in-process scheduler. PostgreSQL provides persistence, due-watch discovery, and distributed execution leases. The worker invokes the existing Ever Jobs source plugins; it does not call the Ever Jobs REST API to search.

There are three independently due source tiers:

| Tier | Default interval | Eligibility geography | Purpose |
| ---- | ---------------- | --------------------- | ------- |
| Tier 1 | 3 minutes | Canada only | Fixture-backed direct company and complete ATS targets |
| Tier 2 | 15 minutes | Canada and United States | Canada Job Bank and validated Google Jobs redundancy |
| Tier 3 | 60 minutes | Canada and United States | Validated unauthenticated LinkedIn public guest redundancy |

The scheduler polls PostgreSQL every 15 seconds by default. Therefore, the normal start delay after a tier becomes due is up to one scheduler poll, subject to another run holding the lease, database availability, process load, and jitter. The interval is a target cadence rather than an end-to-end notification guarantee.

### Default source readiness

`prestige-internships-v2` carries the intended target inventory, but its preview
and source-audit record are authoritative for enablement. A plugin being
registered is not an unattended-readiness claim.

| Target | Tier | Intended path | Shipped preset state and remaining gate |
| ------ | ---- | ------------- | --------------------------------------- |
| Google Careers | 1 | Official Careers results/details, Canada query scope | **target-enabled inside the disabled/uninitialized watch**; deterministic validation passed and live smoke returned two Canadian roles; baseline and two observation cycles remain |
| Shopify | 1 | Official server-rendered careers pages | **target-enabled inside the disabled/uninitialized watch**; deterministic validation passed and live board was marker-validated empty; baseline and two observation cycles remain |
| Wealthsimple | 1 | `ashby:wealthsimple`, branded through the maintained Ashby plugin | **enabled target** inside the disabled preset watch; baseline before resume |
| Plaid | 1 | `ashby:plaid` through the maintained Ashby plugin | **enabled target** inside the disabled preset watch; baseline before resume |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel, Meta, Wellfound | 1 | legacy direct-company inventory with Canada post-filter scope | **target-disabled**; each requires fixture-backed Canada-wide evidence and its own live/baseline gate; Microsoft live smoke timed out |
| Canada Job Bank | 2 | Structured Canadian query source | **enabled target** inside the disabled preset watch; 12 of 76 matrix requests per run |
| Google Jobs | 2 | Canada/US query redundancy | **disabled**; fixtures/failure handling pass, but live smoke returned an enable-JavaScript shell |
| LinkedIn public guest | 3 | Canada/US newest-first 72-hour query | **target-enabled inside the disabled/uninitialized watch**; listing/detail fixtures and unauthenticated live smoke pass; baseline and operator review remain |

The exact target-enabled set is `google_careers`, `shopify`,
`ashby:wealthsimple`, `ashby:plaid`, `canadajobbank`, and `linkedin`. Target-
enabled does not start polling or notifications while the watch is paused.
Google Jobs and every legacy direct-company target remain target-disabled.

Recorded source evidence is six deterministic suites/59 tests; Google Careers
two live Canadian roles; Shopify valid empty; Wealthsimple 37 live Ashby roles
with a capped mapped sample; LinkedIn public listing/detail pass; Microsoft
timeout; and Google Jobs classified blocked by the enable-JavaScript shell.

The preset has 19 search terms. Google Careers and Canada Job Bank each have 76
term/location entries across four Canadian locations. Google Jobs and LinkedIn
each have 95 entries across five Canada/US locations. The rotating per-run caps
are 12, 12, 12, and 8 respectively.

Do not enable a target to make the matrix look complete. Perform the source live
smoke before target enablement, then keep the global watch paused. Inspect all
normalized locations and employer application URLs, apply the preset, targeted-
baseline added/materially changed targets, and run two additional
no-notification observation cycles before resume.

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

On a database with no watches, the seed creates `Prestige Software Internships —
Canada and USA` from `prestige-internships-v2`. It is globally disabled,
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
npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id>
```

Confirm the watch is paused and inspect targets classified as unchanged, added,
materially changed, disabled, or operator-only. Applying requires an explicit
flag:

```bash
npm run cli -- watch preset apply prestige-internships-v2 \
  --watch <watch-id> \
  --apply
```

Preset merge preserves notification destinations, score thresholds, history,
and unrelated operator edits. It rejects an enabled watch. Material target
changes include site, company slug/name, tier, interval, or search scope.

Run initialization only for target keys reported as added or materially changed:

```bash
npm run cli -- watch initialize <watch-id> \
  --target google_careers \
  --target shopify \
  --target ashby:wealthsimple \
  --target ashby:plaid \
  --target canadajobbank \
  --target linkedin \
  --json
```

`--target` is repeatable. Omit it to force every enabled target now rather than
waiting for its 3/15/60-minute cadence. Unknown, disabled, or duplicate keys are
validated errors. Depending on target count, query-matrix budgets, and timeouts,
initialize-all can take longer than a normal Tier 1 run.

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
```

If a required target hard-failed, leave it disabled or correct the source and run
targeted initialization again while the watch remains paused. Successful sibling
targets keep their baseline. A hard-failed target never receives
`initializedAt`, and a blocked/malformed response must not be accepted as an
empty success.

Baseline mode prevents an initial flood; it cannot infer jobs from a target that
never completed. A valid parsed empty board may initialize successfully, but its
empty-run count and last non-empty time remain visible for collapse monitoring.

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

## 8. Enable the reviewed 3/15/60 pipeline

After a satisfactory baseline and Discord test, resume the watch:

```bash
npm run cli -- watch resume <watch-id> --json
```

Resume sets `enabled=true` and makes the watch schedulable. The next scheduler
poll picks up a due watch; subsequent Tier 1 executions follow the three-minute
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
npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id>
npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id> --apply
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

Use the repository's API-key authentication convention for watcher management endpoints. The API provides watch CRUD, default creation, manual run, initialization, pause/resume, run history, matches, metrics, observed-job queries, delivery history, and notification tests.

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
smoke, and baseline that target before enabling it again. Meta and Wellfound
direct remain disabled. Wealthsimple and Plaid use Ashby slugs `wealthsimple`
and `plaid`; no private or guessed board endpoint is allowed.

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

### The three-minute target is missed

Check scheduler poll freshness, previous run duration, source timeouts/retries, lease state, PostgreSQL health, and process uptime. The scheduler does not overlap a slow run of the same watch. A source publication timestamp can also be delayed or absent; Ever Jobs does not fabricate it.

## 14. Readiness checklist

- [ ] `.env` exists locally and is not committed.
- [ ] PostgreSQL is healthy.
- [ ] Prisma client generation and migrations completed.
- [ ] The seed printed the newly created or already-existing intended watch.
- [ ] `/health` reports healthy database and started scheduler.
- [ ] Discord configuration is reported as present.
- [ ] `watch preset apply prestige-internships-v2 --watch <id>` was reviewed as a dry run before `--apply`.
- [ ] The preset was applied only while the watch was paused.
- [ ] Every added/materially changed enabled target has its own successful `initializedAt` and baseline sent zero notifications.
- [ ] Hard-failed targets were repaired and re-baselined or explicitly left disabled.
- [ ] Every enabled Tier 1 target has fixture-backed Canada-wide query/post-filter evidence.
- [ ] New/repaired targets completed an operator-authorized live smoke while disabled; normalized locations and employer application URLs were inspected.
- [ ] The Discord configuration test reached the correct channel.
- [ ] The watch was resumed only after baseline and provider testing.
- [ ] Two additional no-notification observation runs appear in history for the
      target-enabled set, including both Tier 1 cycles.
- [ ] `ever_jobs_watcher_tier1_coverage_degraded{watch}` is zero and no enabled Tier 1 target is degraded.
- [ ] Delivery and match queries work.
- [ ] The webhook URL exists only in local environment/secret storage.

## 15. Limitations and safety boundaries

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
