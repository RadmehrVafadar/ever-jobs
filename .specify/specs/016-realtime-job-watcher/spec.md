# Spec: 016 — Real-time Job Watcher

| Field         | Value                  |
| ------------- | ---------------------- |
| Spec ID       | 016                    |
| Slug          | `realtime-job-watcher` |
| Status        | in-progress            |
| Owner         | Ever Jobs maintainers  |
| Created       | 2026-07-14             |
| Last updated  | 2026-07-14             |
| Supersedes    | none                   |
| Related specs | none                   |

## 1. Problem statement

Ever Jobs can query many sources on demand, but an internship seeker needs durable state and continuous execution. Without a persistent watcher, the user must repeatedly run searches, cannot distinguish a genuinely new posting from an existing result, has no durable notification history, and can easily receive an alert flood when monitoring starts.

The production feature must reuse the existing NestJS source plugins and normalized `JobPostDto` contract. It must not become a second scraper. It must run safely on a laptop today and retain a deployment shape that can later run as an always-on Google Cloud worker.

The initial operating profile is a third-year Computer Science student in Canada seeking software engineering internships and co-op roles in Toronto, Ontario, elsewhere in Canada, or remote within Canada. The desired fast path is a three-minute cadence for supported direct-company and ATS sources, followed by Discord notification after persistence.

## 2. Goals

- Persist watches, observations, matches, runs, leases, and notification deliveries in PostgreSQL.
- Poll enabled direct-company and ATS targets every three minutes by default, structured secondary targets every 15 minutes, and fragile targets every 60 minutes.
- Prevent overlapping execution in one process and across multiple replicas.
- Reuse `JobsService`, the plugin registry, and normalized `JobPostDto` results directly.
- Detect new source records deterministically and treat description edits as updates rather than new jobs.
- Produce an explainable score with required-condition and exclusion evidence.
- Persist a notification outbox record before any provider I/O and prevent duplicate delivery.
- Send immediate strong-match notifications to Discord and process medium-score matches during the daily digest pass.
- Make first activation safe by seeding a disabled watch and requiring baseline initialization before resume.
- Expose authenticated REST management, CLI management, health, Prometheus metrics, and durable history.
- Recover cleanly after worker, database, source, or notification-provider failures.

## 3. Non-goals

- Automatic application submission or application-form completion.
- LinkedIn authentication, cookie/session reuse, CAPTCHA bypass, stealth automation, or access-control bypass.
- Replacing or rewriting the existing Ever Jobs source integrations.
- Guaranteeing detection in exactly three minutes or guaranteeing the user is the first applicant.
- Fabricating a publication timestamp when the source does not provide one.
- A frontend dashboard.
- Live third-party calls in automated tests.
- A grouped, single-message digest report; the current digest pass emits one idempotent digest notification per eligible match, up to its daily cap.
- Canonically merging observations from different source identifiers into one persisted job. Source-scoped duplicates are suppressed; cross-source grouping is a future enhancement.

## 4. User and operator stories

> As an internship seeker, I want newly published Canadian software internships checked frequently so that I can apply soon after discovery.

> As an internship seeker, I want only strong new matches sent immediately and medium matches deferred so that alerts stay useful.

> As an operator, I want a no-notification baseline before scheduling starts so that initial setup cannot flood Discord.

> As an operator, I want each source failure recorded independently so that one broken adapter does not erase useful results from working adapters.

> As an operator, I want database leases and notification idempotency so that restarts and multiple replicas remain safe.

> As an operator, I want CLI and authenticated REST controls so that I can initialize, inspect, pause, resume, and troubleshoot a watch without editing database rows.

> As a future cloud operator, I want the same container and PostgreSQL coordination model to work in an always-on Cloud Run service without introducing Redis.

## 5. Functional requirements

