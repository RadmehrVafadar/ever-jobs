# Upgrade Guide

## Spec 6003 — Canadian Tech Internships (2026-08-10)

The current starter template is `canadian-tech-internships` revision 1. It
replaces the selectable Canada/USA prestige preset and narrows every preset
source scope to `CA` plus Toronto and the GTA.

Existing watches are not modified during application startup. To migrate one:

1. Pause it and preview the new preset:

   ```bash
   npm run cli -- watch pause <watch-id> --json
   npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
   ```

2. Confirm the preview removes `US`, `United States`, broad `Canada`, and
   Waterloo while retaining the intended companies and term filters.
3. Apply explicitly:

   ```bash
   npm run cli -- watch preset apply canadian-tech-internships \
     --watch <watch-id> \
     --apply
   ```

4. Initialize every enabled target reported by
   `targetKeysRequiringInitialization` without notifications, review partial
   failures and baseline results, and explicitly resume only when complete.

Fresh databases seed the new watch disabled and uninitialized. No schema
migration is required. Deprecated TypeScript names remain compilation aliases,
but the old string ID is no longer a selectable template. The canonical import
example is
[`examples/canadian-tech-internships.watch.json`](../examples/canadian-tech-internships.watch.json).

## Spec 6000 — Prestige Internship Coverage Expansion (2026-07-19)

This is an additive watcher upgrade. It introduces multi-location jobs,
source-independent canonical episodes, per-target baseline/health state,
target-scoped search settings, targeted initialization, and the versioned
`prestige-internships-v2` preset. It does not require deleting the original
watch, observations, deliveries, or Toronto example.

### Compatibility

- `JobPostDto.location` remains supported as the primary location;
  `locations[]` carries all normalized advertised locations.
- Existing source targets without `companyName`, `searchScope`, or
  `initializedAt` inherit watch-level values and baseline state.
- Existing watches, destinations, score thresholds, history, and unrelated
  operator edits are preserved by preset merge.
- Source-specific observations remain durable. New canonical episode fields
  group cross-source matches and notifications without deleting provenance. A
  stable source fingerprint reused after a fallback episode expires creates an
  episode-scoped observation snapshot rather than mutating the old episode.
- Delivery identity is watch + canonical episode + channel/destination and
  excludes notification type, so a standard/urgent/digest band change cannot
  resend. URL/date-less fallback episodes are anchored at first observation for
  a rolling 14 days rather than split into UTC calendar buckets.
- Matches persist `notificationSuppressionReason`. Baseline suppression never
  promotes; eligibility suppression may promote to pending when richer evidence
  becomes eligible and no delivery has been sent. Legacy sent/suppressed state
  remains terminal unless a new eligibility reason is explicitly recorded.
- Schema and contract changes remain in place during rollback; rollback disables
  individual targets rather than reversing the additive migration.

### Upgrade steps

1. Back up PostgreSQL according to the deployment's normal policy and pause the
   watch:

   ```bash
   npm run cli -- watch pause <watch-id> --json
   ```

2. Install the revision, generate Prisma, and apply checked-in migrations before
   starting the upgraded scheduler:

   ```bash
   npm ci
   npm run db:generate
   npm run db:migrate
   ```

3. Start the API/watcher with the watch globally disabled and uninitialized.
   Target-enabled flags describe validated inventory but cannot poll or notify
   while the watch remains paused.

4. Preview the preset. This is side-effect free:

   ```bash
   npm run cli -- watch preset apply prestige-internships-v2 --watch <watch-id>
   ```

5. Review unchanged, added, materially changed, disabled, and operator-only
   targets. Apply only while paused:

   ```bash
   npm run cli -- watch preset apply prestige-internships-v2 \
     --watch <watch-id> \
     --apply
   ```

6. Baseline only added/materially changed target-enabled sources. Repeat
   `--target` for each key. The shipped set is `google_careers`, `shopify`,
   `ashby:wealthsimple`, `ashby:plaid`, `canadajobbank`, and `linkedin`:

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

7. Inspect target outcome/health, normalized `locations`, matched geography,
   and external employer application URLs. A blocked, malformed, schema-invalid,
   or HTTP-failed target must remain uninitialized/disabled; a valid empty result
   is successful but should be compared with historical `lastNonEmptyAt`. A
   partial target increments `partialRunCount`; success, valid empty, and partial
   outcomes all reset the consecutive hard-failure streak.

8. Repeat targeted initialization for two additional no-notification observation
   cycles. Confirm all required target baselines, both cycle outcomes, and Tier 1
   coverage; test Discord and resume only after review.

Recorded pre-resume evidence is six deterministic source suites/59 tests; Google
Careers two live Canadian roles; Shopify marker-validated valid empty;
Wealthsimple 37 live Ashby roles with a capped mapped sample; LinkedIn public
pass; Microsoft timeout; and Google Jobs classified blocked. Google Jobs,
Microsoft, and all other unproven legacy direct targets remain target-disabled.

### Preset and examples

The current example is
[`examples/prestige-internships-v2-canada-usa.watch.json`](../examples/prestige-internships-v2-canada-usa.watch.json).
The older
[`examples/toronto-canada-software-internships.watch.json`](../examples/toronto-canada-software-internships.watch.json)
is retained for compatibility but deprecated. New installations seed the v2
preset disabled and uninitialized. Existing installations are not silently
rewritten during bootstrap.

### Rollback

Pause the watch, disable the affected target in a validated watch update (or
reapply the prior target set after reviewing a dry-run diff), and resume the
unaffected targets. Do not drop multi-location, canonical episode, delivery, or
target-health columns. Google Jobs and unproven legacy direct-company targets
remain disabled. If a target-enabled source regresses, disable only that target
while the watch is paused. Do not resume until every required target baseline and
both no-notification observation cycles succeed.

## v0.0.x → v0.1.0

### Breaking Changes

None — this is the initial featured release.

### Steps

1. Pull the latest code
2. Install new dependencies:
   ```bash
   npm install
   ```
3. Copy new environment variable template:
   ```bash
   cp .env.example .env
   ```
4. Review and update your `.env` with desired settings
5. Rebuild:
   ```bash
   npm run build
   ```
6. If using Docker, rebuild the image:
   ```bash
   docker compose build --no-cache
   docker compose up -d
   ```

### New Environment Variables

The following env vars are new in v0.1.0 (all optional with sensible defaults):

| Variable               | Default | Purpose                        |
| ---------------------- | ------- | ------------------------------ |
| `ENABLE_API_KEY_AUTH`  | `false` | Enable API key authentication  |
| `API_KEYS`             | (empty) | Comma-separated valid API keys |
| `RATE_LIMIT_ENABLED`   | `false` | Enable rate limiting           |
| `RATE_LIMIT_REQUESTS`  | `100`   | Max requests per window        |
| `RATE_LIMIT_TIMEFRAME` | `3600`  | Window size in seconds         |
| `ENABLE_CACHE`         | `false` | Enable response caching        |
| `CACHE_EXPIRY`         | `3600`  | Cache TTL in seconds           |
| `CORS_ORIGINS`         | `*`     | Allowed CORS origins           |
| `LOG_LEVEL`            | `info`  | Logging level                  |
| `ENABLE_SWAGGER`       | `true`  | Enable Swagger UI              |

## Applying Patch Releases

```bash
git pull origin main
npm install
npm run build
# or with Docker:
docker compose build
docker compose up -d
```
