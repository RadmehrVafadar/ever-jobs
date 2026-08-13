# API Changelog

## [Unreleased] — 2026-08-10 — Spec 6003

### Changed

- Replaced the selectable `prestige-internships-v2` watch preset with the sole
  current preset, `canadian-tech-internships` revision 1, displayed as
  **Canadian Tech Internships**.
- The template retains its 26-company inventory and curated search, required,
  preferred, and excluded terms, but every preset-owned source scope now uses
  `CA` and the Toronto/GTA location list.
- Preset definitions may opt into `replace` semantics for locations and country
  codes. Canadian Tech Internships uses replacement, so applying it to an older
  watch removes stale `US`, `United States`, broad-Canada, and Waterloo scope.
- Preset preview field diffs now include `locationsRemoved` and
  `countryCodesRemoved` alongside the existing added-field arrays.
- `WatchSearchScope.strictLocations?: boolean` is an additive JSON/API field.
  When true, at least one returned job location must match the configured
  target locations. The Canadian template enables it for every target.
- Fresh-database default seeding now creates a disabled, uninitialized Canadian
  Tech Internships watch. Existing watch rows remain untouched at startup.

### Compatibility

- The retired preset string ID is no longer listed or accepted by the current
  preset REST/CLI/GUI surfaces. Deprecated TypeScript exports remain aliases to
  the new factory so existing source imports continue compiling.
- No database migration is required. Existing watches migrate only through an
  explicit paused preset apply followed by no-notification baseline and resume.

## [Unreleased] — 2026-08-04 — Spec 6002

> Implemented in the working tree. This entry records the additive contract and
> compatibility policy; the Spec 6002 task ledger records completed validation
> and the environment-blocked real-stack acceptance gates.

### Added

- `JobWatch.notificationRoutes` is an optional API field backed by a
  default-empty PostgreSQL JSON column. A route has this public shape:

  ```ts
  interface NotificationRoute {
    id: string;
    name: string;
    enabled: boolean;
    provider: "discord";
    destinationRef: string;
    conditions?: {
      sourceTiers?: Array<1 | 2 | 3>;
      notificationTypes?: Array<"urgent" | "standard" | "digest">;
      minimumScore?: number;
      maximumScore?: number;
    };
  }
  ```

  Conditions across fields use AND semantics, entries inside an array use OR
  semantics, and score bounds are inclusive. An enabled rule without conditions
  is a catch-all. Tier-constrained routes do not match when the source target
  tier cannot be resolved from `WatchMatch.sourceTargetKey`.

- `POST /api/watches/:id/apply` adds an optimistic, atomic update path for GUI
  and other administrative clients. Its request contains the version originally
  read and a normal validated watch patch:

  ```json
  {
    "expectedUpdatedAt": "2026-08-04T20:00:00.000Z",
    "patch": {
      "locations": ["Toronto, Ontario", "Waterloo, Ontario"],
      "notificationRoutes": []
    }
  }
  ```

  The response contains the public watch, a field-level diff, whether Apply
  paused the watch, and enabled target keys requiring no-notification baseline.
  A version mismatch returns HTTP 409 without mutation. Metadata, schedule,
  interval, timezone, and notification-only changes retain the current enabled
  state. Changes to sources/targets, companies, query/filter scope, eligibility,
  thresholds, or weights atomically pause the watch and require baseline before
  an explicit Resume.

- Authenticated preset list, preview, and apply REST operations expose the
  existing `WatchPresetService` contract. Preview is non-mutating. Apply retains
  the existing paused-watch requirement and merge behavior rather than
  implementing preset logic in the browser.

- Authenticated destination management under
  `/api/notification-destinations` adds:

  - masked list;
  - create or rotate a GUI-managed Discord alias;
  - delete a GUI-managed alias only when no legacy destination or route refers
    to it;
  - non-persistent destination test.

  Responses include only destination alias, provider, configuration source,
  and configured status. They never include a webhook URL or environment key.
  Process-environment entries take precedence and are read-only. GUI-managed
  values live only in ignored `.env.local` storage.

