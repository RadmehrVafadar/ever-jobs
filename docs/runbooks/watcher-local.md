# Local Watcher Operations Runbook

This runbook takes a clean Ever Jobs checkout to a continuously running local watcher that checks direct company and ATS sources every three minutes and sends strong-match notifications to Discord. It also documents the safe baseline procedure, normal operations, Docker execution, and failure recovery.

The detailed component reference is in the [watcher application guide](../../apps/watcher/README.md). The functional contract is in [Spec 016](../../.specify/specs/016-realtime-job-watcher/spec.md).

## 1. Operating model

The watcher is a long-running NestJS HTTP process with an in-process scheduler. PostgreSQL provides persistence, due-watch discovery, and distributed execution leases. The worker invokes the existing Ever Jobs source plugins; it does not call the Ever Jobs REST API to search.

There are three independently due source tiers:

| Tier   | Default interval | Purpose                                                                           |
| ------ | ---------------- | --------------------------------------------------------------------------------- |
| Tier 1 | 3 minutes        | Direct company career sources and structured ATS boards                           |
| Tier 2 | 15 minutes       | Structured secondary APIs and feeds                                               |
| Tier 3 | 60 minutes       | Explicitly configured expensive, rate-limited, browser-backed, or fragile sources |

The scheduler polls PostgreSQL every 15 seconds by default. Therefore, the normal start delay after a tier becomes due is up to one scheduler poll, subject to another run holding the lease, database availability, process load, and jitter. The interval is a target cadence rather than an end-to-end notification guarantee.

### Default source readiness

The default watch intentionally schedules only the accepted unattended set:

| Enabled target                                                                     | Tier | Notes                                                                    |
| ---------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, Coinbase, Figma, Vercel | 1    | Existing direct-company adapters                                         |
| DoorDash                                                                           | 1    | DoorDash Canada public Greenhouse board through the company adapter      |
| Plaid                                                                              | 1    | Generic Ashby board slug `plaid`, not the stale Plaid Greenhouse wrapper |
| Canada Job Bank                                                                    | 2    | Structured Canadian source                                               |

Google Careers, Meta Careers, Shopify, Google Jobs, and Wellfound are desired but disabled/absent. Their current repository paths are stale or too fragile for the unattended default: Google Careers' retired v3 endpoint returns 404; Meta no longer exposes the expected `__NEXT_DATA__`; Shopify's old Greenhouse slug is stale and its current Ashby board slug is not public; Google Jobs and Wellfound require adapter repair and fixture-backed validation.

If one is repaired later, keep the watch paused, add and enable the new target, run `initialize`, inspect that target's baseline, and only then resume. A target that is absent or disabled cannot be baselined.

Every scheduled run follows this order:

1. Acquire the watch's PostgreSQL execution lease.
2. Determine which source tiers are due.
3. Query configured sources with bounded concurrency, timeout, retry, and jitter.
4. Normalize and fingerprint jobs, then persist observations.
5. Persist explainable watch matches.
6. Create and send eligible idempotent notification deliveries.
7. Persist run totals, source failures, duration, and latency.
8. Release the lease and schedule the next tier due time.

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

The seed creates `Toronto and Canada Software Internships` only when it is missing. A newly created seed is disabled, has no `nextRunAt`, uses `baseline` initialization, and points its Discord channel at the environment reference `default`. Re-running the seed returns the existing watch without overwriting its configuration, initialization state, or run timestamps.

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

Do not resume a fresh watch before baseline initialization. The baseline records all jobs currently returned by all configured tiers without notifying them.

Identify the watch and inspect it:

```bash
npm run cli -- watch list --json
npm run cli -- watch show <watch-id> --json
```

Run initialization:

```bash
npm run cli -- watch initialize <watch-id> --json
```

Initialization is a forced manual execution: it queries every configured source tier now rather than waiting for the 3/15/60-minute cadence. Depending on source count and timeouts, this can take longer than a normal Tier 1 run.

Review the returned and persisted run summary, especially:

- `sourcesRequested`, `sourcesSucceeded`, and `sourcesFailed`;
- `jobsFetched`, `jobsNormalized`, and `newJobsDetected`;
- run status and error summary;
- that `notificationsSent` is zero.

Inspect run history when needed:

