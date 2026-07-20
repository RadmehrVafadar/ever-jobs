# Spec: 6000 — Prestige Internship Coverage Expansion

| Field         | Value                                           |
| ------------- | ----------------------------------------------- |
| Spec ID       | 6000                                            |
| Slug          | `prestige-internship-coverage-expansion`        |
| Status        | in-progress                                     |
| Owner         | Ever Jobs maintainers                           |
| Created       | 2026-07-19                                      |
| Last updated  | 2026-07-20                                      |
| Supersedes    | (none)                                          |
| Related specs | 003, 005, 016, 975, 5001, 5007                |

## 1. Problem statement

The real-time internship watcher intentionally disabled stale Google Careers,
Shopify, Google Jobs, LinkedIn, Meta, and Wellfound paths when Spec 016 shipped.
That safe default prevented false confidence, but it leaves material gaps for
Canadian software internships: Google, Shopify, and Wealthsimple are not active
direct/ATS targets, while company-board observations have no Google Jobs or
LinkedIn redundancy. The existing planner also uses a small term-only query
budget and passes only the first watch-level country/location, so a configured
Canada-wide or Canada/US policy is not faithfully executed.

The current watcher identity is source-oriented. Equivalent postings found on a
company board, Google Jobs, and LinkedIn can create separate observations,
matches, and notification identities. A partial source failure is persisted at
run level, but target-specific baseline state and health are not durable, and an
adapter that converts a blocked or malformed response into `[]` can be mistaken
for a healthy empty board. The singular `JobPostDto.location` also loses genuine
multi-location data needed for correct geography decisions and canonical
identity.

This feature expands coverage without weakening safety. Tier 1 remains Canada
only. Tiers 2 and 3 cover Canada and the United States. Only software/engineering
internships and co-ops qualify. New installations receive a disabled,
uninitialized, versioned preset. Sources remain disabled until fixture tests and
documented smoke validation demonstrate that failures are surfaced and Canadian
coverage is not accidentally Toronto-only.

### 1.1 Amendment precedence over Spec 016

Spec 6000 extends rather than supersedes the complete watcher. Where the two
specifications differ, the following clauses replace only the listed Spec 016
behavior; every unlisted Spec 016 contract remains authoritative.

| Spec 016 contract | Spec 6000 amendment |
| ----------------- | ------------------- |
| FR-13 source-scoped fingerprint as the match identity | Keep it for observation identity; use the source-independent canonical episode for match and notification identity. |
| FR-18 watch-level Canada requirement | Evaluate geography against the producing target: Tier 1 Canada; Tier 2/3 Canada or US. |
| FR-22 whole-watch first-run baseline | Baseline independently per source-target, with optional selected target keys. |
| FR-25 observed-job-based notification identity | Key delivery idempotency by watch, canonical episode, channel, and destination. Notification type is deliberately excluded so a score-band change cannot resend the posting. |
| Section 6 source readiness | Use the v2 source matrix and evidence gates in this spec. |
| Known limitation: adapters may silently return empty success | Repaired/enabled sources must classify blocked, malformed, schema, and HTTP failures as hard failures. |
| Known limitation: cross-source canonical grouping is not persisted | Persist canonical episode grouping and retain every source observation. |
| Known limitation: duplicate cross-source matches/deliveries | Upsert one match and delivery identity per canonical episode/destination. |
| Known limitation: a partial baseline can surface old jobs later | Persist target-level baseline and initialize only successful selected targets. |

## 2. Goals

- Activate repaired, fixture-backed Google Careers and Shopify company sources
  plus the maintained Ashby integration targeting Wealthsimple.
- Repair Google Jobs and harden LinkedIn public guest search as redundant Tier 2
  and Tier 3 discovery paths for Canada and the United States.
- Preserve source-target context through planning, execution, eligibility,
  scoring, persistence, health reporting, and notification idempotency.
- Execute a bounded, deterministically rotating search-term × location matrix so
  every configured query is eventually searched.
- Parse and persist all known locations, apply explicit tier geography, and keep
  Toronto/GTA/Waterloo as preferences rather than Canada-wide gates.
- Require title or structured-employment internship/co-op evidence and recognize
  the requested software engineering discipline families.