- `POST /api/jobs/compare` accepts the normal job-search input plus a bounded
  source selection and returns per-source successes, aggregate comparison data,
  and sanitized per-source failures. Source work uses configured bounded
  concurrency and `Promise.allSettled`; one source failure does not discard
  successful results.

- Authenticated `GET /api/operator/overview` distinguishes API, database, worker,
  scheduler, Discord, and source-coverage health from per-watch enabled state.
  An unavailable worker is not reported as a paused watch, and a paused watch
  is not reported as a stopped worker.

### Changed

- Notification dispatch selects every distinct provider/destination pair whose
  enabled route matches the message. Overlapping routes to the same pair are
  deduplicated before outbox enqueue.
- Whenever `notificationRoutes` is non-empty, routes are authoritative and
  legacy `notificationChannels` are not also broadcast. Legacy channels
  preserve their previous behavior only when the route array is absent or
  empty; disabling every configured route therefore cannot reactivate broad
  legacy delivery.
- Delivery idempotency remains watch + canonical episode + provider/channel +
  destination reference. Route ID and notification type remain excluded, so a
  route edit or score-band change cannot resend an episode to the same
  destination.
- Route-configured matches with no destination are suppressed with
  `notificationSuppressionReason: "routing"`. Route edits do not replay these
  historical matches. Pending-delivery retries use the provider and destination
  persisted on the outbox row and do not re-evaluate current routes.
- GUI configuration downloads omit secrets and runtime-only state. CLI
  watch JSON may opt into `notificationRoutes`; existing CLI and MCP behavior is
  otherwise unchanged.

### Security

- `default` continues to resolve `DISCORD_WEBHOOK_URL`. A custom bounded
  lowercase alias maps deterministically to an environment key; for example,
  `tier-one` maps to `DISCORD_WEBHOOK_TIER_ONE`.
- GUI-managed webhook writes validate approved HTTPS Discord hosts and webhook
  paths, use a same-directory temporary file plus atomic rename, and reload in
  API and worker through a small mtime cache without restarting either process.
- Webhook values and secret-bearing inputs are redacted from validation errors,
  request/application logs, provider responses, database rows, exports, and API
  responses.
- All mutation and destination-management routes use the existing admin API-key
  guard. The local GUI keeps that key in browser `sessionStorage` only.

### Compatibility and migration

- The Prisma migration is additive:
  `JobWatch.notificationRoutes Json @default("[]")`. It removes or rewrites no
  existing data.
- Existing rows and clients that omit `notificationRoutes` read an empty array
  and continue through `notificationChannels`.
- Legacy channels may remain stored beside routes for rollback, but they do not
  double-send while a non-empty route set is configured, even if every route is
  disabled.
- Existing REST, GraphQL, CLI, MCP, package scopes, environment names, metric
  names, Docker service names, and deployment resources remain compatibility
  contracts.

---

## [Unreleased] — 2026-07-21 — Spec 6000

### Added

- `JobPostDto.locations?: LocationDto[]` preserves every normalized advertised
  location. Existing singular `location` remains the primary compatibility
  field and is populated from the first normalized location when needed.
- Watch source targets accept optional `companyName`, nested `searchScope`
  (`countryCodes`, `locations`, optional `searchTerms`, optional
  `maxRequestsPerRun`), target-level `initializedAt`, and optional
  `resultsWanted`. Target result limits accept integers from 1 through 1000,
  persist in existing source-target JSON, participate in material preset diffs,
  and are forwarded to the scraper. Omitted values keep the executor default.
- `GET /api/watches/:id/coverage` and
  `watch coverage --id <watch-id>` return a `CompanyCoverageReport`. Its summary
  contains configured, active, disabled, uncovered, initialized, and degraded
  counts. One row per configured company includes status, target keys,
  initialization, last attempt/success/non-empty timestamps, consecutive hard
  failures, and degradation state. Coverage requires a normalized exact match
  against `sourceTargets[].companyName`; generic job boards do not count.
