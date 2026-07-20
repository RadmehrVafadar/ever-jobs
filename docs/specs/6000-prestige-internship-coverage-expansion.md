# Prestige Internship Coverage Expansion (Spec 6000)

> **Status:** In progress  
> **Canonical contracts:**
> [Spec](../../.specify/specs/6000-prestige-internship-coverage-expansion/spec.md),
> [plan](../../.specify/specs/6000-prestige-internship-coverage-expansion/plan.md),
> [task ledger](../../.specify/specs/6000-prestige-internship-coverage-expansion/tasks.md)  
> **Created:** 2026-07-19
> **Last updated:** 2026-07-20

## Purpose

This expansion turns the real-time watcher from a Toronto-biased collection of
mostly direct sources into a target-aware, Canada-wide internship watcher with
Canada/US redundant discovery. Google Careers, Shopify, and Wealthsimple are the
Tier 1 coverage targets; Google Jobs and public LinkedIn are Tier 2/3 redundancy
targets. Activation remains evidence-gated, so an implemented source can still
be disabled. Equivalent observations retain their provenance but create one
canonical match and one notification per destination.

The safety boundary stays strict: only software/engineering internships and
co-ops qualify. New-grad and experienced roles are excluded. Tier 1 is Canada
only; Tiers 2 and 3 allow Canada and the United States. A source that is blocked,
malformed, or unexpectedly shaped is a failure, never a successful empty run.
The production policy additionally requires Summer 2027 evidence and suppresses
PhD/doctoral internships.

## Geography policy

| Tier | Default cadence | Eligibility | Default query locations |
| ---- | --------------- | ----------- | ----------------------- |
| 1 | 3 minutes | At least one Canadian location | Canada; Toronto, Ontario; Greater Toronto Area; Waterloo, Ontario |
| 2 | 15 minutes | At least one Canadian or US location | Tier 1 locations plus United States |
| 3 | 60 minutes | At least one Canadian or US location | Tier 1 locations plus United States |

`Remote Canada` qualifies every tier. `Remote US` qualifies Tiers 2/3 only.
`North America` and `Remote Americas` qualify Tiers 2/3 unless the posting
explicitly excludes both Canada and the US. Unknown geography is persisted with
a suppression reason and cannot produce an immediate notification.

Toronto, the GTA, and Waterloo remain positive ranking signals. Vancouver,
Calgary, Montréal, Ottawa, and every other confidently Canadian location remain
eligible and cannot fail solely because they have a lower location preference.

## Source policy

| Source/target | Tier | Expected mode | Shipped preset state and rollout rule |
| ------------- | ---- | ------------- | ------------------------------------- |
| Google Careers | 1 | Explicit query | **Target-enabled inside the globally disabled/uninitialized watch.** Deterministic validation passed; live smoke returned two Canadian roles with stable IDs, public URLs, and location arrays. Target baseline and two observation cycles remain. |
| Shopify | 1 | Board | **Target-enabled inside the globally disabled/uninitialized watch.** Deterministic validation passed; the official live board returned a marker-validated valid empty result. Target baseline and two observation cycles remain. |
| Ashby `wealthsimple` | 1 | Board | **Enabled target** inside the disabled preset watch; `companyName: Wealthsimple`; Canada post-filter; target baseline required. |
| Ashby `plaid` | 1 | Board | **Enabled target** inside the disabled preset watch; Canada post-filter and target baseline required. |
| Amazon, Microsoft, Apple, Nvidia, Stripe, OpenAI, Datadog, DoorDash, Coinbase, Figma, Vercel, Meta, Wellfound | 1 | Explicit/compatible direct-company mode | **Target-disabled.** Each requires fixture-backed Canada-wide evidence plus its own live/baseline gate; Microsoft live smoke timed out. |
| Canada Job Bank | 2 | Query | **Enabled target** inside the disabled preset watch; 12 of 76 Canadian matrix entries per run. |
| Google Jobs | 2 | Query | **Disabled.** Fixture and hard-failure behavior pass, but the live endpoint returned an enable-JavaScript shell. |
| LinkedIn public guest search | 3 | Query | **Target-enabled inside the globally disabled/uninitialized watch.** Canada/US newest-first 72-hour listing/detail smoke passed; no login/cookies/challenge bypass; baseline and operator review remain. |