- Deduplicate equivalent cross-source postings into one canonical episode and
  one destination-specific notification while retaining every observation.
- Persist target baselines and health counters; expose Tier 1 degradation after
  three consecutive hard failures.
- Add targeted initialization, a dry-run-first preset application workflow,
  additive schema migration, operational alerts, and complete documentation.
- Narrow the production watch to Summer 2027, suppress PhD/doctoral internships,
  and prevent non-Tier-1 LinkedIn discoveries from receiving urgent/max scores.

## 3. Non-goals

- Authenticated LinkedIn automation, personal cookies, CAPTCHA bypass, or exact
  recreation of personalized LinkedIn account alerts.
- Mailbox ingestion, automatic applications, resume submission, or application
  workflow automation.
- New-graduate, experienced, senior, staff, principal, lead, management, or
  director role coverage.
- Enabling the Google Jobs aggregator while its live response remains classified
  as blocked; this is separate from the operator-authorized direct-company set.
- Replacing the maintained Ashby plugin with a Wealthsimple-specific scraper.
- Destructive migration or automatic removal of old presets, examples, history,
  operator edits, notification destinations, or thresholds.
- Treating a live third-party request as a CI test dependency.
- Treating every mention of a PhD researcher as proof that an internship is
  restricted to PhD candidates; description filtering requires enrollment or
  candidate language.
- Reclassifying source tiers, changing their cadence/geography contracts, or
  promoting a company merely because LinkedIn returned its posting.

## 4. User and operator stories

> As a Canadian internship candidate, I want Google, Shopify, Wealthsimple, and
> every other enabled Tier 1 source searched Canada-wide so that Vancouver,
> Calgary, Montréal, Ottawa, Toronto/GTA, Waterloo, remote-Canada, and other
> Canadian opportunities can qualify.

> As an operator, I want Google Jobs and public LinkedIn searches to provide
> redundant Canada/US discovery without duplicate notifications.

> As an operator, I want a failed or blocked source reported as a hard failure,
> not a successful run with zero results, so health reflects actual coverage.

> As an operator upgrading an existing watch, I want to preview and apply the v2
> preset while paused, baseline only changed targets, and preserve history and
> notification configuration.

> As an API or CLI caller, I want to initialize selected target keys so that a
> repaired or newly added source can be safely baselined without resetting the
> entire watch.

> As the production watch operator, I want only Summer 2027 internships to notify,
> PhD/doctoral internships suppressed, and LinkedIn discoveries outside the Tier
> 1 target-company set kept below the urgent band.

## 5. Functional requirements

### 5.1 Contracts and compatibility

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-1 | Add optional `watchMode: "board" | "query"` to source plugin metadata. Complete company/ATS boards declare `board`; search surfaces declare `query`. | must |
| FR-2 | Google Careers and Microsoft explicitly declare their real behavior instead of inheriting a direct/ATS heuristic. | must |
| FR-3 | Add optional `companyName`, `searchScope`, and target-level `initializedAt` to persisted `WatchSourceTarget`. Missing fields inherit watch-level values and baseline state. | must |
| FR-4 | Add optional `locations: LocationDto[]` to `JobPostDto`; retain singular `location` as the primary compatibility value and populate it from the first normalized location when needed. | must |
| FR-5 | Preserve target key, tier, company context, scope, and request context through every pipeline stage and persisted explanation. | must |
| FR-6 | Extend score explanations with `sourceTargetKey`, matched country, location confidence, and an explicit geography decision/suppression reason. | must |
| FR-7 | The REST initialize action accepts optional target keys; the CLI exposes repeatable `--target <key>` values. Empty/omitted keys preserve initialize-all behavior. | must |
| FR-8 | Legacy watch JSON and database rows without new fields validate, round-trip, and execute using watch-level defaults. | must |