- `ever_jobs_watcher_company_coverage{watch_id,status}` exposes the same
  configured, active, disabled, uncovered, initialized, and degraded counts to
  Prometheus.
- Match/score explanations include `sourceTargetKey`, matched country, location
  confidence, and geography decision/suppression reason.
- `POST /api/watches/:id/initialize` accepts an optional JSON body:

  ```json
  { "targetKeys": ["google_careers", "linkedin"] }
  ```

  Omitted/empty keys retain initialize-all behavior. Unknown, disabled, or
  duplicate keys return a validated client error. Successful targets receive an
  independent baseline timestamp; failed siblings remain uninitialized.
- Watch/run/health responses expose target outcomes and durable health:
  successes, hard failures, valid empty runs, partial runs, consecutive hard
  failures, last attempt/success/non-empty/degradation timestamps, and Tier 1
  degradation. Any non-hard outcome resets the consecutive hard-failure streak.
  Worker health uses `coverage.{status,tier1Degraded,degradedTargets,watches}`;
  API health uses `watcherCoverage.{status,tier1Degraded,watches}`. Run target
  results expose `status` (`succeeded|partial|failed`), `outcome`
  (`success|empty|partial|hard_failure`), request/job/duration counts, flags,
  streak, and success/non-empty timestamps.
- Source-independent canonical episode identity groups equivalent observations
  while preserving every source record. Notification uniqueness is watch +
  canonical episode + channel/destination. Notification type is deliberately
  excluded so a score-band change cannot resend.
- URL/date-less canonical fallback episodes persist the first observation as a
  rolling 14-day anchor; they are not split by UTC calendar buckets.
- Reposts that reuse a stable source fingerprint after the fallback window keep
  the old observation and create an episode-scoped observation snapshot.
- Watch matches persist `notificationSuppressionReason` (`baseline` or
  `eligibility`). Only eligibility suppression can promote to pending after a
  richer eligible observation; sent and baseline-suppressed episodes remain
  terminal.

### Changed

- Prestige Internships v2 now runs Google Careers at one rotating request every
  10 minutes. Direct-company/ATS board targets use 10 minutes, Wellfound and
  Canada Job Bank use 30 minutes, and LinkedIn remains at 60 minutes.
- Prestige Internships v2 retains its identifier and advances to revision 3.
  Enabled Canada-only Tier 1 board targets for Uber, Notion, Ramp, Netflix, and
  IBM run every 10 minutes with `resultsWanted: 500`. The preset now partitions
  its 26 prestige companies into 21 first-class covered names and five explicit
  deferrals: RBC, TD, Scotiabank, BMO, and CIBC.
- Uber, Notion, Ramp, Netflix, and IBM treat transport, HTTP, blocked-shell,
  malformed-payload, and delegated-plugin failures as hard failures. A zero-job
  response is valid only after its official jobs collection or empty marker is
  validated. Notion and Ramp delegate to Ashby through `PluginRegistry`.
- The API initializes `ever_jobs_sources_total` from the discovered plugin
  registry size instead of the former hard-coded value of 160.

- Geography eligibility is target-tier-specific: Tier 1 accepts Canada; Tier
  2/3 accept Canada or the United States. Location preference scoring is
  separate from eligibility.
- Internship eligibility requires title or structured employment-type evidence;
  description-only student/intern mentions no longer qualify an ordinary
  full-time role.
- Query targets execute a bounded rotating term × location matrix instead of
  forwarding only the first watch-level country/location.
- Source failures that are HTTP, blocked, malformed, or schema-invalid are hard
  failures, not successful empty results. A valid parsed zero-job response stays
  a successful empty run. A partial request set remains a non-hard partial target
  outcome and, like success/valid-empty, resets the hard-failure streak.

### Compatibility and rollout

- All fields and schema changes are additive. Legacy watches without target
  scope/company/baseline/result-limit fields inherit watch-level or executor
  defaults. No Prisma migration is required for `resultsWanted`.
