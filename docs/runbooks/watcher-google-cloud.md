# Google Cloud Watcher Deployment Runbook

This runbook deploys the watcher container and Spec 6000's target-aware
internship coverage to Google Cloud without changing its scheduling model. The
recommended shape is a private Cloud Run service connected to Cloud SQL for
PostgreSQL, with secrets in Secret Manager, instance-based billing, one minimum
instance, and one maximum instance.

Complete and validate the [local watcher runbook](watcher-local.md) first. The worker must baseline successfully and deliver a Discord test locally before cloud deployment is treated as ready.

The cloud deployment does not change source readiness. Registration and fixtures
alone never authorize unattended polling. The shipped preset target-enables
`google_careers`, `shopify`, `ashby:wealthsimple`, `ashby:plaid`,
`canadajobbank`, `linkedin`, and all 13 legacy direct-company targets inside a
globally disabled, uninitialized watch. Target-enabled does not poll or notify
while the watch is paused. Only Google Jobs remains target-disabled. The preset
preview is authoritative for the installed revision.

Recorded evidence is six deterministic source suites/59 tests; Google Careers
two live Canadian roles; Shopify marker-validated valid empty; Wealthsimple 37
live Ashby roles with a capped mapped sample; LinkedIn public pass; Microsoft
timeout; and Google Jobs classified blocked by the enable-JavaScript shell.

## 1. Deployment decision

The watcher is a continuously running scheduler that also exposes HTTP health and Prometheus metrics. It is not a request-triggered API and does not terminate after one batch.

| Google Cloud product  | Fit for the current application                                                               | Decision                                                               |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Cloud Run service     | Preserves `/health` and `/metrics`; supports an always-warm instance and instance-based CPU   | Recommended                                                            |
| Cloud Run worker pool | Designed for continuous background work but has no load-balanced URL and no automatic scaling | Viable only after accepting a different health/metrics operating model |
| Cloud Run Job         | Run-to-completion execution rather than a permanent scheduler                                 | Do not use for the current process                                     |

Cloud Run's default request-based billing can throttle CPU outside incoming requests. The watcher needs CPU between requests for its 15-second database scheduler poll, source execution, notification retry, and digest pass. Deploy it with instance-based billing (`--no-cpu-throttling`) and at least one minimum instance. See the official documentation for [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings) and [minimum instances](https://docs.cloud.google.com/run/docs/configuring/min-instances).

Set one maximum instance initially for simple costs and operations. Correctness does not require a singleton: PostgreSQL execution leases and notification idempotency protect multiple replicas. Additional replicas still poll, consume database connections, cost money, and create redundant lease races, so increase the maximum only for a measured reason.

Cloud Run may replace or restart a warm instance. The scheduler is restart-safe because observations, due times, leases, matches, runs, and delivery attempts are in PostgreSQL. A restart can still add detection latency.

## 2. Target architecture

```text
Secret Manager
  -> DATABASE_URL
  -> DISCORD_WEBHOOK_URL

Private Cloud Run service (min 1, max 1, instance CPU)
  -> watcher HTTP server on port 8080
  -> /health and /metrics (authenticated/private)
  -> in-process scheduler
       -> Cloud SQL for PostgreSQL
       -> public direct-company, ATS, and validated query endpoints
       -> Discord webhook

Trusted admin workstation or separately deployed Ever Jobs API
  -> migrations and seed
  -> preset dry-run/apply while paused
  -> selected target baseline initialize
  -> notification test
  -> pause/resume and inspection
```

Redis is not part of this architecture. PostgreSQL is both the system of record and the scheduler coordination store.

## 3. Required Google Cloud resources

Provision these resources in the chosen project and region:

- An Artifact Registry Docker repository.
- A Cloud SQL for PostgreSQL instance and database.
- A dedicated database user for Ever Jobs.
- A dedicated Cloud Run runtime service account.
- Secret Manager secrets for `DATABASE_URL` and `DISCORD_WEBHOOK_URL`.
- A private Cloud Run service named, for example, `ever-jobs-watcher`.
- Logging and monitoring access for operators.

Prefer the Canadian region that meets the deployment's latency, data-residency, and product-availability needs. Keep Cloud Run, Artifact Registry, and Cloud SQL in the same region where practical.

