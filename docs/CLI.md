# rad.ar CLI

Command-line interface for searching and comparing job postings from 65+ job boards.

Built with [nest-commander](https://docs.nestjs.com/recipes/nest-commander) on the rad.ar scraping engine.

## Installation

```bash
# From the monorepo root
yarn install
yarn build cli
```

## Commands

### `search` — Search Job Postings

Search one or more job boards for matching positions.

```bash
ever-jobs search [options]
```

#### Basic Examples

```bash
# Search LinkedIn for "React developer"
ever-jobs search -s linkedin -q "React developer"

# Multi-site search with location filter
ever-jobs search -s linkedin -s indeed -q "DevOps" -l "New York"

# Remote-only, last 24 hours, top 20 results
ever-jobs search -s linkedin -q "Python" -r --hours-old 24 -n 20

# Output as CSV file
ever-jobs search -s indeed -q "Data Scientist" -f csv -o results.csv

# Table view for quick scanning
ever-jobs search -s glassdoor -q "Product Manager" -f table

# ATS board scraping (company-specific)
ever-jobs search -s ashby --company-slug stripe -n 50
ever-jobs search -s greenhouse --company-slug github -n 50
ever-jobs search -s workday --company-slug "tesla:5:Tesla" -n 30
```

#### LLM / Programmatic Usage (stdin)

The CLI accepts JSON input via stdin for integration with LLMs and scripts:

```bash
echo '{"siteType":["linkedin","indeed"],"searchTerm":"ML Engineer","isRemote":true}' | ever-jobs search --stdin

# Pipe from a file
cat search-params.json | ever-jobs search --stdin -f csv -o output.csv
```

#### BD Intelligence Mode

Analyze hiring patterns across companies instead of listing individual jobs:

```bash
ever-jobs search -s linkedin -q "Engineering" --bd
```

#### Analysis Mode

Append salary, remote %, and company analytics after results:

```bash
ever-jobs search -s linkedin -s indeed -q "Backend" --analyze
```

#### Full Options Reference

| Flag                           | Short | Argument     | Default  | Description                                      |
| ------------------------------ | ----- | ------------ | -------- | ------------------------------------------------ |
| `--site`                       | `-s`  | `[sites...]` | all      | Sites to search (see Sources below)              |
| `--search-term`                | `-q`  | `<term>`     | —        | Job search keywords                              |
| `--google-search-term`         | —     | `<term>`     | —        | Google-specific search query override            |
| `--location`                   | `-l`  | `<location>` | —        | Location to search near                          |
| `--distance`                   | `-d`  | `<miles>`    | 50       | Search radius in miles                           |
| `--remote`                     | `-r`  | —            | false    | Filter for remote jobs only                      |
| `--job-type`                   | —     | `<type>`     | —        | `fulltime`, `parttime`, `internship`, `contract` |
| `--easy-apply`                 | —     | —            | false    | Filter for easy-apply / hosted jobs              |
| `--results`                    | `-n`  | `<count>`    | 15       | Results wanted per site                          |
| `--offset`                     | —     | `<n>`        | 0        | Skip first N results                             |
| `--hours-old`                  | —     | `<hours>`    | —        | Max job age in hours                             |
| `--country`                    | `-c`  | `<code>`     | USA      | Country for Indeed/Glassdoor domain              |
| `--description-format`         | —     | `<fmt>`      | markdown | `markdown`, `html`, `plain`                      |
| `--linkedin-fetch-description` | —     | —            | false    | Fetch full LinkedIn descriptions (slower)        |
| `--linkedin-company-ids`       | —     | `[ids...]`   | —        | Filter LinkedIn by company IDs                   |
| `--enforce-annual-salary`      | —     | —            | false    | Convert all wages to annual equivalent           |
| `--timeout`                    | —     | `<seconds>`  | 60       | Request timeout per source                       |
| `--proxy`                      | `-p`  | `[urls...]`  | —        | Proxy URLs for rotation                          |
| `--ca-cert`                    | —     | `<path>`     | —        | CA certificate path for proxies                  |
| `--user-agent`                 | —     | `<ua>`       | —        | Custom User-Agent string                         |
| `--rate-delay-min`             | —     | `<seconds>`  | —        | Minimum delay between requests                   |
| `--rate-delay-max`             | —     | `<seconds>`  | —        | Maximum delay between requests                   |
| `--format`                     | `-f`  | `<format>`   | json     | `json`, `csv`, `table`, `summary`                |
| `--output`                     | `-o`  | `<file>`     | stdout   | Write output to file                             |
| `--verbose`                    | `-v`  | —            | false    | Enable verbose debug output                      |
| `--no-description`             | —     | —            | false    | Omit descriptions (reduces size for LLMs)        |
| `--analyze`                    | —     | —            | false    | Append analytics after results                   |
| `--bd`                         | —     | —            | false    | BD intelligence mode (company analysis)          |
| `--stdin`                      | —     | —            | false    | Read JSON input from stdin                       |
| `--company-slug`               | —     | `<slug>`     | —        | Company slug for ATS board scraping              |
| `--upwork-auth-json`           | —     | `<json>`     | —        | Upwork auth as JSON string                       |

---

### `compare` — Cross-Board Comparison

Search all 65+ boards individually and compare results side-by-side.

```bash
ever-jobs compare [options]
```

#### Examples

```bash
# Compare "React developer" across all sites
ever-jobs compare -q "React developer"

# Compare with location filter, save to file
ever-jobs compare -q "DevOps" -l "San Francisco" -o comparison.json

# Remote jobs only, last 48 hours
ever-jobs compare -q "ML Engineer" -r --hours-old 48
```

#### Output

The compare command outputs:

1. **stderr**: A table comparing each site (total jobs, with salary, remote, unique companies)
2. **stdout**: Full JSON with site comparison data and aggregated summary

#### Options

| Flag               | Short | Argument     | Default           | Description          |
| ------------------ | ----- | ------------ | ----------------- | -------------------- |
| `--search-term`    | `-q`  | `<term>`     | software engineer | Search keywords      |
| `--location`       | `-l`  | `<location>` | —                 | Location filter      |
| `--results`        | `-n`  | `<count>`    | 15                | Results per site     |
| `--country`        | `-c`  | `<code>`     | USA               | Country domain       |
| `--hours-old`      | —     | `<hours>`    | —                 | Max job age          |
| `--remote`         | `-r`  | —            | false             | Remote only          |
| `--job-type`       | —     | `<type>`     | —                 | Job type filter      |
| `--rate-delay-min` | —     | `<seconds>`  | —                 | Min request delay    |
| `--rate-delay-max` | —     | `<seconds>`  | —                 | Max request delay    |
| `--output`         | `-o`  | `<file>`     | stdout            | Write output to file |
| `--verbose`        | `-v`  | —            | false             | Verbose output       |

---

### `watch` — Manage Persistent Watches

The watcher CLI uses the same PostgreSQL repositories and validation as the API,
with its scheduler disabled inside the administrative process.

```bash
npm run cli -- watch <action> [arguments] [options]
```

Core actions are:

| Action | Purpose |
| ------ | ------- |
| `create --config <file>` | Create a validated watch from JSON |
| `update <watch-id> --config <file>` | Apply a validated watch patch |
| `list`, `show <watch-id>`, `delete <watch-id>` | Inspect or remove watches |
| `run <watch-id>` | Run safely: baseline if uninitialized, recent-only otherwise |
| `initialize <watch-id>` | Run a no-notification baseline for all enabled targets |
| `initialize <watch-id> --target <key>` | Baseline only selected target keys; repeat `--target` as needed |
| `pause <watch-id>`, `resume <watch-id>` | Control future scheduling |
| `runs`, `matches`, `metrics`, `coverage`, `observed-jobs`, `deliveries` | Read durable history and operational state |
| `match-status <match-id> <status>` | Update application workflow status |
| `notifications-test <watch-id>` | Test Discord configuration without creating a fake match |

#### Targeted initialization

Target keys are stable planner keys: `<site>` for a singleton source and
`<site>:<companySlug>` for a generic ATS board. Use the actual `Site` value, such
as `google_careers` (underscore), not a display-name slug. The current v2 preset
target-enables `google_careers` inside the globally disabled/uninitialized watch,
so it is a valid targeted-baseline key but cannot poll or notify while paused.

```bash
npm run cli -- watch initialize <watch-id> \
  --target uber \
  --target notion \
  --target ramp \
  --target netflix \
  --target ibm \
  --json
```

`--target` is repeatable. Omit it to initialize every enabled target. Unknown,
disabled, or duplicate keys produce a non-zero validated error. A target receives
its baseline timestamp only after its own successful baseline; a failed sibling
does not erase successful target state.

#### Inspect company coverage

```bash
npm run cli -- watch coverage --id <watch-id>
npm run cli -- watch coverage --id <watch-id> --json
```

The report contains summary counts for configured, active, disabled, uncovered,
initialized, and degraded companies, plus one row per configured company. Rows
include matching target keys, initialization state, last attempt/success/
non-empty timestamps, consecutive hard failures, and degradation state.

Coverage is a normalized exact company-name match against
`sourceTargets[].companyName`. Generic discovery boards do not count. The
original Canadian Tech Internships preset reports 21 first-class covered
companies and leaves RBC, TD, Scotiabank, BMO, and CIBC visibly uncovered. The
separate Canadian Tech + Adjacent Internships preset requires first-class
coverage for all 41 configured employer groups, including the Big Five banks
and 15 additional consulting, retail, insurance, and telecom employers.

The 2026-08-12 opt-in live gate completed all 22 official cohort endpoints with
18 parsed-job passes, four authoritative empty boards, no failures, and no
invalid direct application URLs. Endpoint success does not imply that every
employer currently has a GTA Summer 2027 role. Repeat
`npm run smoke:canadian-employers` before applying and baselining the expanded
preset.

#### Apply a Canadian internship preset

Preset application is a dry run by default:

```bash
npm run cli -- watch preset apply canadian-tech-internships --watch <watch-id>
npm run cli -- watch preset apply canadian-tech-adjacent-internships --watch <watch-id>
```

The JSON diff classifies targets as unchanged, added, materially changed,
disabled, or operator-only. It makes no state change. Review the diff, pause the
watch, and mutate only with the explicit flag:

```bash
npm run cli -- watch pause <watch-id> --json
npm run cli -- watch preset apply canadian-tech-internships \
  --watch <watch-id> \
  --apply

# Or apply the separate 41-employer, nine-role-family preset.
npm run cli -- watch preset apply canadian-tech-adjacent-internships \
  --watch <watch-id> \
  --apply
```

Mutation rejects an enabled watch. It preserves notification destinations,
thresholds, history, and unrelated operator edits. Target `resultsWanted`,
`mode`, `companyUrl`, and search scope are material configuration. `mode` is
`board`, `board-search`, or `query`; `companyUrl` carries an official vanity ATS
listing URL into the source request without changing the stable target key.
`resultsWanted` accepts integers from 1 through 1000, persists in the existing
target JSON, and defaults to existing executor behavior when omitted. Baseline only target keys
reported as added or materially changed, inspect their locations/application
URLs and health, then repeat targeted initialization for two additional
no-notification observation cycles before resume.

The preset uses `CA` for every tier and limits its location matrix to Toronto,
the GTA, Mississauga, Brampton, Vaughan, Richmond Hill, Markham, Oakville,
Burlington, Pickering, and Ajax. Its 19 search terms form 209-entry matrices.
Every target uses `strictLocations: true`, so postings outside that municipality
list are ineligible even when they are elsewhere in Canada. Per-run request
budgets remain 1, 12, 12, and 8 respectively, and LinkedIn uses
a newest-first 72-hour recent window. The retained enabled 10-minute `uber`,
`notion`, `ramp`, `netflix`, and `ibm` board targets each use
`resultsWanted: 500`. The
target-enabled set inside the globally disabled/uninitialized watch also
includes `google_careers`, `shopify`, `ashby:wealthsimple`, `ashby:plaid`, all
13 legacy direct-company targets, `canadajobbank`, and `linkedin`; only Google
Jobs remains target-disabled. Applying the template to an older Canada/USA
watch replaces its locations and country codes, so every target whose scope
changes requires a fresh no-notification baseline before resume.

---

## Local Operator GUI (Spec 6002)

Spec 6002 adds a browser operator layer over the same API, watcher repositories,
jobs service, analytics service, and preset service used by the CLI. It does not
replace the CLI or create a second watch store.

Start the development stack from the repository root:

```bash
npm run gui:dev
```

Start the built local stack with:

```bash
npm run gui
```

Both commands run checked-in migrations, start the API on
`127.0.0.1:3001`, watcher health service on `127.0.0.1:3002`, and GUI on
`127.0.0.1:3000`, then print:

```text
http://127.0.0.1:3000
```

The launcher owns the three local child processes. The browser itself never
starts, stops, or restarts a process. A GUI control labeled Start watcher or
Resume updates `enabled=true` for the selected persisted watch; it does not
start the worker executable. API, worker, scheduler, and per-watch state remain
separately visible on Overview.

### API-key session

Read-only health can render without mutation authority. To create or change
watches, destinations, matches, or other protected resources, enter the
existing admin API key in Settings. The GUI stores it in browser
`sessionStorage` only. Closing the tab session clears it. The key is not written
to watch JSON, `.env.local`, PostgreSQL, local storage, IndexedDB, cookies,
query strings, or downloaded files.

### CLI-to-GUI mapping

| CLI capability | GUI surface | Notes |
| --- | --- | --- |
| `search` | Search | Structured search controls, paginated results, job details, JSON/CSV download. |
| `search --analyze` | Analysis | Summary, source comparison, and company intelligence use the API analytics service. |
| `search --bd` | Analysis / companies | Company intelligence is rendered in the browser. |
| `compare` | Compare | Selected or all sources run with bounded concurrency; successful rows remain when another source fails. |
| `watch create --config` | Watches / New watch | Create with forms, import API-compatible JSON, or start from the safe default preset. |
| `watch update --config` | Watch editor / Apply | Validate, preview a field diff, and apply with optimistic concurrency. |
| `watch list`, `show`, `delete` | Watches | Delete requires confirmation. |
| `watch preset apply` | Watch editor / Presets | Preview is non-mutating; Apply delegates to the server preset service. |
| `watch run` | Watch detail / Run now | Uninitialized watches retain baseline safety; initialized watches use recent-only behavior. |
| `watch initialize [--target]` | Watch detail / Initialize | Select all or specific enabled target keys for a no-notification baseline. |
| `watch pause`, `resume` | Watch detail | Resume is the GUI's Start watcher operation. |
| `watch runs`, `metrics`, `coverage` | Overview and watch detail | Includes target outcomes, coverage, degradation, and next-run state. |
| `watch matches`, `match-status` | Matches | Filter details and update the existing workflow status values. |
| `watch observed-jobs` | Jobs | Filter and inspect durable observations. |
| `watch deliveries` | Notifications / Deliveries | Filter provider, destination, type, status, date, watch, and match. |
| `watch notifications-test` | Notifications / Test | Sends a non-persistent configuration test without a fake job or delivery row. |
| `--stdin` | JSON import | Pasted or selected JSON becomes a validated browser draft. |
| `--output`, stdout formats | Download | The browser downloads sanitized JSON or CSV; it does not accept an arbitrary server filesystem path. |
| `--verbose` and stderr diagnostics | CLI only | Runtime logs remain in the process terminal; the GUI shows sanitized operational errors. |

### Watch Apply safety

The GUI does not send every keystroke to PostgreSQL. It holds an unsaved draft,
validates it, and displays a field-level diff. Apply sends the last observed
`updatedAt`; HTTP 409 means a different client changed the watch and no part of
the stale patch was written.

Name, description, schedule, interval, timezone, and notification-only changes
apply without forcing a pause. Source, source-target, company, location,
country, term/filter, eligibility, score-threshold, or weight changes atomically
pause the watch and mark all enabled target keys for baseline. Initialize those
targets, inspect their baseline jobs and target health, and invoke Resume
explicitly. Apply never resumes a behavior-changed watch.

Advanced JSON represents the same API-compatible watch configuration accepted
by the CLI. Exports exclude runtime IDs/timestamps, initialization and health
state, histories, leases, API keys, and notification secrets.

### Conditional Discord routes

Watch JSON can opt into `notificationRoutes` while retaining the legacy
`notificationChannels` field for compatibility:

```json
{
  "notificationRoutes": [
    {
      "id": "tier-1-urgent",
      "name": "Tier 1 urgent",
      "enabled": true,
      "provider": "discord",
      "destinationRef": "tier-one",
      "conditions": {
        "sourceTiers": [1],
        "notificationTypes": ["urgent"]
      }
    },
    {
      "id": "tier-2-score-band",
      "name": "Tier 2 score 60-79",
      "enabled": true,
      "provider": "discord",
      "destinationRef": "tier-two",
      "conditions": {
        "sourceTiers": [2],
        "minimumScore": 60,
        "maximumScore": 79
      }
    }
  ]
}
```

Different condition fields are ANDed, array entries are ORed, and score bounds
are inclusive. An enabled conditionless route is a catch-all. Tier conditions
use the match's source target and do not match an unknown tier. Every distinct
matching provider/destination receives a delivery, but overlapping rules for the
same pair enqueue once. A non-empty route array is authoritative, even when
every route is disabled; existing legacy destinations are used only when the
route array is absent or empty.

Delivery identity remains watch + canonical episode + provider/destination, so
route edits and notification type changes do not resend an existing episode.
When configured routes select no destination, the match is terminally
suppressed with reason `routing`; later route edits do not replay it.

### Named destination secrets

The GUI stores only non-secret aliases in watch JSON. `default` resolves the
existing `DISCORD_WEBHOOK_URL`; `tier-one` resolves
`DISCORD_WEBHOOK_TIER_ONE`. Custom aliases are normalized to bounded lowercase
slugs and GUI-managed webhook values are stored only in the ignored
`.env.local`. Process environment has precedence and appears read-only.

Destination list/create-or-rotate/delete/test operations are authenticated and
return only masked metadata. A referenced alias cannot be deleted. Webhook URLs
are validated as approved HTTPS Discord webhooks and never returned, logged,
stored in PostgreSQL, included in exported watch JSON, or rendered in delivery
history.

The complete operational workflow is in the
[local watcher runbook](runbooks/watcher-local.md), and the authoritative
contract is [Spec 6002](../.specify/specs/6002-local-operator-gui/spec.md).

---

## Output Formats

### JSON (default)

```json
[
  {
    "id": "abc123",
    "site": "linkedin",
    "title": "Senior React Developer",
    "companyName": "Acme Corp",
    "location": { "city": "San Francisco", "state": "CA", "country": "US" },
    "jobUrl": "https://linkedin.com/jobs/...",
    "datePosted": "2025-02-15",
    "isRemote": true,
    "compensation": {
      "minAmount": 150000,
      "maxAmount": 200000,
      "currency": "USD",
      "interval": "yearly"
    }
  }
]
```

### CSV

Flat columns: `id, site, title, companyName, location, jobUrl, datePosted, jobType, isRemote, minAmount, maxAmount, currency, interval, description`

### Table

```
Site         │ Title                                   │ Company                  │ Location                 │ Posted       │ Remote
─────────────┼─────────────────────────────────────────┼──────────────────────────┼──────────────────────────┼──────────────┼───────
linkedin     │ Senior React Developer                  │ Acme Corp                │ San Francisco, CA        │ 2025-02-15   │ Yes
```

### Summary

```
=== Job Search Summary ===
Total jobs found: 45
Remote positions: 12
With salary data: 28

--- By Source ---
  linkedin: 15
  indeed: 18
  glassdoor: 12

--- By Job Type ---
  fulltime: 30
  contract: 15
```

---

## Supported Sites

### General Job Boards (34)

linkedin, indeed, glassdoor, zip_recruiter, google, bayt, naukri, bdjobs, internshala, exa, upwork, and more.

### ATS Boards (13)

ashby, greenhouse, lever, workable, smartrecruiters, rippling, workday, and more.

Requires `--company-slug` to specify which company board to scrape.

### Regional (8)

Country-specific boards for specialized regional searches.

### Company-Specific (10)

Direct company career page scrapers (Amazon, Apple, Microsoft, Nvidia, etc.).

> See the full source inventory in the [main README](../README.md).

---

## Environment Variables

| Variable                       | Description                                            |
| ------------------------------ | ------------------------------------------------------ |
| `EVER_JOBS_API_URL`            | API base URL (default: `http://localhost:3001`)        |
| `HTTP_PROXY` / `HTTPS_PROXY`   | Global proxy configuration                             |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` to skip TLS verification (development only) |