### 5.2 Company and ATS coverage

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-9 | Repair `source-company-google` against official Google Careers results/detail HTML, restricted by its Tier 1 target scope to Canadian internship/co-op searches. | must |
| FR-10 | Google mapping preserves a stable public job identifier, official job/application URLs, genuine publication dates when present, and every advertised location. | must |
| FR-11 | Google HTTP, blocking, markup, embedded-data, and schema failures throw a classified error; only a valid parsed empty result is a successful zero-result response. | must |
| FR-12 | Add `source-company-shopify` with `Site.SHOPIFY`, its Nest module/service/index/package, and all four source registration points. | must |
| FR-13 | Shopify parses server-rendered official careers listing/detail pages, uses the public JID/job identifier, retains multi-location and remote labels, and never guesses an Ashby slug or calls a private endpoint. | must |
| FR-14 | Shopify covers software, backend/frontend/full-stack/mobile, developer experience, platform/cloud/infrastructure/SRE/DevOps/security, data engineering, and ML/AI internship disciplines. | must |
| FR-15 | Configure Wealthsimple through `Site.ASHBY`, `companySlug: "wealthsimple"`, and `companyName: "Wealthsimple"`; no Wealthsimple-specific source package is created. | must |
| FR-16 | Audit every enabled Tier 1 target with fixture-backed Canada-wide search or post-filter behavior. Any target without that evidence remains present but disabled with a documented reason. | must |

### 5.3 Redundant query sources

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-17 | Repair Google Jobs (`source-google`) for bounded Canada/US search, preserve external employer application URLs when present, and propagate malformed/blocked response failures. | must |
| FR-18 | Harden LinkedIn public guest search for Canada/US with no authentication, cookies, browser session, or challenge bypass. | must |
| FR-19 | LinkedIn requests newest-first within a bounded recent window; detail fetches occur only for coarse internship candidates and extract external application URLs when exposed. | must |
| FR-20 | Google Jobs and LinkedIn unattended targets are enabled in the v2 preset only after fixture, failure, and documented disabled smoke validation. | must |
| FR-21 | Canada Job Bank remains an enabled Tier 2 Canadian contributor. The operator-authorized legacy direct-company set—Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel, Meta, and Wellfound—is target-enabled, Canada-scoped, and baseline-required. | must |

### 5.4 Query planning and location normalization

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-22 | Build the full deterministic Cartesian product of unique search terms and locations for each query target; each request carries the target country codes and selected location. | must |
| FR-23 | Enforce target `maxRequestsPerRun` after matrix construction. When over budget, choose a deterministic rotating slice based on stable target/run state so no matrix entry is permanently skipped. | must |
| FR-24 | Tier 1 default query locations are `Canada`, `Toronto, Ontario`, `Greater Toronto Area`, and `Waterloo, Ontario`; Tier 2/3 add `United States`. | must |
| FR-25 | Default query terms cover general software development/co-op, backend/frontend/full-stack/mobile/developer experience, platform/cloud/infrastructure/SRE/DevOps/security, and data/ML/AI engineering. | must |
| FR-26 | The shared parser recognizes all Canadian provinces/territories, US states/DC, common country aliases, Toronto/GTA/Waterloo, regional-remote labels, and delimited multi-location strings. | must |
| FR-27 | Location normalization preserves all distinct source locations in stable source order while canonical identity uses a sorted normalized set. | must |

### 5.5 Eligibility and ranking

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-28 | Tier 1 qualifies only jobs having at least one confidently Canadian location. Tier 2/3 qualify jobs having at least one Canadian or American location. | must |
| FR-29 | `Remote Canada` qualifies all tiers; `Remote US` qualifies Tier 2/3 only. `North America` or `Remote Americas` qualifies Tier 2/3 unless text explicitly excludes both Canada and the US. | must |
| FR-30 | Unknown/ambiguous geography is persisted with `geography-unknown` suppression and cannot send an immediate notification. | must |
| FR-31 | Toronto, GTA, and Waterloo affect preference score only. No other Canadian location is rejected or allowed to fail solely because of location score. | must |
| FR-32 | A role requires internship/co-op evidence in its title or structured employment type. A description-only mention of interns, students, university, or campus never qualifies a full-time title. | must |
| FR-33 | Recognize requested software/engineering discipline families and continue rejecting senior/experienced leadership roles. | must |
| FR-34 | Each explanation records eligibility separately from ranking and includes source target, matched country, confidence, decision, matched terms, and exclusion/suppression reason. | must |