Grant the runtime service account only:

- Cloud SQL Client access to the intended instance;
- Secret Manager Secret Accessor on the two watcher secrets;
- the default permissions required to emit Cloud Run logs and metrics.

Grant Cloud Run Invoker only to operators or monitoring identities that must read the private service. Do not make the service public merely to scrape health or metrics.

Google's supported Cloud Run-to-Cloud SQL connection options and IAM requirements are documented in [Connect from Cloud Run to Cloud SQL for PostgreSQL](https://docs.cloud.google.com/sql/docs/postgres/connect-run).

## 4. Database connection and secrets

Choose one supported database connection mode:

1. Attach the Cloud SQL instance to Cloud Run and use its Unix socket at `/cloudsql/PROJECT_ID:REGION:INSTANCE_ID`.
2. Use Cloud SQL private IP with an appropriate Direct VPC egress or connector configuration.

For an attached Unix socket, a Prisma PostgreSQL URL commonly follows this shape:

```text
postgresql://DB_USER:URL_ENCODED_PASSWORD@localhost/DB_NAME?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_ID
```

Validate the exact URL against the selected Cloud SQL connection mode before deployment. URL-encode database credentials. Store the complete value as the `DATABASE_URL` Secret Manager secret; do not commit it or pass it in a visible `--set-env-vars` argument.

Store the complete Discord URL as a separate `DISCORD_WEBHOOK_URL` secret. The database watch record must continue to use `destinationRef: "default"` rather than the secret URL.

Configure secret access by environment variable at deployment time:

```text
DATABASE_URL=ever-jobs-database-url:latest
DISCORD_WEBHOOK_URL=ever-jobs-discord-webhook:latest
```

Pinning an immutable secret version provides more deterministic rollouts. Using `latest` simplifies rotation but requires a new Cloud Run revision or instance restart before all processes necessarily observe the new value.

## 5. Run migrations and seed before scheduling

The raw watcher image does not run migrations automatically. The application can create a missing safe default during bootstrap when `WATCHER_SEED_DEFAULT=true`, but production releases should apply migrations and seed explicitly before scheduling, then set bootstrap seeding off for a more auditable lifecycle.

From a trusted workstation or CI environment, connect through the [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/sql-proxy) or an approved private connection. Configure a temporary, untracked admin environment so `DATABASE_URL` points at that connection, then run:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
```

Do not paste the database password into shared logs or commit a cloud admin `.env` file. Remove the temporary local secret after the release task.

Spec 6000's migration is additive: it retains singular `location` while adding
normalized location arrays, canonical episode identity, notification identity,
and target health/baseline state. Existing watch JSON without `companyName`,
`searchScope`, or target `initializedAt` inherits watch-level settings. Do not
roll back these columns after a target rollback; disable the target instead.

The seed creates `prestige-internships-v2` disabled and uninitialized for a new
installation. Re-running seed preserves the operational state of an existing
watch and legacy seed compatibility. This invariant allows the Cloud Run
scheduler to start safely before baseline. The deployment command below sets
`WATCHER_SEED_DEFAULT=false` because this release step already created the
intended row.

For a mature CI/CD pipeline, package migration execution as an explicit, audited release step that uses the same repository revision as the image. Do not hide migrations in the worker entry point: multiple replacing revisions could then race schema mutation, and an incompatible failure would repeatedly crash the worker.

## 6. Build and publish the watcher image

Authenticate Docker to the regional Artifact Registry, then build the existing production target from the repository root. Replace all uppercase placeholders with actual values:

```bash
gcloud auth configure-docker REGION-docker.pkg.dev
docker build --target watcher-runtime -t REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/watcher:TAG .
docker push REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/watcher:TAG
```

Use an immutable tag such as a commit SHA. Record the image digest used by each release.

The `watcher-runtime` image starts `node dist/apps/watcher/main.js`. It binds to `0.0.0.0` and reads `WATCHER_HEALTH_PORT`, which must be set to Cloud Run's container port.

## 7. Deploy the private Cloud Run service

The following command is a template. Replace placeholders and verify flags against the installed Google Cloud CLI:

```bash
gcloud run deploy ever-jobs-watcher \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/watcher:TAG \
  --region REGION \
  --service-account WATCHER_SERVICE_ACCOUNT \
  --port 8080 \
  --set-env-vars WATCHER_ENABLED=true,WATCHER_SEED_DEFAULT=false,WATCHER_HEALTH_PORT=8080,WATCHER_DEFAULT_TIMEZONE=America/Toronto,WATCHER_DEFAULT_INTERVAL_MINUTES=3,WATCHER_SCHEDULER_POLL_MS=15000,WATCHER_MAX_CONCURRENT_WATCHES=2,WATCHER_MAX_CONCURRENT_SOURCES=5,WATCHER_SOURCE_TIMEOUT_MS=12000,WATCHER_SCHEDULER_LOCK_TTL_MS=180000,DIGEST_ENABLED=true,DIGEST_DEFAULT_HOUR=8,DIGEST_DEFAULT_MINUTE=0 \
  --set-secrets DATABASE_URL=ever-jobs-database-url:latest,DISCORD_WEBHOOK_URL=ever-jobs-discord-webhook:latest \
  --add-cloudsql-instances PROJECT_ID:REGION:INSTANCE_ID \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --no-allow-unauthenticated