- The shipped preset watch is globally disabled and uninitialized. Its
  target-enabled set is `google_careers`, `shopify`, `ashby:wealthsimple`,
  `ashby:plaid`, all 13 legacy direct-company targets, `uber`, `notion`, `ramp`,
  `netflix`, `ibm`, `canadajobbank`, and `linkedin`. Target-enabled does not
  permit polling or notifications while the watch is paused.
- Only Google Jobs remains target-disabled. Microsoft is operator-enabled even
  though its earlier live smoke timed out; Google Jobs returned the classified
  enable-JavaScript shell.
- Before the Phase 13 additions, six deterministic source suites passed (59
  tests). Disabled live evidence
  returned two Canadian Google Careers roles, a marker-validated valid empty
  Shopify board, 37 Wealthsimple Ashby roles with a capped mapped sample, and a
  successful unauthenticated LinkedIn listing/detail result.
- Operators must targeted-baseline every target-enabled source and complete two
  additional no-notification observation cycles before resuming. Registration,
  tests, and live smoke do not enable notifications by themselves.
- For a revision 2 watch, preview and apply revision 3 while paused. Only
  `uber`, `notion`, `ramp`, `netflix`, and `ibm` should require a new baseline.
  Run operator-authorized disabled live smokes, inspect stable IDs, official
  URLs, locations and payload markers, baseline those five, and complete two
  no-notification observation cycles. A failing target remains individually
  disabled and visible as disabled coverage while healthy siblings continue.

---

### [v0.6.0-alpha] - 2026-02-25

#### Added

- **Redis-Backed Caching**: Optional Redis support via `REDIS_URL`. Falls back to in-memory if not configured.
- **GraphQL API**: New endpoint at `/graphql` (configurable path) with Apollo Playground.
- **Prometheus Metrics**: Export application metrics at `/metrics` for Prometheus scraping.
- **Retry Policies**: Configurable retries with linear and exponential backoff strategies for all job scrapers.
- **Plugin Architecture**: Runtime loading of community scrapers from a `plugins/` directory.
- **Expanded Sources**: Integrated JobsDB and Techcareers sources.

#### Changed

- `AppCacheModule` now uses `registerAsync` for dynamic configuration.
- `JobsService` now supports dynamic scraper registration.
- `HttpClient` standardizes request handling with built-in retries.

New environment variables: `REDIS_URL`, `CACHE_MAX_ITEMS`.

A full GraphQL API is now available alongside REST at `/graphql`:

- **Queries:** `searchJobs`, `listSources`
- **Apollo Playground** enabled by default (configurable via `ENABLE_GRAPHQL`, `GRAPHQL_PLAYGROUND`, `GRAPHQL_PATH`)
- Code-first schema generation with auto-introspection

New dependencies: `@nestjs/graphql`, `@nestjs/apollo`, `@apollo/server`, `graphql`, `cache-manager`, `cache-manager-redis-yet`, `prom-client`.

---

## [1.1.0] — 2026-02-25

### Phase 27: Asia-Pacific & US Tech Expansion (2 sources)

**JobsDB** (Asia-Pacific — SG, HK, TH) and **TechCareers** (US tech niche)

Total sources expanded from 158 to 160.

### New `siteType` Values

`jobsdb`, `techcareers`

---

## [1.0.0] — 2026-02-25

### Phases 23–26: Global & Niche Expansion (14 sources)

**Phase 23 — Japan, Nordic & Swiss (3):** Jobs in Japan, Duunitori (Finland), Jobs.ch (Switzerland)
**Phase 24 — UK & Mobile Dev (3):** Guardian Jobs, AndroidJobs, iOSDevJobs
**Phase 25 — DevOps, FP & Diversity (4):** DevOpsJobs, FunctionalWorks, PowerToFly, ClojureJobs
**Phase 26 — Sustainability (1):** EcoJobs

Total sources expanded from 144 to 158.

### New `siteType` Values