### 5.6 Canonical identity, persistence, and notification

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-35 | Persist normalized location arrays and a source-independent canonical job key through an additive Prisma migration. | must |
| FR-36 | Canonical base identity hashes normalized company, normalized title, sorted normalized locations, and canonical external employer application URL. | must |
| FR-37 | When no employer URL exists, identity includes publication date. When URL and date are both unavailable, the first observation anchors a persisted rolling episode reused for 14 days; a later observation may begin a new episode after that window. This is not a UTC calendar bucket. | must |
| FR-38 | Retain every source observation and its source-specific fingerprint while grouping matches/notification identity by watch and canonical episode. | must |
| FR-39 | Notification uniqueness is watch + canonical episode + channel/destination, never source observation ID or notification type. A standard/urgent/digest band change cannot resend the same episode to the same destination. | must |
| FR-40 | A later richer observation may update canonical/match fields without erasing prior observations. If the episode was already sent or baseline-suppressed it cannot send again; if it was eligibility-suppressed and has no delivery, it may become pending and send exactly once when the richer observation becomes eligible. | must |

### 5.7 Target health and rollout

| ID | Requirement | Priority |
| -- | ----------- | -------- |
| FR-41 | Persist per-target success, hard-failure, empty-run, and partial-run counts; consecutive hard failures; last attempt, last success, last non-empty, degradation, and baseline times. | must |
| FR-42 | Mark Tier 1 coverage degraded after three consecutive hard failures. Any later non-hard outcome (`success`, valid `empty`, or `partial`) resets the consecutive hard-failure count; none is recorded as a hard failure. | must |
| FR-43 | Expose target health and aggregate Tier 1 degradation in worker/API health, run summaries, watch metrics, and Prometheus series. | must |
| FR-44 | Add documented alerting for degraded Tier 1 targets and unexpected result-count collapse without classifying every empty board as a hard failure. | must |
| FR-45 | Add versioned preset `prestige-internships-v2`, disabled and uninitialized for new installs, with Tier 1/2/3 cadence and sources defined by this spec. | must |
| FR-46 | Add a Canada/USA example and retain the Toronto example with a deprecation notice. | must |
| FR-47 | Add `watch preset apply` as dry-run by default; mutation requires an explicit apply flag and a paused watch. | must |
| FR-48 | Preset application preserves notification destinations, thresholds, history, and unrelated operator edits; it baselines only newly added or materially changed targets before resume. | must |
| FR-49 | Rollback can disable individual targets. Database and public contract additions remain backward-compatible and are not rolled back destructively. | must |
| FR-50 | The v2 preset query terms explicitly target Summer 2027 across every existing software/engineering discipline family. Board-shaped sources remain whole-board fetches and are post-filtered after normalization. | must |
| FR-51 | A notification-eligible posting must contain unambiguous Summer 2027 evidence in its title or description. `Summer '27`, `Summer 27`, `Summer of 2027`, and `2027 Summer` are equivalent; other or missing terms persist with `not-summer-2027` suppression. | must |
| FR-52 | A title containing `PhD`, dotted/spaced `Ph.D`, `doctoral`, or `doctorate` is suppressed. A description is suppressed only when those degree terms occur in explicit student/candidate/enrollment/pursuit/program eligibility language; incidental mentions of PhD colleagues or research do not suppress. | must |
| FR-53 | For a result produced by the LinkedIn target, Tier 1 company membership derives from configured `sourceTargets` having `tier === 1` and a `companyName`; it does not derive from the flat prestige ranking list. Company comparison is case/punctuation-insensitive and permits a configured brand at the beginning of a legal/source company name. | must |
| FR-54 | A LinkedIn result outside that Tier 1 company set retains its calculated breakdown but its total is capped at `urgentScore - 1` (never below zero). It may remain a standard or digest match but cannot be urgent or display as `100/100` under the default thresholds. | must |
| FR-55 | Direct/ATS observations and LinkedIn observations for Tier 1 companies retain normal scoring. Existing observation, canonical episode, suppression, and idempotency contracts remain unchanged. | must |
| FR-56 | Google Careers canonical job and episode identity uses the stable official results URL containing Google's numeric posting ID, not the application URL whose `q`, `location`, pagination, locale, and targeting parameters vary by search-matrix request. The complete application URL remains available for the operator's Apply action. | must |
| FR-57 | Repeated Google Careers observations with the same stable posting ID and result URL produce one stored source observation, one canonical match episode, and at most one delivery per destination, even when their application-query parameters differ. Distinct Google posting IDs such as BS and MS requisitions remain distinct. | must |

