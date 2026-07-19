# Ever Jobs Watcher

The watcher is the long-running Ever Jobs worker for persistent, low-latency job monitoring. It stores watches and observations in PostgreSQL, invokes the existing source plugins directly, fingerprints and scores normalized jobs, and sends durable notifications only after database persistence succeeds.

The included seed targets software internships and co-op roles in Toronto and Canada. Its first activation is deliberately safe: a new seeded watch is disabled and uses `baseline` initialization, so existing postings are recorded without producing an alert flood.

For copy-and-paste operating procedures, use the [local runbook](../../docs/runbooks/watcher-local.md). For the supported Google Cloud shape and its constraints, use the [Google Cloud runbook](../../docs/runbooks/watcher-google-cloud.md).

## Runtime architecture

```text
PostgreSQL due-watch query and lease
  -> due source tiers
  -> existing Ever Jobs source plugins
  -> normalized JobPostDto results
  -> fingerprint and observed-job upsert
  -> explainable watch score and match persistence
  -> durable, idempotent Discord delivery
  -> run history, latency data, health, and metrics
```

The scheduler polls PostgreSQL every 15 seconds by default. A PostgreSQL lease prevents two replicas from executing the same watch concurrently; a process-local guard prevents overlap within one replica. Source requests use bounded concurrency, timeouts, retries with jitter, and partial-failure accounting. Redis is not required by this scheduler.

The worker listens on `0.0.0.0:${WATCHER_HEALTH_PORT}` and exposes only operational endpoints:

- `GET /health` returns application, database, scheduler, and Discord-configuration status.
- `GET /metrics` returns Prometheus metrics.

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

In a second terminal, get the seeded watch ID and complete the safe first-run sequence:

```bash
npm run cli -- watch list --json
npm run cli -- watch initialize <watch-id> --json
npm run cli -- watch notifications-test <watch-id> --json
npm run cli -- watch resume <watch-id> --json
```

`initialize` forces every configured source tier to run in baseline mode. Review its source failures before resuming. If an important source failed, correct the problem and initialize again while the watch is still disabled; otherwise its already-existing jobs could look new on the first successful scheduled run.

Confirm the worker and the first scheduled runs:

```bash
curl http://localhost:3002/health
curl http://localhost:3002/metrics
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
```

The complete setup, verification, pause/resume, and troubleshooting sequence is in the [local runbook](../../docs/runbooks/watcher-local.md).

## Source cadence

Source tiers prevent expensive or fragile sites from being queried every three minutes.

| Tier   | Default cadence | Intended sources                                                                            |
| ------ | --------------- | ------------------------------------------------------------------------------------------- |
| Tier 1 | 3 minutes       | Direct company career sources and structured ATS boards such as Greenhouse                  |
| Tier 2 | 15 minutes      | Structured secondary APIs and feeds such as Canada Job Bank                                 |
| Tier 3 | 60 minutes      | Expensive, rate-limited, browser-backed, or fragile HTML sources when explicitly configured |

The three-minute cadence means a Tier 1 watch becomes due every three minutes. It is not a publication-to-notification service-level guarantee: source runtime, source outages, missing publication timestamps, retries, PostgreSQL availability, and process restarts can add latency. A second run never starts while the same watch still holds its execution lease.

The seed selects explicit company and ATS targets rather than querying every registered plugin. Direct/ATS boards are fetched once per tier execution and filtered locally; search-query sources receive a bounded search-term budget.

## Default source readiness

The seed enables only the accepted unattended source set. Enabled means the watcher will schedule the adapter; it does not guarantee that a third-party site will remain available or return jobs.

| Enabled target                                                                     | Cadence    | Current path                                                                                  |
| ---------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, Coinbase, Figma, Vercel | 3 minutes  | Existing direct-company adapters                                                              |
| DoorDash                                                                           | 3 minutes  | DoorDash Canada public Greenhouse board through the company adapter                           |
| Plaid                                                                              | 3 minutes  | Generic Ashby adapter with board slug `plaid`; the stale Plaid Greenhouse wrapper is not used |
| Canada Job Bank                                                                    | 15 minutes | Structured Canada Job Bank adapter                                                            |