| ID    | Requirement                                                                                                                                                                                                                         | Priority |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-1  | Store `JobWatch`, `ObservedJob`, `WatchMatch`, `NotificationDelivery`, and `WatchRun` records in PostgreSQL through the replaceable `WatchRepository` contract.                                                                     | must     |
| FR-2  | Create the default `Toronto and Canada Software Internships` watch disabled, uninitialized, with `initializationMode=baseline`, `nextRunAt=null`, and Discord destination reference `default`.                                      | must     |
| FR-3  | Do not overwrite an existing default watch's enablement, initialization, source cadence, or run timestamps during seed/bootstrap.                                                                                                   | must     |
| FR-4  | Represent each enabled source as an explicit target with site, tier, interval, optional ATS company slug, and independent last/next-run timestamps.                                                                                 | must     |
| FR-5  | Use default target intervals of 3 minutes for Tier 1, 15 minutes for Tier 2, and 60 minutes for Tier 3.                                                                                                                             | must     |
| FR-6  | Poll PostgreSQL for due watches every 15 seconds by default and bound active watches per process.                                                                                                                                   | must     |
| FR-7  | Acquire a transactional PostgreSQL lease before creating a run, renew it during execution, and release it on completion. A second replica or trigger must not execute the same watch concurrently.                                  | must     |
| FR-8  | Invoke existing source plugins through `JobsService`; the watcher must not call the Ever Jobs REST search endpoint.                                                                                                                 | must     |
| FR-9  | Fetch board/direct sources once per due target and send a deterministic, bounded subset of search terms to query-style sources.                                                                                                     | must     |
| FR-10 | Bound source concurrency, enforce per-source timeout, retry retryable failures with exponential backoff and jitter, and collect settled results.                                                                                    | must     |
| FR-11 | Preserve successful source results when another source rejects and record the run as `partial`; record a total source failure as `failed`.                                                                                          | must     |
| FR-12 | Create a `WatchRun` for every acquired execution and persist requested/succeeded/failed sources, job counts, match counts, notification counts, duration, and a sanitized error summary.                                            | must     |
| FR-13 | Generate SHA-256 observation fingerprints from normalized source plus stable external ID when present; otherwise use source plus normalized company, title, location, and canonical application/job URL.                            | must     |
| FR-14 | Canonicalize URL host/protocol casing, default ports, duplicate slashes, fragments, trailing slashes, query ordering, and known tracking parameters before fallback fingerprinting.                                                 | must     |
| FR-15 | Store a separate normalized description hash. Updating a description, title, location, URL, or last-seen time for the same fingerprint must not create a new observation or duplicate match.                                        | must     |
| FR-16 | Enforce unique observation fingerprint and unique watch/observed-job match constraints.                                                                                                                                             | must     |
| FR-17 | Score role, internship, Canadian location, company priority, source quality, and technical skills with configurable non-negative weights and a capped skills bucket.                                                                | must     |
| FR-18 | Require a target engineering role in the title, an internship/co-op indicator, and Canadian location when the watch requires Canada before notifying.                                                                               | must     |
| FR-19 | Apply contextual hard exclusions for seniority in the title, explicit experience requirements, and explicit non-Canadian restrictions.                                                                                              | must     |
| FR-20 | Persist total score, component breakdown, matched keywords, missing required conditions, reasons, and exclusion reason for every match.                                                                                             | must     |
| FR-21 | Treat scores at or above `urgentScore` as urgent, scores from `minimumScore` to below urgent as standard immediate, scores from `digestScore` to below minimum as digest-eligible, and lower/excluded/incomplete matches as silent. | must     |
| FR-22 | In `baseline` mode, persist current observations and matches without sending notifications. Mark the watch initialized only if source execution is not a total failure.                                                             | must     |
| FR-23 | In `recent-only` mode, notify only new watch/job matches; when a valid publication time exists, enforce the configurable recent window. A missing publication time must remain missing and uses first observation for latency.      | must     |
| FR-24 | Support explicit `notify-all` only as a programmatic/testing mode; ordinary REST and CLI manual runs must select baseline for an uninitialized watch and recent-only for an initialized watch.                                      | must     |
| FR-25 | Persist an outbox delivery before Discord I/O. Derive its unique idempotency key from watch, observed job, notification type, provider channel, and destination reference.                                                          | must     |
| FR-26 | Claim pending delivery attempts transactionally, retry eligible failures with bounded exponential backoff, honor provider retry-after data, and persist sent, suppressed, or terminal failure state.                                | must     |
| FR-27 | Resolve the Discord webhook only from environment-backed destination reference `default`; never store or return the complete secret URL.                                                                                            | must     |
| FR-28 | Escape and bound Discord content, disable mentions, include score/job/source/latency/reasons/application links, and validate the outbound Discord host and path.                                                                    | must     |
| FR-29 | At the configured local digest time, select up to 25 pending, non-excluded matches with `digestScore <= score < minimumScore`, ordered by score and match time, and dispatch digest-typed idempotent notifications.                 | must     |
| FR-30 | Exclude already-sent immediate matches and baseline-suppressed matches from digest delivery.                                                                                                                                        | must     |
| FR-31 | Expose authenticated REST watch CRUD, default creation, run/initialize/pause/resume, run history, match history/status, persisted metrics, observed-job queries, delivery history, and Discord test endpoints.                      | must     |
| FR-32 | Expose equivalent CLI create/update/list/show/delete/run/initialize/pause/resume/history/status/metrics/provider-test operations with JSON output and pagination/filter options.                                                    | must     |
| FR-33 | Expose unauthenticated worker-local `/health` and `/metrics` endpoints; deployment controls must keep them private when exposed outside localhost.                                                                                  | must     |
| FR-34 | Report application, database, scheduler, and Discord configuration through health without exposing secrets.                                                                                                                         | must     |
| FR-35 | Emit structured Prometheus metrics for runs, source requests/duration, jobs, matches, notifications, duplicates, run duration, detection latency, notification latency, scheduler freshness, and active executions.                 | must     |
| FR-36 | Use UTC for stored timestamps and `Intl.DateTimeFormat` with each watch timezone for digest scheduling, including daylight-saving transitions.                                                                                      | must     |