```

Critical settings are:

- `WATCHER_HEALTH_PORT=8080` matches the deployed container port. Do not rely on shell expansion of Cloud Run's `PORT` variable.
- `WATCHER_ENABLED=true` starts scheduler polling after database health succeeds.
- `WATCHER_SEED_DEFAULT=false` reflects the explicit production seed step; set it to `true` only when intentionally relying on the safe create-if-missing bootstrap behavior.
- `--no-cpu-throttling` keeps CPU available for background work when there are no HTTP requests.
- `--min-instances 1` keeps an instance warm; this incurs cost while idle.
- `--max-instances 1` limits initial replica count and cost.
- `--no-allow-unauthenticated` protects health and metrics from public access.
- `--add-cloudsql-instances` mounts the authorized Cloud SQL connection when using the socket path.

If using private IP instead of an attached Cloud SQL socket, replace the Cloud SQL attachment with the selected VPC configuration and update `DATABASE_URL` accordingly.

Cloud Run's application health-check options are documented in [Configure container health checks](https://docs.cloud.google.com/run/docs/configuring/healthchecks). Configure startup and liveness checks against `/health` after validating their interval and failure thresholds. Avoid a threshold so aggressive that a brief database event creates a restart loop.

## 8. Verify before enabling the watch

Read the private service's `/health` endpoint using an identity with Cloud Run Invoker access. The response must show:

- healthy application and database;
- scheduler enabled and started;
- Discord configuration present;
- aggregate Tier 1 coverage state and target-health availability;
- a current timestamp.

Worker health exposes the aggregate as
`coverage.{status,tier1Degraded,degradedTargets,watches}`. The separately
deployed API uses `watcherCoverage.{status,tier1Degraded,watches}`.

Inspect startup logs for configuration-validation failures without printing secret values. Verify `ever_jobs_watcher_scheduler_last_poll_timestamp_seconds` advances on `/metrics` through an authenticated monitoring path.

The Cloud Run service itself does not expose watcher-management endpoints. Use one of these trusted administration paths:

- Run the Ever Jobs CLI from a controlled workstation/runner connected to Cloud SQL.
- Deploy the existing authenticated Ever Jobs API separately and restrict its management surface.

From the trusted CLI environment using the production database and Discord secret:

```bash
npm run cli -- watch list --json
npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id>
npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id> --apply
npm run cli -- watch initialize <watch-id> \
  --target google_careers \
  --target shopify \
  --target ashby:wealthsimple \
  --target ashby:plaid \
  --target canadajobbank \
  --target linkedin \
  --json