`jobsinjapan`, `duunitori`, `jobsch`, `guardianjobs`, `androidjobs`, `iosdevjobs`, `devopsjobs`, `functionalworks`, `powertofly`, `clojurejobs`, `ecojobs`

## [0.9.0] — 2026-02-22

### Phases 19–22: European & CIS Expansion (18 sources)

**Phase 19 — Tech niche & crypto (5):** RailsJobs, ElixirJobs, Crunchboard, CryptocurrencyJobs, HasJob
**Phase 20 — European regional (5):** iCrunchdata, SwissDevJobs, GermanTechJobs, VirtualVocations, NoFluffJobs
**Phase 21 — Niche & academic (5):** GreenJobsBoard, EuroJobs, OpenSourceDesignJobs, AcademicCareers, RemoteFirstJobs
**Phase 22 — Eastern European, CIS & Singapore (4):** Djinni (Ukraine), HeadHunter (Russia/CIS), HabrCareer (Russia), MyCareersFuture (Singapore)

Total sources expanded from 126 to 144.

## [0.8.0] — 2026-02-20

### Phases 15–18: European Government & RSS Expansion (19 sources)

**Phase 15 — European government & regional (5):** JobTechDev (Sweden), France Travail, NAV Jobs (Norway), Jobs.ac.uk, Jobindex (Denmark)
**Phase 16 — Global expansion (4):** GetOnBoard (LatAm), Freelancer.com, JoinRise, Canada Job Bank
**Phase 17 — NGO & international (3):** ReliefWeb, UNDP Jobs, DevITJobs
**Phase 18 — Niche RSS (5):** PyJobs, VueJobs, ConservationJobs, Coroflot, BerlinStartupJobs

Total sources expanded from 107 to 126.

### New Environment Variables

| Variable                         | Purpose                               |
| -------------------------------- | ------------------------------------- |
| `JOBTECHDEV_API_KEY`             | Swedish Employment Service API key    |
| `FRANCETRAVAIL_CLIENT_ID/SECRET` | France Travail OAuth2 credentials     |
| `NAVJOBS_TOKEN`                  | Norwegian NAV bearer token (optional) |

## [0.7.0] — 2026-02-19

### Phases 12–14: ATS & API-Key Expansion (13 sources)

**Phase 12 — ATS & niche board (3):** AuthenticJobs, JobScore (ATS), TalentLyft (ATS)
**Phase 13 — RSS niche boards (10):** CryptoJobsList, Jobspresso, HigherEdJobs, FOSSJobs, LaraJobs, PythonJobs, DrupalJobs, RealWorkFromAnywhere, GolangJobs, WordPressJobs
**Phase 14 — API-key sources & ATS (5):** Talroo, InfoJobs, Crelate (ATS), iSmartRecruit (ATS), Recruiterflow (ATS)

Total sources expanded from 89 to 107 (ATS count: 28 → 38).

### New Environment Variables

| Variable                    | Purpose                      |
| --------------------------- | ---------------------------- |
| `AUTHENTICJOBS_API_KEY`     | Authentic Jobs API key       |
| `TALENTLYFT_API_KEY`        | TalentLyft Bearer token      |
| `TALROO_PUBLISHER_ID/PASS`  | Talroo publisher credentials |
| `INFOJOBS_CLIENT_ID/SECRET` | InfoJobs OAuth credentials   |

## [0.6.0] — 2026-02-17

### Phases 9–11: Job Board & Government Expansion (16 sources)

**Phase 9 — Job board expansion (8):** The Muse, Working Nomads, 4 Day Week, StartupJobs, NoDesk, Web3Career, EchoJobs, JobStreet
**Phase 10 — Government boards & ATS (4):** CareerOneStop (US), Arbeitsagentur (Germany), Jobylon (ATS), Homerun (ATS)
**Phase 11 — Niche boards & developer APIs (4):** Hacker News, Landing.jobs, FindWork, JobDataAPI

Total sources expanded from 73 to 89.

### New Environment Variables