## 6. Default watch and source readiness

The production seed enables only targets with an intended public, unauthenticated operating path. "Enabled" means configured for polling; third-party uptime and schema stability are not guaranteed.

| Default target                                                                     | Tier / cadence      | Production path                                                                                   |
| ---------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, Coinbase, Figma, Vercel | Tier 1 / 3 minutes  | Existing direct-company adapters                                                                  |
| DoorDash                                                                           | Tier 1 / 3 minutes  | DoorDash Canada public Greenhouse board through the maintained company adapter                    |
| Plaid                                                                              | Tier 1 / 3 minutes  | Ashby public posting API with board slug `plaid`; the legacy Plaid Greenhouse wrapper is not used |
| Canada Job Bank                                                                    | Tier 2 / 15 minutes | Existing structured public-source adapter                                                         |

These desired targets remain intentionally absent from the seed until their adapters have a stable public path and deterministic fixtures:

| Desired target | Current status                                                                                           | Required remediation before enablement                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Google Careers | Retired `careers.google.com/api/v3/search/` returns 404                                                  | Implement and maintain an official Google Careers HTML adapter; do not fabricate publication dates                        |
| Meta Careers   | The adapter expects removed Next.js `__NEXT_DATA__`; the current Relay endpoint is internal and volatile | Keep disabled, or implement a rate-limited Tier 3 public-page browser adapter without login or hard-coded Relay artifacts |
| Shopify        | Legacy Greenhouse slug is stale; Shopify uses Ashby but exposes no stable public Ashby board slug        | Implement the official server-rendered Shopify Careers surface and fixture tests                                          |
| Google Jobs    | Current scraper is not accepted as dependable for the default unattended pipeline                        | Repair and validate before enabling as Tier 2 or Tier 3                                                                   |
| Wellfound      | Browser/schema dependency is too fragile for the default unattended pipeline                             | Repair and validate, then enable only at an appropriate slower tier                                                       |

Initialization cannot baseline a disabled target. Enabling one later requires pausing the watch, adding the target, running `initialize` while disabled, reviewing its result, and only then resuming.

## 7. Persistence contract

### 7.1 `JobWatch`

Stores the watch configuration, source targets and cadence, thresholds and weights, initialization timestamp, scheduling timestamps, and execution lease owner/token/expiry. Due-watch indexes cover `enabled`, `nextRunAt`, and `leaseExpiresAt`.

### 7.2 `ObservedJob`