## 6. Core contracts

### 6.1 Plugin metadata

```ts
export type SourceWatchMode = "board" | "query";

export interface IPluginMetadata {
  site: Site;
  name: string;
  category: PluginCategory;
  isAts?: boolean;
  description?: string;
  watchMode?: SourceWatchMode;
}
```

Absent `watchMode` retains the current compatibility heuristic; every source
touched by this feature declares it explicitly.

### 6.2 Watch target and search scope

```ts
export interface WatchSearchScope {
  countryCodes: string[];
  locations: string[];
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}

export interface WatchSourceTarget {
  site: Site | string;
  tier: 1 | 2 | 3;
  intervalMinutes: number;
  companySlug?: string;
  companyName?: string;
  searchScope?: WatchSearchScope;
  enabled: boolean;
  initializedAt?: Date | null;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
}
```

The planner's derived target includes the same context plus stable `key`,
`configuredSource`, `kind`, and effective `mode`. Target keys are
`<site>` for a singleton source and `<site>:<companySlug>` for generic ATS
boards. A request adds `searchTerm`, `location`, `countryCodes`, and a stable
matrix index. The entire request and target context accompanies every returned
job, even when one source executes multiple matrix requests.

### 6.3 Job locations and geography explanation

```ts
export class JobPostDto {
  // Existing fields omitted.
  location?: LocationDto | null;
  locations?: LocationDto[];
}

export type GeographyDecision =
  | "eligible-canada"
  | "eligible-united-states"
  | "eligible-north-america"
  | "outside-target-scope"
  | "geography-unknown";

export interface GeographyExplanation {
  sourceTargetKey: string;
  matchedCountry?: "CA" | "US";
  locationConfidence: "high" | "medium" | "low" | "unknown";
  geographyDecision: GeographyDecision;
}
```

### 6.4 Targeted initialization

```http
POST /api/watches/:id/initialize
Content-Type: application/json

{ "targetKeys": ["ashby:wealthsimple", "canadajobbank"] }
```

```text
npm run cli -- watch initialize <watch-id> \
  --target ashby:wealthsimple \
  --target canadajobbank
```

Unknown, disabled, or duplicate keys produce a validated client error. A target
is marked initialized only after that target succeeds in baseline mode. Failure
does not set its baseline time and does not hide successful sibling baselines.

### 6.5 Preset apply

```text
npm run cli -- watch preset apply prestige-internships-v2 --watch <id>
# dry-run JSON diff; no state change

npm run cli -- watch preset apply prestige-internships-v2 --watch <id> --apply
# requires watch.enabled === false
```

The diff classifies targets as unchanged, added, materially changed, disabled,
or operator-only. Material fields are site, slug/name, tier, interval, and scope.

## 7. Source behavior matrix

| Target | Tier | Mode | Scope | Preset state |
| ------ | ---- | ---- | ----- | ------------ |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel | 1 | declared board/query | Canada | target-enabled by operator decision; each must complete a paused no-notification baseline and expose failures before resume |
| Google Careers | 1 | query | Canada | target-enabled inside the globally disabled/uninitialized watch; live smoke returned two Canadian roles; target baseline and two observation cycles remain |
| Shopify | 1 | board | Canada | target-enabled inside the globally disabled/uninitialized watch; live board was marker-validated empty; target baseline and two observation cycles remain |
| Ashby `wealthsimple` | 1 | board | Canada post-filter | enabled |
| Ashby `plaid` | 1 | board | Canada post-filter | enabled |
| Canada Job Bank | 2 | query | Canada | enabled |
| Google Jobs | 2 | query | Canada + US | disabled; live smoke classified the enable-JavaScript shell as blocked |
| LinkedIn public guest | 3 | query | Canada + US | target-enabled inside the globally disabled/uninitialized watch; public smoke passed; target baseline and operator review remain |
| Meta direct, Wellfound direct | 1 | direct-company compatibility mode | Canada | target-enabled by operator decision; paused baseline required before resume |