These desired sources are intentionally not in the default watch:

| Disabled source | Why it is unavailable by default                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Google Careers  | Its retired v3 careers API returns 404; the current official search surface requires a maintained HTML adapter |
| Meta Careers    | The existing `__NEXT_DATA__` parser is stale; Meta's current Relay operations are internal and volatile        |
| Shopify         | Its old Greenhouse slug is stale; Shopify uses Ashby but does not expose a stable public Ashby board slug      |
| Google Jobs     | The current scraper is not accepted as dependable for unattended default polling                               |
| Wellfound       | Its browser/schema dependency is too fragile for the unattended default                                        |

Do not merely add one of these sources to an enabled watch. After repairing and testing an adapter, pause the watch, add the target, run `initialize` while it remains disabled, review that target's baseline, and then resume. Initialization cannot baseline a target that is disabled or absent.

## Score and delivery bands

The default watch requires a target engineering role in the title, internship/co-op evidence, and a Canadian location. A hard exclusion or missing required condition prevents notification regardless of the numeric score.

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

The provider accepts HTTPS Discord webhook hosts and paths, disables mentions, bounds message fields, and applies a request timeout. Retryable rate-limit, server, timeout, and network failures are recorded for durable retry. The idempotency key prevents a watch/job/notification type/destination combination from being sent twice unless an explicit resend feature is added later.

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

The worker reports unhealthy when PostgreSQL is unavailable or when scheduling is enabled but failed to start. It does not report unhealthy merely because one external source is temporarily failing; those failures belong to run/source history and metrics.

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
npm run cli -- watch deliveries <watch-id> --json
```

Use `watch run` for a manual post-initialization run. Use `watch initialize` for a no-notification baseline. The example configuration is [Toronto and Canada software internships](../../examples/toronto-canada-software-internships.watch.json).

The authenticated API supplies the equivalent watch CRUD, initialization, run, pause/resume, run history, match, metric, observed-job, and notification-delivery endpoints. Run the API separately with `npm run start:dev`; it is not required when managing a local worker exclusively through the CLI.

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

The Prometheus endpoint includes counters and histograms for watch runs, source requests and duration, fetched and newly detected jobs, matches, notification outcomes, duplicate suppression, execution duration, detection latency, notification latency, scheduler poll time, and active runs. Key series use the `ever_jobs_watcher_` prefix.

Run history remains the authoritative per-execution audit record. Provider attempts remain the authoritative notification-delivery record. Prometheus process metrics reset when the worker restarts.

## Production deployment

The current production recommendation is a private Cloud Run service with instance-based billing, one minimum instance, one maximum instance, and `WATCHER_HEALTH_PORT=8080`. Request-based CPU is not suitable for this in-process background scheduler. Store `DATABASE_URL` and `DISCORD_WEBHOOK_URL` in Secret Manager, attach Cloud SQL securely, and run migrations/seed before enabling the watch.

See the [Google Cloud runbook](../../docs/runbooks/watcher-google-cloud.md) before deploying. It explains why Cloud Run Jobs are not appropriate for this long-running process, when a Cloud Run worker pool may be used, and which always-on settings create cost.

## Honest limitations

- The watcher improves discovery speed but cannot guarantee that a posting is observed within exactly three minutes or that the user is the first applicant.
- Live source plugins can change, throttle, fail, or return incomplete data; source-specific terms and rate limits still apply.
- Source-scoped fingerprints suppress repeat observations from one source; a posting returned under two different source identities can remain as two observations.
- Publication time is not fabricated. When a source omits it, latency begins at Ever Jobs' first observation instead.
- A source that fails during baseline can legitimately produce alerts on its first later success; review initialization failures before resuming.
- Discord availability and rate limits can delay delivery, although retry state is persisted.
- The default digest is 08:00 in `America/Toronto`; watch timezone and daylight-saving changes affect the corresponding UTC instant.
- This release does not submit applications, bypass access controls, automate logins, solve CAPTCHAs, or guarantee source coverage.
- The digest pass sends individual digest notifications rather than one grouped daily summary.
- A Cloud Run minimum instance and Cloud SQL incur ongoing charges even when no jobs are found.