Stores the unique source-scoped fingerprint, source identity, external ID, normalized and display fields, description hash, links, optional source publication time, first/last observation, closure timestamp, and optional raw normalized payload. Indexes support source/external-ID, company, publication-time, and first-seen queries.

### 7.3 `WatchMatch`

Stores one match per watch and observed job, explainable score data, workflow status (`new`, `reviewed`, `applied`, `dismissed`, `interview`, `rejected`, or `offer`), match timestamps, and notification state. Deleting a watch cascades through its matches and deliveries.

### 7.4 `NotificationDelivery`

Stores a unique idempotency key, match, notification type, provider/channel, non-secret destination reference, attempt count, retry/claim timestamps, terminal timestamps, sanitized provider response, and sanitized error message.

### 7.5 `WatchRun`

Stores one durable audit row per acquired execution with status `running`, `completed`, `partial`, or `failed`, source outcomes, pipeline counts, duration, and bounded error summary.

## 8. Scheduling and locking contract

1. The worker polls due watches every `WATCHER_SCHEDULER_POLL_MS` (15 seconds by default).
2. `listDueWatches` returns enabled watches whose watch-level due time has arrived and whose lease is absent or expired.
3. `tryAcquireWatchLease` atomically claims the watch and advances the watch-level next due time.
4. The executor renews the lease every one-third of its TTL while a run is active.
5. Explicit source targets independently track their own 3/15/60-minute due timestamps. Scheduled execution runs only due targets; initialize/manual execution forces all enabled targets.
6. A process-local active-watch set avoids redundant work in one process; the database lease is the cross-process correctness boundary.
7. After a restart, persisted due timestamps, expired leases, pending outbox rows, and idempotency keys allow work to resume without reinitializing.

The three-minute Tier 1 interval is a target cadence, not an end-to-end service-level guarantee. Poll delay, jitter, source runtime, retry, a previous long run, database events, worker restarts, and Discord availability can add latency.

## 9. Notification and latency contract

The required time points are source publication time when supplied, first Ever Jobs observation, first watch match, and notification delivery. Detection latency is calculated only when a valid source publication time exists. Notification latency is measured from first observation to successful delivery. When publication time is absent, the API must return it as absent rather than substituting the scrape time.

Provider-visible messages must omit full descriptions and secrets. The Discord test command sends a non-persistent configuration message and must not create a fake observation, match, or delivery row.

Telegram and generic webhook classes remain replaceable provider implementations, but Discord is the configured, documented, and tested production path for this release.

## 10. Public management contracts

### 10.1 REST API

All management routes use the existing admin/API-key convention.

| Method             | Route                                      | Purpose                                                           |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| `POST`             | `/api/watches`                             | Create a validated watch                                          |
| `POST`             | `/api/watches/default`                     | Create the safe disabled default watch                            |
| `GET`              | `/api/watches`                             | List watches                                                      |
| `GET/PATCH/DELETE` | `/api/watches/:id`                         | Read, update, or delete a watch                                   |
| `POST`             | `/api/watches/:id/run`                     | Safe manual run: baseline if uninitialized, recent-only otherwise |
| `POST`             | `/api/watches/:id/initialize`              | Force all enabled tiers in baseline mode                          |
| `POST`             | `/api/watches/:id/pause`                   | Disable future scheduled acquisition                              |
| `POST`             | `/api/watches/:id/resume`                  | Enable and make the watch due if no next time exists              |
| `GET`              | `/api/watches/:id/runs[/:runId]`           | Paginated run history and detail                                  |
| `GET`              | `/api/watches/:id/matches[/:matchId]`      | Filtered match history and detail                                 |
| `PATCH`            | `/api/watches/:id/matches/:matchId/status` | Update application workflow status                                |
| `GET`              | `/api/watches/:id/metrics`                 | Dashboard-ready persisted metrics                                 |
| `GET`              | `/api/observed-jobs[/:id]`                 | Filtered observed jobs and detail                                 |
| `GET`              | `/api/notifications/deliveries[/:id]`      | Filtered delivery history and detail                              |
| `POST`             | `/api/notifications/test`                  | Non-persistent Discord configuration test                         |

Collection endpoints use bounded pagination. Supported filters include the fields applicable to each resource: company, source, location, score, status, employment type, workplace type, and date bounds.