The shipped preset watch itself is disabled and uninitialized. Its target-enabled
sources are Google Careers, Shopify, Ashby `wealthsimple`, Ashby `plaid`, Canada
Job Bank, and LinkedIn public guest search. Target-enabled is inventory state,
not permission to poll or notify while the watch is paused. Google Jobs and all
legacy direct targets are enabled by explicit operator decision and remain gated
by a paused per-target baseline before notifications resume.
Google Careers and Canada Job Bank have 76-entry Canadian query matrices (19
terms × 4 locations); Google Jobs and LinkedIn have 95-entry Canada/US matrices
(19 × 5). Their rotating per-run request caps are 12, 12, 12, and 8.

## 8. Canonical episode algorithm

1. Normalize company and title using Unicode NFKC, case folding, whitespace and
   punctuation normalization.
2. Normalize all locations, remove duplicates, sort their canonical labels for
   identity, and retain stable source order for display.
3. Prefer a canonical external employer application URL (`applyUrl`,
   `jobUrlDirect`, or an equivalent verified external URL) with tracking removed.
4. Hash company + title + sorted locations + employer URL when the URL exists.
5. Otherwise hash company + title + locations + normalized publication date.
6. Otherwise create an episode anchored at the first observation, persist its
   `canonicalEpisodeStartedAt`, and reuse it for equivalent observations during
   the following 14 days. After that rolling window, a later observation may
   anchor a new episode; UTC calendar boundaries do not affect identity.
7. Persist the source observation fingerprint, canonical episode key, and
   fallback episode anchor. If the same stable source fingerprint begins a new
   fallback episode after 14 days, preserve the previous record and create an
   episode-scoped observation snapshot for the new episode.
8. Upsert the watch match by watch + canonical episode. Persist whether an
   unsent suppression came from baseline or eligibility. Baseline suppression
   is permanent; eligibility suppression may promote to pending after a richer
   eligible observation. Enqueue a delivery by watch + canonical episode +
   channel + destination. Notification type remains payload metadata and never
   changes delivery identity.

## 9. Error contract

| Code | Meaning and behavior |
| ---- | -------------------- |
| `SOURCE_HTTP_FAILURE` | Non-success response or transport exhaustion; target hard failure. |
| `SOURCE_BLOCKED` | CAPTCHA, consent/challenge page, access denial, or known block marker; target hard failure. |
| `SOURCE_MARKUP_CHANGED` | Required official-page structure is missing or malformed; target hard failure. |
| `SOURCE_SCHEMA_INVALID` | Embedded or JSON payload fails validation; target hard failure. |
| `SOURCE_EMPTY_VALID` | Valid source response parsed successfully with zero matching/listed jobs; success plus empty counter. |
| `WATCH_TARGET_UNKNOWN` | Requested initialize/preset target key is unknown; REST 400/CLI non-zero. |
| `WATCH_TARGET_DISABLED` | Targeted initialization requested a disabled target; REST 400/CLI non-zero. |
| `WATCH_MUST_BE_PAUSED` | Mutating preset application attempted on an enabled watch; REST/CLI conflict. |
| `GEOGRAPHY_UNKNOWN` | Location cannot be confidently classified; observation persists and immediate notification is suppressed. |

A run with at least one successful target and at least one failed target is
`partial`. A run with no successful targets is `failed`. Failed query requests
cannot be collapsed into a successful target merely because sibling requests
returned zero. Error messages are sanitized and never include secrets/cookies.

## 10. Non-functional requirements