# Repeat the same targeted initialize command for two additional
# no-notification observation cycles while the watch remains paused.
npm run cli -- watch notifications-test <watch-id> --json
npm run cli -- watch resume <watch-id> --json
```

The first preset command is a side-effect-free diff. `--apply` requires a paused
watch and preserves destinations, thresholds, history, and unrelated operator
edits. Review its added/materially changed target keys and initialize only those
targets. Unknown, disabled, or duplicate keys are validation errors.

The production baseline must complete with zero notifications. Each required
target must have its own successful baseline. A target hard failure leaves it
uninitialized even when siblings succeed; correct and rerun that target or keep
it disabled. A valid empty target is successful but must remain visible through
its empty-run count and last non-empty time.

Before resume, inspect the initial target baselines and both additional
no-notification observation cycles:

```bash
npm run cli -- watch runs <watch-id> --json
npm run cli -- watch matches <watch-id> --json
npm run cli -- watch deliveries <watch-id> --json
npm run cli -- watch metrics <watch-id> --json
```

Inspect normalized location arrays, external employer application URLs,
geography explanations, and target outcomes. No notification is expected if no
newly detected canonical episode meets the immediate threshold. Run history
proves activity only when expected targets show success/valid-empty/partial
rather than hard failure. Verify both observation cycles, including Tier 1,
completed without notifications and aggregate coverage is not degraded. Only
then test Discord and resume.

## 9. Monitoring and alerts

Monitor all of these signals:

- Cloud Run instance availability and restart count;
- authenticated `/health` status;
- Cloud SQL connection count, CPU, storage, and availability;
- scheduler last-poll timestamp freshness;
- scheduled run count and terminal failures;
- target outcomes, request counts, duration, and hard-failure streak by target;
- aggregate Tier 1 coverage degradation;
- target last-success and last-non-empty timestamps;
- new jobs and duplicate suppression;
- Discord delivery failures and retry exhaustion;
- detection and notification latency histograms.

The worker's `/metrics` endpoint emits Prometheus text. Use an authenticated collector compatible with private Cloud Run or bridge the series into Cloud Monitoring. Do not expose the service publicly only for scraping.

Coverage-specific series are:

- `ever_jobs_watcher_target_runs_total{watch,target,tier,outcome}`
- `ever_jobs_watcher_target_consecutive_hard_failures{watch,target,tier}`
- `ever_jobs_watcher_target_degraded{watch,target,tier}`
- `ever_jobs_watcher_target_last_success_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_target_last_non_empty_timestamp_seconds{watch,target,tier}`
- `ever_jobs_watcher_tier1_coverage_degraded{watch}`

Run and delivery records in PostgreSQL remain the durable operational audit trail. In-process metric counters restart with a new instance.

Suggested alerts include:

- `/health` unavailable or unhealthy for a sustained interval;
- scheduler poll timestamp older than two expected poll periods;
- no successful Tier 1 run for more than two configured Tier 1 intervals plus normal run duration;
- `ever_jobs_watcher_tier1_coverage_degraded{watch} == 1` for a sustained
  collection interval;
- a Tier 1 target reaching three consecutive hard failures or remaining without
  success for more than two expected target intervals plus normal duration;
- a material sustained collapse in successful `jobsFetched` relative to that
  target's historical baseline or an unexpectedly stale last-non-empty timestamp;
- database connection saturation;
- notification terminal failures greater than zero;
- a source's success rate falling materially below its baseline;
- p95 detection or notification latency exceeding the operator's target.

Any non-hard outcome (`success`, valid `empty`, or `partial`) resets the target's
hard-failure streak. A fully successful zero-job target increments
`emptyRunCount`; a partial target increments `partialRunCount`; neither is a hard
failure. There is intentionally no universal hard-coded result-collapse
percentage: set a target-specific Cloud Monitoring policy from historical
`jobsFetched` and `lastNonEmptyAt`. Do not treat one target failure as total
worker failure; successful siblings remain useful. Do treat aggregate Tier 1
degradation as a coverage incident.

## 10. Releases, rollback, and replica overlap

For each release:

1. Run tests and build the immutable image.
2. Apply compatible migrations once.
3. Deploy a new Cloud Run revision with the same secret references.
4. Verify startup, database, scheduler, and Discord configuration health.
5. Preview the v2 preset, apply it only while paused, and baseline only
   added/materially changed targets.
6. Run and inspect two additional no-notification observation cycles, including
   Tier 1, before resuming and enabling notifications.
7. Keep the previous image digest for application rollback.

Cloud Run revision replacement can briefly overlap old and new instances even with a maximum of one steady-state instance. PostgreSQL leases prevent both revisions from executing the same watch concurrently. Notification identity is watch + canonical episode + channel/destination and excludes notification type, so a score-band change or overlapping revision cannot recreate a completed delivery.

For a source regression, pause the watch and disable the individual target. Do
not delete observations, canonical episodes, target health, or additive columns.
Reapply the previous target set only after reviewing the preset diff, then resume
the unaffected targets. Application-image rollback remains available, but schema
and public-contract additions are backward-compatible and stay deployed.

An application rollback does not automatically reverse a database migration. Migrations must be backward-compatible across the deployment window. For a destructive schema rollback, restore from a tested backup or apply a separate forward repair migration according to the database recovery plan.

During incident response, pause the watch through the CLI/API before changing source configuration or notification secrets. Setting `WATCHER_ENABLED=false` and deploying a revision stops all scheduled watches on that service but is broader than pausing one watch.

## 11. Discord secret rotation

If the Discord webhook is compromised:

1. Delete or rotate it in Discord immediately.
2. Add a new Secret Manager version without printing the URL.
3. Deploy a new Cloud Run revision referencing the intended version, or restart instances when using `latest`.
4. Run `watch notifications-test <watch-id>` from the trusted admin environment.
5. Confirm failed old-provider attempts are understood before allowing normal retry processing.

Never store the webhook URL in a watch destination, Cloud Run plain-text environment variable, image layer, build argument, Terraform output, or source-control file.

## 12. Cloud Run worker pool alternative

[Cloud Run worker pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools) are designed for non-HTTP continuous background workloads. They do not receive a load-balanced URL and do not automatically scale; the operator manually maintains the desired instance count.

A worker pool is reasonable only when:

- the team prefers a worker-native resource;
- at least one instance is explicitly maintained;
- health and metrics move to logs/Cloud Monitoring or another supported path;
- losing direct `/health` and `/metrics` access is acceptable;
- the product's regional availability and lifecycle status are acceptable.

The present watcher still starts an HTTP server, so a worker pool would run that listener without exposing it. The private Cloud Run service remains the smallest production architecture that preserves the current operational contract.

## 13. Security and cost constraints

- A minimum Cloud Run instance with instance-based CPU incurs cost even while no job is found.
- Cloud SQL incurs continuous instance, storage, backup, and network costs according to its configuration.
- Keep Cloud Run private and use least-privilege service accounts.
- Store secrets in Secret Manager; never log database credentials, Discord URLs, API keys, cookies, or authorization headers.
- Keep Cloud SQL off the public internet when practical; use supported socket/private networking paths.
- Bound Cloud SQL connection pools and source concurrency before increasing replica counts.
- Review each external source's terms and rate limits. Do not bypass authentication, anti-bot controls, CAPTCHAs, or access controls.
- LinkedIn uses only its unauthenticated public guest surface with a bounded
  newest-first 72-hour window. Do not add automated login, personal cookies,
  browser-session reuse, CAPTCHA/challenge bypass, or application submission.

## 14. Honest limitations

- Tier 1's three-minute interval is a scheduling target, not a guarantee. The 15-second scheduler poll, jitter, a previous long run, source latency, retries, Cloud Run restarts, database events, and Discord outages can add time.
- Cloud Run does not guarantee a particular minimum instance will live forever; durable state makes restarts safe but cannot eliminate the pause.
- Source publication times may be delayed or missing. The watcher records first observation rather than fabricating a publication timestamp.
- Live source schemas, availability, IP policies, and rate limits are outside Ever Jobs' control.
- Registration or fixture coverage alone never permits unattended polling.
  Target-enabled sources remain inert in the paused watch until their targeted
  baselines and two no-notification observation cycles pass.
- Target baseline cannot cover a hard-failed source. Successful siblings retain
  their baseline, but the failed target must remain disabled or be reinitialized
  successfully before resume.
- LinkedIn guest coverage is best effort and cannot exactly reproduce a
  personalized account alert.
- Canonical episodes suppress cross-source duplicate delivery while retaining
  all source observations; source data can still be incomplete or disagree. A
  URL/date-less fallback is anchored at first observation and reused for a
  rolling 14 days; UTC calendar boundaries do not split it.
- Discord retry state is durable, but a prolonged provider outage delays notification.
- The system cannot guarantee that the user is the first applicant.
- The system does not submit applications.