### 10.2 CLI

The CLI syntax is `npm run cli -- watch <action> ...`. Implemented actions are `create`, `update`, `list`, `show`, `delete`, `run`, `initialize`, `pause`, `resume`, `runs`, `matches`, `match-status`, `metrics`, `observed-jobs`, `deliveries`, and `notifications-test`. The CLI imports the same PostgreSQL repository with scheduler providers disabled.

## 11. Error contract

| Condition                                                                        | Behavior                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unknown watch, run, match, job, or delivery                                      | REST `404`; CLI descriptive non-zero failure                                               |
| Duplicate/overlapping or not-due execution                                       | REST `409`; scheduler treats a lease race as expected                                      |
| Invalid watch, filter, status, timezone, threshold, source target, or pagination | Validated `400` or CLI descriptive failure                                                 |
| Partial source rejection                                                         | Persist successful results, mark run `partial`, list failed source and sanitized reason    |
| Total source failure                                                             | Mark run `failed`; a baseline does not set `initializedAt`                                 |
| Malformed normalized job                                                         | Skip that record, preserve valid siblings, and mark the run partial with sanitized context |
| Retryable Discord/network/rate-limit failure                                     | Leave delivery pending with bounded next attempt                                           |
| Permanent provider/configuration failure or retry exhaustion                     | Mark delivery failed and persist sanitized provider classification                         |
| Missing Discord secret                                                           | Health reports not configured; provider test/delivery fails without revealing a URL        |
| Database unavailable at worker startup                                           | Scheduler startup fails and health is unhealthy                                            |

## 12. Non-functional requirements

| ID     | Requirement              | Target                                                                                               |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| NFR-1  | Tier 1 scheduling        | Every 3 minutes by default, plus up to one scheduler poll before acquisition                         |
| NFR-2  | Tier 2 scheduling        | Every 15 minutes by default                                                                          |
| NFR-3  | Tier 3 scheduling        | Every 60 minutes by default                                                                          |
| NFR-4  | Scheduler polling        | 15 seconds by default                                                                                |
| NFR-5  | Source timeout           | 12 seconds per attempt by default                                                                    |
| NFR-6  | Source concurrency       | Maximum 5 source requests per watch execution by default                                             |
| NFR-7  | Watch concurrency        | Maximum 2 active watches per process by default                                                      |
| NFR-8  | Retry                    | 3 attempts with 500 ms base delay by default, exponential backoff and jitter                         |
| NFR-9  | Execution lease          | 180-second TTL by default with periodic renewal                                                      |
| NFR-10 | Notification idempotency | At most one sent delivery per unique watch/job/type/channel/destination identity                     |
| NFR-11 | Secret handling          | No token, webhook URL, authorization header, cookie, or database credential in logs or API responses |
| NFR-12 | Deployment recovery      | Durable state survives process restart; expired leases and pending notifications are recoverable     |
| NFR-13 | Time handling            | UTC persistence; IANA timezone validation and DST-safe digest clock                                  |
| NFR-14 | Automated tests          | Deterministic fake sources/providers only; no live career-site dependency                            |

## 13. Test plan

### Unit

- Text/location normalization, URL canonicalization, tracking-parameter removal, fingerprint stability/difference, numeric external-ID coercion, and description hashing.
- Role/internship/Canada requirements, seniority and experience exclusions, company/source bonuses, skill caps, weights, threshold bands, and explainable breakdown.
- Explicit target planning, ATS slug validation, 3/15/60 due selection, query-term bounding, disabled targets, and force-all initialization.
- Watch validation, secret-reference restrictions, threshold ordering, timezone validation, and pagination/status validation.
- Discord payload escaping, allowed hosts, mention suppression, response classification, retry-after handling, and redaction.
- Notification enqueue-before-send, idempotency, transactional claims, retry schedule, terminal failure, and restart rehydration.
- Digest eligibility, score ordering, 25-item cap, timezone/DST clock, and immediate-notification exclusion.
- PostgreSQL and in-memory repository parity for leases, observation/match transactions, queries, and notification claims.

### Integration