| ID | Requirement | Target |
| -- | ----------- | ------ |
| NFR-1 | Scheduling | Tier 1 3 min; Tier 2 15 min; Tier 3 60 min by default. |
| NFR-2 | Query budget | Finite target default, validated positive integer, deterministic complete rotation. |
| NFR-3 | Source I/O | Shared `@ever-jobs/common` client, 3 s connect/12 s total defaults, bounded retry/backoff/circuit breaker. |
| NFR-4 | Concurrency | Existing bounded source execution; matrix requests count against limits. |
| NFR-5 | Result bounds | Each source enforces `maxResults`; detail requests are coarse-candidate bounded. |
| NFR-6 | Compatibility | All contract/schema changes optional or additive; legacy watches continue to run. |
| NFR-7 | Idempotency | At most one sent delivery per watch/canonical episode/channel/destination, regardless of notification-type changes. |
| NFR-8 | Observability | Per-target counters and Tier 1 degraded state survive restart and are Prometheus-visible. |
| NFR-9 | Security | No LinkedIn auth/cookies/challenge bypass; no secret-bearing logs or persisted headers. |
| NFR-10 | CI determinism | Sanitized fixtures only; no automated test requires a live source. |
| NFR-11 | Filtering determinism | Season, degree, source, and Tier 1 company decisions are pure local text/configuration checks with no additional I/O or dependency. |

## 11. Test plan

### 11.1 Contract and unit

- Validate nested search scopes, company names, target baselines, legacy target
  inheritance, public serialization, and Prisma/in-memory round trips.
- Verify full query matrices, per-target budgets, deterministic rotation across
  enough runs to cover every pair, deduplication, and exact forwarding of term,
  location, and country codes.
- Cover every Canadian province/territory, every US state/DC, country aliases,
  Toronto/GTA/Waterloo, Remote Canada, Remote US, North America, Remote Americas,
  exclusions, ambiguity, and multi-location delimiters.
- Cover internship/co-op evidence in title and structured type, description-only
  false positives, requested engineering families, and senior/experience gates.
- Cover Summer 2027 title/description spellings, missing/other seasons, PhD title
  spellings, explicit PhD enrollment language, and harmless PhD colleague text.
- Cover non-Tier-1 LinkedIn score capping below the configured urgent threshold,
  Tier 1 LinkedIn company exemption, direct-source exemption, and explanation
  text without changing score components.
- Cover Google Careers observations whose stable posting ID/result URL match but
  whose application `q` and `location` parameters differ; assert stable source
  fingerprint, canonical episode, persisted match, and delivery identity while
  retaining distinct identities for distinct Google posting IDs.
- Cover Tier 1 Canadian acceptance/US rejection, Tier 2/3 CA/US acceptance,
  regional-remote rules, unknown suppression, and preference-only location score.
- Cover canonical identity with employer URL, publication-date fallback,
  first-observation-anchored rolling 14-day fallback, source-order-insensitive
  locations, richer observation merge, and per-destination notification
  idempotency across notification-type changes.
- Cover target success/failure/empty counters, failure reset, and degradation on
  exactly three consecutive Tier 1 hard failures; verify success, valid empty,
  and partial outcomes all reset the streak.

### 11.2 Source plugins

- Sanitized fixtures for Google Careers, Shopify, Ashby/Wealthsimple, Google Jobs,
  and LinkedIn public guest search.
- Listing pagination, detail mapping, stable IDs, genuine dates, multi-location,
  remote labels, external application URLs, missing optional values, max results,
  malformed payloads, unexpected markup, blocking, HTTP failures, and hard-error
  propagation.
- Tier 1 audit fixtures show Canada-wide request or post-filter behavior for every
  enabled source. Unproven sources assert disabled preset state.

### 11.3 Integration and end-to-end

- The same job from a direct source, Google Jobs, and LinkedIn persists three
  observations, one canonical match, and one notification per destination.
- A later richer source updates the match without another delivery.
- One failed source plus successful siblings produces a partial run and retains
  all successful jobs; all failures produce a failed run.
- Per-target baseline initialization creates no historical notifications and
  only marks successful requested targets initialized.
- REST/CLI initialize, scheduler, digest, health endpoint, run summaries,
  Prometheus metrics, and legacy watch behavior stay compatible.
- Preset dry-run is side-effect free; apply rejects active watches, preserves
  operator fields/history, and identifies only new/materially changed baselines.

### 11.4 Required geography scenarios

- A Canadian Google or Microsoft internship through a Tier 1 direct target
  qualifies; a US result from the same target is outside scope.