The final target-enabled inventory is `google_careers`, `shopify`,
`ashby:wealthsimple`, `ashby:plaid`, `canadajobbank`, and `linkedin`. This does
not enable polling or notifications while the watch is paused. Google Jobs and
all unproven legacy direct targets remain target-disabled.

The preset defines 19 Summer 2027 search terms. Google Careers and Canada Job Bank combine
them with four Canadian locations (76 entries each); Google Jobs and LinkedIn
combine them with five Canada/US locations (95 entries each). Rotating request
caps are 12, 12, 12, and 8 per run respectively.

## Contracts

Source metadata gains optional `watchMode: "board" | "query"`. Complete company
and ATS boards declare `board`; search surfaces declare `query`. Google Careers
and Microsoft declare their actual behavior instead of inheriting a planner
guess.

Each watch target gains optional branded ATS and search context:

```ts
interface WatchSearchScope {
  countryCodes: string[];
  locations: string[];
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}

interface WatchSourceTarget {
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

Missing target fields inherit existing watch-level fields, preserving legacy
watch JSON and persisted documents.

`JobPostDto` gains optional `locations: LocationDto[]`. Existing `location`
remains the primary compatibility location. Sources retain every location;
normalization removes duplicates while preserving source order for display.

Score/match explanations add the source-target key, matched country, location
confidence, and explicit geography decision. This context travels through the
planner, request executor, eligibility/ranking, persistence, run summary, and
notification path.

## Query planning

Query targets build the complete unique search-term × location matrix. A
per-target `maxRequestsPerRun` limits each poll. When the matrix is larger than
the budget, a stable rotation chooses a different contiguous/cyclic slice on
later executions until every entry has been covered; the planner never selects
only the first country or first location indefinitely.

The v2 defaults are 12 requests per run for Google Careers, 12 for Google Jobs,
and 8 for LinkedIn. LinkedIn searches newest-first over 72 hours by default
(bounded to at most 168 hours) and fetches detail pages only for coarse software
internship/co-op title candidates.

The default term families cover:

- software engineering/development internships and co-ops;
- backend, frontend, full-stack, mobile, and developer experience;
- platform, cloud, infrastructure, SRE/DevOps, and security;
- data engineering and ML/AI engineering.

## Role eligibility

A posting needs internship/co-op evidence in the title or structured employment
type. A normal full-time title does not qualify merely because its description
mentions interns, students, universities, campus recruiting, or early careers.
Senior, staff, principal, lead, manager, director, architect, and experienced
full-time positions remain excluded.

The v2 watch requires Summer 2027 evidence in the posting title or description.
Accepted forms include `Summer 2027`, `Summer of 2027`, `Summer '27`,
`Summer 27`, and `2027 Summer`. Other and seasonless internships remain persisted
with `not-summer-2027` suppression. Titles containing PhD/Ph.D./doctoral/
doctorate terms suppress directly. Description degree terms suppress only when
connected to explicit student, candidate, enrollment, pursuit, applicant,
internship, or program eligibility language.

For LinkedIn results, the urgent-score allowlist is derived from company names on
configured Tier 1 source targets, not from the broader prestige ranking list.
Non-Tier-1 LinkedIn totals are capped at `urgentScore - 1`; they remain eligible
for standard/digest delivery. Tier 1 LinkedIn employers and non-LinkedIn source
observations retain the normal additive total.

Geography is a hard eligibility decision. Location preference is a separate
ranking component. Unknown geography is visible and suppressed rather than
discarded or treated as successful eligibility.

## Canonical deduplication

Every source observation remains durable. A separate canonical episode identity
uses normalized company, title, sorted normalized locations, and a canonical
external employer application URL. If no employer URL exists, publication date
is included. If neither exists, the first observation anchors a persisted
rolling episode reused for 14 days. A later observation after that window can
start a new episode; a UTC calendar boundary cannot split the existing one. If
the stable source fingerprint is reused for that repost, the old observation is
preserved and an episode-scoped observation snapshot is stored for the new
episode.