```bash
npm run cli -- watch runs <watch-id> --json
```

If an important source failed, fix its configuration or transient failure and run `initialize` again while the watch remains disabled. A source absent from baseline has no prior observations; jobs returned on its first later success can correctly look new and may notify.

Baseline mode prevents an initial flood; it cannot infer jobs from sources that never completed.

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

## 8. Enable the three-minute pipeline

After a satisfactory baseline and Discord test, resume the watch:

```bash
npm run cli -- watch resume <watch-id> --json
```

Resume sets `enabled=true` and makes the watch schedulable. The next scheduler poll picks up a due watch; subsequent Tier 1 executions follow the watch's three-minute interval. Tier 2 and Tier 3 run only when their independent due times arrive.

Allow at least two Tier 1 intervals, then inspect operations:

```bash
npm run cli -- watch show <watch-id> --json
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch matches <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
npm run cli -- watch metrics <watch-id> --json
```

No Discord message is expected when no newly observed job exceeds the immediate threshold. That is a successful quiet run, not a scheduler failure. Run history and `lastRunAt` are the evidence that polling occurred.

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

Alert operationally when the health endpoint is unavailable, the database or scheduler becomes unhealthy, the scheduler's last-poll timestamp goes stale, scheduled runs stop appearing, or notification failures accumulate. A single source failure should be investigated through run history without treating the whole worker as down.

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
npm run cli -- watch initialize <watch-id> --json
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

Inspect its run error summary and request duration. Do not shorten intervals or bypass access controls to compensate. Prefer a public direct company or ATS source, respect its rate limits and terms, and remove or move a fragile source to Tier 3 when appropriate.

Do not enable Google Careers, Meta Careers, Shopify, Google Jobs, or Wellfound simply to eliminate a missing-company warning. They are intentionally absent from the current default until their documented adapter gaps are repaired. Plaid must use Ashby slug `plaid`; DoorDash uses the maintained DoorDash Canada board path.

### A duplicate Discord message appears

Check whether it is actually a different external job ID, a distinct destination, or a different notification type such as a digest. Normal immediate delivery uses a unique database idempotency key derived from watch, observed job, notification type, and destination. Preserve the database when restarting; a fresh database has no prior idempotency records.

### Initialization reported source failures

Keep the watch disabled, resolve the failures, and initialize again. Enabling despite a partial baseline accepts the possibility that old postings from the missing source will be classified as newly observed later.

### The three-minute target is missed

Check scheduler poll freshness, previous run duration, source timeouts/retries, lease state, PostgreSQL health, and process uptime. The scheduler does not overlap a slow run of the same watch. A source publication timestamp can also be delayed or absent; Ever Jobs does not fabricate it.

## 14. Readiness checklist

- [ ] `.env` exists locally and is not committed.
- [ ] PostgreSQL is healthy.
- [ ] Prisma client generation and migrations completed.
- [ ] The seed printed the newly created or already-existing intended watch.
- [ ] `/health` reports healthy database and started scheduler.
- [ ] Discord configuration is reported as present.
- [ ] `initialize` completed with zero notifications.
- [ ] Important source failures from baseline were resolved or explicitly accepted.
- [ ] The watch contains only the accepted default sources, or every added source has its own successful disabled baseline.
- [ ] The Discord configuration test reached the correct channel.
- [ ] The watch was resumed only after baseline and provider testing.
- [ ] At least two Tier 1 scheduled runs appear in history.
- [ ] Delivery and match queries work.
- [ ] The webhook URL exists only in local environment/secret storage.

## 15. Limitations and safety boundaries

- The system improves early discovery but cannot promise a job will be detected within exactly three minutes or that the user will be the first applicant.
- External career sites can change schemas, throttle requests, block an IP, omit publication dates, or stop responding.
- Source terms of service and rate limits remain the operator's responsibility. The watcher does not bypass authentication, CAPTCHAs, or access controls.
- Description edits update the existing observation and do not become new-job alerts; genuinely new external IDs may represent reposts and are kept distinct.
- Discord outages can delay notifications; retry attempts and terminal failures are persisted.
- The default daily digest is scheduled at 08:00 `America/Toronto`, including daylight-saving transitions.
- No application is submitted automatically.