| Variable                 | Purpose                       |
| ------------------------ | ----------------------------- |
| `CAREERONESTOP_API_KEY`  | CareerOneStop Bearer token    |
| `ARBEITSAGENTUR_API_KEY` | German Arbeitsagentur API key |
| `FINDWORK_API_KEY`       | FindWork.dev API token        |
| `JOBDATAAPI_API_KEY`     | JobDataAPI key (optional)     |

## [0.5.0] — 2026-02-16

### Phases 6–8: ATS, Company & Board Expansion (22 sources)

**Phase 6 — New company scrapers (5):** Google Careers, Meta, Netflix, Stripe, OpenAI
**Phase 6 — New ATS integrations (3):** BreezyHR, Comeet, Pinpoint
**Phase 7 — Additional job boards (3):** BuiltIn, Snagajob, Dribbble
**Phase 8 — ATS expansion (10):** Manatal, Paylocity, Freshteam, Bullhorn, Trakstar, HiringThing, Loxo, Fountain, Deel, Phenom
**Phase 8 — Company scrapers (3):** IBM, Boeing, Zoom

Total sources expanded from 51 to 73.

### New Environment Variables

| Variable              | Purpose                   |
| --------------------- | ------------------------- |
| `FRESHTEAM_API_KEY`   | Freshteam API key         |
| `BULLHORN_CORP_TOKEN` | Bullhorn corp token       |
| `TRAKSTAR_API_KEY`    | Trakstar Hire API key     |
| `HIRINGTHING_API_KEY` | HiringThing API key       |
| `LOXO_API_TOKEN`      | Loxo API token (optional) |
| `FOUNTAIN_API_KEY`    | Fountain API key          |
| `DEEL_API_TOKEN`      | Deel API token            |

## [0.4.0] — 2026-02-15

### New Sources (5)

Added 5 new job source integrations (Tier 3 — heavy anti-bot / enterprise ATS):

**ATS (3):**

- **Oracle Taleo** — REST API (JSON), `{company}:{careerSection}` slug format
- **iCIMS** _(WIP)_ — JSON gateway + Playwright fallback with stealth mode
- **SAP SuccessFactors** _(WIP)_ — OData API + HTML fallback, `{instance}:{companyId}` slug format

**Job Boards (2):**

- **Monster** _(WIP)_ — `appsapi.monster.io` JSON API + Playwright stealth fallback (DataDome protected)
- **CareerBuilder** _(WIP)_ — Cheerio + Playwright stealth fallback (Cloudflare protected)

Total sources expanded from 46 to 51.

### New `siteType` Values

- `taleo`, `icims`, `successfactors` — ATS sources (require `companySlug` parameter)
- `monster`, `careerbuilder` — search-based job boards (included in default searches)

### BrowserPool Stealth Mode

New `stealth: true` option for `BrowserPool.getPage()` enables anti-bot evasion:

- User-Agent rotation (6 recent Chrome UAs across Mac/Win/Linux)
- Viewport randomization (5 common resolutions)
- JavaScript injection to mask `navigator.webdriver`, fake `window.chrome.runtime`, override `navigator.plugins`, patch canvas fingerprinting, and spoof WebGL renderer info

### Proxy Support

All 5 sources wire proxies through:

- HTTP sources: via `createHttpClient({ proxies })`
- Playwright sources: via `BrowserPool.getPage({ proxy, stealth: true })`

### WIP Sources Note

4 of 5 sources are marked WIP — Monster and CareerBuilder will likely need residential proxies for reliable operation. iCIMS layouts vary per company deployment. SuccessFactors OData access varies per company configuration.

## [0.3.0] — 2026-02-15

### New Sources (7)

Added 7 new job source integrations (Tier 2 — HTML scraping / Playwright):

**ATS (3):**

- **BambooHR** — Public JSON API, `{companySlug}.bamboohr.com/careers/list`
- **Personio** — Public XML feed, `{companySlug}.jobs.personio.de/xml`
- **JazzHR** _(WIP)_ — HTML scraping, `{companySlug}.applytojob.com/apply/jobs/`

**Job Boards (4):**