- Migration applies to an empty PostgreSQL database and all uniqueness/index contracts are enforced.
- Watch creation/update/delete, safe seed idempotency, baseline initialization, second no-change run, one new job, description edit, partial source failure, and duplicate suppression.
- Two replicas race for the same watch lease and only one creates the run.
- Two retry workers race for the same delivery and only one provider call is allowed.
- Authenticated REST CRUD, filters, pagination, status update, metrics, and Discord test behavior.
- CLI action routing, safe manual mode selection, JSON output, filters, and scheduler-disabled application context.

### End-to-end

Use a deterministic fake source containing three baseline jobs. Initialize with zero notifications, add one strong internship, run once and assert one observation/match/delivery, rerun and assert no duplicate, edit its description and assert an update without new delivery, then add a medium-score job and assert digest eligibility.

### Operational validation

- Generate Prisma client; deploy migrations and seed.
- Run watcher package tests, API watcher tests, CLI tests, TypeScript builds, repository lint, docs lint, and production build.
- Start PostgreSQL plus the local worker, confirm `/health` and `/metrics`, initialize while disabled, run a Discord provider test, resume, and observe at least two Tier 1 scheduled runs.

## 14. Decisions

| Date       | Decision                                                                         | Rationale                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-14 | Use PostgreSQL due rows and renewable leases rather than Redis/BullMQ.           | PostgreSQL is already required for watcher persistence and provides restart-safe, multi-replica coordination with fewer local services.    |
| 2026-07-14 | Seed disabled and baseline by default.                                           | Prevents the highest-risk notification flood and makes activation an explicit operator decision.                                           |
| 2026-07-14 | Use explicit per-source targets and 3/15/60 cadence.                             | Direct/ATS sources can be timely without applying the same cost and fragility to all plugins.                                              |
| 2026-07-14 | Make Discord the production notification path.                                   | It is environment-backed, provider-safe, tested, and matches the initial operator requirement.                                             |
| 2026-07-14 | Persist an outbox row before provider I/O.                                       | Database commit, claim, retry, and idempotency state remain the notification correctness boundary.                                         |
| 2026-07-14 | Leave unsupported desired companies disabled.                                    | A stale endpoint must not create false confidence in an unattended three-minute pipeline.                                                  |
| 2026-07-14 | Recommend private, always-on Cloud Run with instance-based CPU for Google Cloud. | The current scheduler is a continuous process; Cloud Run Jobs are run-to-completion and request-throttled CPU would stop reliable polling. |

## 15. Known limitations

- Source plugins are external-schema integrations. An enabled source can still throttle, return incomplete data, or fail without warning.
- Some adapters can return an empty result instead of throwing; such behavior can be indistinguishable from a legitimately empty board until the adapter is hardened.
- Cross-source canonical grouping is computed only as a utility and is not a persisted merge relationship. The same posting from two sources may produce two observations.
- Automatic closed-job detection is not yet a complete source-independent lifecycle; `closedAt` exists but disappearance semantics vary by source.
- The digest pass sends individual digest-typed notifications rather than one aggregate Discord message.
- Publication-to-detection latency is unavailable when the source omits publication time.
- A partial baseline can cause older jobs from a failed source to look new on that source's first later success.
- Cloud Run minimum instances and Cloud SQL incur continuing cost.

## 16. References

- [Watcher application guide](../../../apps/watcher/README.md)
- [Local operations runbook](../../../docs/runbooks/watcher-local.md)
- [Google Cloud deployment runbook](../../../docs/runbooks/watcher-google-cloud.md)
- [Human-readable spec mirror](../../../docs/specs/016-realtime-job-watcher.md)
- [Google Careers public job search](https://www.google.com/about/careers/applications/jobs/results/)
- [Meta Careers public job search](https://www.metacareers.com/jobsearch/)
- [Shopify Careers](https://www.shopify.com/careers)
- [DoorDash Canada public Greenhouse board API](https://boards-api.greenhouse.io/v1/boards/doordashcanada/jobs?content=true)
- [Plaid public Ashby board API](https://api.ashbyhq.com/posting-api/job-board/plaid?includeCompensation=true)
- [Greenhouse Job Board API](https://developers.greenhouse.io/job-board.html)
- [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