- A US internship through Tier 2 Google Jobs qualifies.
- A US internship through Tier 3 LinkedIn qualifies.
- Canadian internships in Vancouver, Calgary, Montréal, Ottawa, Toronto/GTA, and
  Waterloo qualify.

### 11.5 Operational validation

- Run docs lint, Prisma validation/generation, focused models/plugin/watcher/API/
  CLI suites, source fixture suites, relevant TypeScript builds, repository lint
  and build, and a final diff/status review.
- Smoke-test new/repaired sources while their watch targets are disabled. Inspect
  normalized locations/application URLs and record result/failure classification.
- Baseline changed targets, then observe two successful Tier 1 cycles before
  enabling notifications.
- Compare operator-supplied LinkedIn alert URLs against observations; classify
  every gap as personalization, role/geography ineligibility, or recorded source
  failure—never silent success.

Recorded integration evidence on 2026-07-19:

- Six deterministic source suites passed (59 tests total).
- Google Careers returned two Canadian internship results with stable IDs,
  public Google job/apply URLs, and Waterloo/Montréal/Toronto location arrays;
  the current official detail omitted publication date, so it remains `null`.
- Shopify returned a marker-validated valid empty official board.
- Wealthsimple's public Ashby board returned 37 roles and mapped the configured
  capped sample.
- LinkedIn public guest listing/detail smoke passed without authentication.
- Microsoft timed out and Google Jobs returned the classified enable-JavaScript
  shell; both remain target-disabled.
- The global watch remains disabled and uninitialized. Operators must targeted-
  baseline every target-enabled source and complete two observation cycles
  without notifications before resuming the watch.

## 12. Decisions

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-19 | Reserve Spec range `6000–6999` for `RadmehrVafadar/ever-jobs` and use Spec 6000. | First non-overlapping fork band; allocator enforces repository-specific numbering. |
| 2026-07-19 | Keep Tier 1 Canada-exclusive and allow Canada/US only in Tiers 2/3. | Corrected operator geography policy. |
| 2026-07-19 | Require title or structured employment-type internship evidence. | Prevents full-time roles from qualifying due to incidental description text. |
| 2026-07-19 | Preserve all observations but notify by canonical episode. | Retains provenance while eliminating cross-source notification duplicates. |
| 2026-07-19 | Exclude notification type from delivery identity. | A standard/urgent/digest band change enriches state but cannot resend the same episode to the same destination. |
| 2026-07-19 | Anchor URL/date-less fallback episodes at first observation for a rolling 14-day window. | Avoids artificial UTC calendar-boundary splits while permitting a genuinely later repost. |
| 2026-07-19 | Reuse Ashby for Wealthsimple. | Maintained official public-board integration; avoids duplicate plugin logic. |
| 2026-07-19 | Keep LinkedIn unauthenticated and best-effort. | Respects public guest surface, security constraints, and personalized-alert limitations. |
| 2026-07-19 | Make preset apply dry-run by default and require a paused watch. | Prevents accidental source churn or historical notification floods. |
| 2026-07-20 | Require Summer 2027 evidence and contextually suppress PhD/doctoral internships. | Focuses the operator's current internship cycle without rejecting incidental research-team degree mentions. |
| 2026-07-20 | Derive the LinkedIn urgent-score allowlist from configured Tier 1 target company names and cap all other LinkedIn totals below `urgentScore`. | Source tiers are authoritative; unrelated aggregator discoveries remain visible without appearing as maximum-priority alerts. |

## 13. References

- [Spec 016 — Real-time Job Watcher](../016-realtime-job-watcher/spec.md)
- [Human-readable mirror](../../../docs/specs/6000-prestige-internship-coverage-expansion.md)
- [Google Careers](https://www.google.com/about/careers/applications/jobs/results/)
- [Shopify Careers](https://www.shopify.com/careers?ashby_jid=e2023a34-4496-41d1-a93d-9a6fb095573b)
- [Shopify internship FAQ](https://internships.shopify.com/a/faq/)
- [Wealthsimple Ashby board](https://jobs.ashbyhq.com/wealthsimple)
- [LinkedIn job-alert documentation](https://www.linkedin.com/help/linkedin/answer/a506444)