- **Dice** _(WIP)_ — Cheerio + Playwright fallback, US tech jobs
- **SimplyHired** _(WIP)_ — Cheerio + Playwright fallback, global
- **Wellfound** _(WIP)_ — Playwright SPA (`__NEXT_DATA__` extraction), startup jobs
- **StepStone** _(WIP)_ — Playwright SPA, Germany (`.de`) initially

Total sources expanded from 39 to 46.

### New `siteType` Values

- `bamboohr`, `personio`, `jazzhr` — ATS sources (require `companySlug` parameter)
- `dice`, `simplyhired`, `wellfound`, `stepstone` — search-based job boards (included in default searches)

### Proxy Support

All 7 sources wire proxies through:

- HTTP sources: via `createHttpClient({ proxies })`
- Playwright sources: via `BrowserPool.getPage({ proxy })`

### WIP Sources Note

5 of 7 sources are marked WIP — code is shipped but HTML selectors need validation against live sites. These sources will gracefully return empty results if selectors are outdated.

## [0.2.0] — 2026-02-14

### New Sources (5)

Added 5 new job source integrations (Tier 1.5 — free API key required):

- **USAJobs** — US government job board (`USAJOBS_API_KEY` + `USAJOBS_EMAIL`)
- **Adzuna** — Multi-country aggregator, 12+ countries (`ADZUNA_APP_ID` + `ADZUNA_APP_KEY`)
- **Reed** — UK-focused job board (`REED_API_KEY`)
- **Jooble** — 70+ country aggregator (`JOOBLE_API_KEY`)
- **CareerJet** — 80+ country aggregator (`CAREERJET_AFFID`)

Total sources expanded from 34 to 39.

### New `siteType` Values

- `usajobs`, `adzuna`, `reed`, `jooble`, `careerjet` — search-based job sources (included in default searches when API keys are configured)

### New Input Field

- `clientIp` — Optional client IP address for sources that require it (e.g. CareerJet). Also useful for residential proxy rotation strategies. Combined with the existing `proxies` array for multi-IP support.

### Per-Request Auth Override

All API-key sources now support per-request credential override via `auth` in the request body, following the existing Upwork pattern. This allows clients to use their own API keys instead of (or in addition to) server-side environment variables.

New `auth` sub-objects: `auth.usajobs`, `auth.adzuna`, `auth.reed`, `auth.jooble`, `auth.careerjet`, `auth.exa`

Each credential field resolves independently — callers can override individual fields while keeping others from env vars (e.g. override `auth.usajobs.apiKey` but keep `email` from `USAJOBS_EMAIL`).

## [0.1.1] — 2026-02-14

### New Sources (8)

Added 8 new job source integrations (Tier 1 — public APIs/RSS, no auth required):

- **Job Boards (6):** RemoteOK, Remotive, Jobicy, Himalayas, Arbeitnow, We Work Remotely
- **ATS (2):** Recruitee, Teamtailor

Total sources expanded from 26 to 34.

### New `siteType` Values

- `remoteok`, `remotive`, `jobicy`, `himalayas`, `arbeitnow`, `weworkremotely` — search-based job boards (included in default searches)
- `recruitee`, `teamtailor` — ATS sources (require `companySlug` parameter)

## [0.1.0] — 2026-02-08

### New Endpoints

- `POST /api/jobs/search` — search for jobs across multiple boards
  - JSON body input with `ScraperInputDto`
  - Wrapped response: `{ count, jobs, cached }`
  - CSV export via `?format=csv`
  - Pagination via `?paginate=true&page=1&page_size=10`
  - Response caching with configurable TTL
- `POST /api/jobs/analyze` — search and analyze jobs with summary statistics
- `GET /health` — service health with uptime, version, and memory usage
- `GET /ping` — simple liveness check

### Security

- API key authentication via configurable header (default: `x-api-key`)
- Per-client request throttling with configurable limits

### Response Headers

- `X-Request-Id` — unique request identifier for tracing
- `X-Process-Time` — request processing duration in ms