Matches upsert by watch + canonical episode. Delivery idempotency uses watch +
canonical episode + channel/destination. Notification type is deliberately not
part of identity, so a standard/urgent/digest band change cannot resend. A later
richer Google Jobs, LinkedIn, or company observation may update the shared
match. An already-sent or baseline-suppressed episode cannot send again; an
eligibility-suppressed episode with no delivery may promote to pending and send
exactly once after richer evidence makes it eligible.

## Target baseline and health

Target baseline time is independent. The existing REST initialize action accepts
optional target keys, and the CLI supports repeatable `--target` values. A target
is initialized only after its own successful baseline; failed siblings do not
erase successful baselines or make the overall failure look empty.

Durable target health includes success, hard-failure, valid-empty, and partial
counts; consecutive hard failures; and attempt, success, last-non-empty, and
degradation timestamps. Three consecutive Tier 1 hard failures mark coverage
degraded. Any non-hard outcome (`success`, valid `empty`, or `partial`) resets
the streak. Worker/API health, run summaries, watch metrics, and Prometheus
output expose the state. Operational alerts cover degradation and unexpected
count collapse.

The persisted health map records success, hard-failure, empty, and partial
counts plus the streak/timestamps per target key. Run target results expose
`succeeded|partial|failed` status, `success|empty|partial|hard_failure` outcome,
request/job/duration counts, flags, streak, and success/non-empty timestamps.
Worker health uses `coverage` (including degraded target keys); API health uses
`watcherCoverage`.

## Preset and rollout

`prestige-internships-v2` is versioned, disabled, and uninitialized for new
installs. A new Canada/USA example accompanies it. The older Toronto example
stays in the repo with a deprecation notice.

`watch preset apply` is a dry-run by default. Applying requires an explicit flag
and a paused watch. The merge preserves destinations, thresholds, history, and
unrelated operator edits, and identifies only new/materially changed targets for
baseline. Rollback disables individual targets; additive contracts and schema
remain in place.

The production rollout sequence is:

1. Deploy the additive migration and code while the watch remains globally
   disabled and uninitialized.
2. Preview the v2 preset against a paused watch.
3. Apply explicitly and targeted-baseline only added/materially changed
   target-enabled sources.
4. Inspect normalized locations, employer application URLs, and target health.
5. Run two no-notification observation cycles, including both Tier 1 cycles.
6. Resume and enable notifications only after operator review.

For an existing v2 watch receiving the 2026-07-20 refinement, preset preview/apply
marks the changed query scopes as material. Baseline every enabled target key
reported by the apply result before resuming, preventing the narrowed search
matrix from surfacing historical postings.

Six deterministic source suites passed with 59 tests. Disabled live evidence
returned two Canadian Google Careers roles, a marker-validated valid empty
Shopify board, 37 Wealthsimple Ashby roles with a capped mapped sample, and a
successful unauthenticated LinkedIn listing/detail result. Microsoft timed out;
Google Jobs returned the classified enable-JavaScript shell. Those two and every
other unproven legacy direct source remain target-disabled. Target baselines and
the two observation cycles are still pending; registration, tests, or a smoke
alone do not enable notifications.

## Acceptance summary

- Canadian Google/Microsoft internships qualify through Tier 1; US results from
  those Tier 1 targets do not.
- US internships through Tier 2 Google Jobs and Tier 3 LinkedIn qualify.
- Vancouver, Calgary, Montréal, Ottawa, Toronto/GTA, and Waterloo internships
  qualify when role evidence is valid.
- Direct, Google Jobs, and LinkedIn observations of one posting create one
  notification.
- A source hard failure yields a partial/failed run, never successful zero.
- Per-target baseline creates no historical alerts.
- Only Summer 2027 roles notify; PhD/doctoral internships suppress; non-Tier-1
  LinkedIn results remain below the urgent band.
- Six source fixture suites (59 tests) cover the repaired sources; CI has no
  live-site dependency.
