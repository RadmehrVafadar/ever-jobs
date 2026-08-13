# Canadian Employer Internship Coverage (Spec 6004)

Spec 6004 adds a second, disabled starter template: **Canadian Tech + Adjacent
Internships** (`canadian-tech-adjacent-internships`, revision 1). The existing
`canadian-tech-internships` revision-1 template remains available and is not
silently migrated.

The new template monitors Summer 2027 internships and co-ops across the strict
Greater Toronto Area. Its nine role families cover software engineering,
data/AI, cybersecurity, cloud/platform/infrastructure, QA/automation, technical
product, UX/product design, systems/business analysis, and technology risk/IT
audit. Broad audit, tax, finance, store, marketing, recruiting-event, and other
non-technical placements remain ineligible.

## First-party employer coverage

The template combines the existing 21 technology-company cohort with 20 added
employer groups:

- banks: RBC, TD, Scotiabank, BMO, and CIBC;
- consulting: KPMG, PwC, Deloitte Canada, EY Canada, and Accenture Canada;
- retail and consumer brands: Aritzia, Loblaw, Canadian Tire, and Canada Goose;
- insurance: Manulife, Sun Life, and Intact;
- telecom: Bell, Rogers, and TELUS.

Every configured company must have an enabled, branded first-party target.
LinkedIn, Google Jobs, and Canada Job Bank can provide discovery redundancy but
do not satisfy company coverage. Loblaw counts once in the company inventory
while its main, PC Financial, and Shoppers Drug Mart boards are polled
independently.

Stable official ATS boards use shared Workday, iCIMS, SuccessFactors, or Yello
adapters. Accenture uses a localized company source. A dedicated company plugin
is not required merely to give an employer first-party coverage: polling its
official ATS and preserving the official application URL meets that contract.

## Efficient board searches and reliability

Large boards use `board-search` mode. The watcher rotates term-only searches
without creating a search-term-by-location matrix, caps each request at 25
normalized jobs, and applies strict GTA filtering to normalized results.
Workday sends the selected term through its
server-side `searchText` field before bounded detail enrichment.

Vanity career domains are carried in `WatchSourceTarget.companyUrl` and passed
to the source adapter. The URL is a material preset field but is deliberately
not part of the stable target key. iCIMS supports KPMG's student portal;
SuccessFactors supports official vanity listing/search URLs; and Yello supports
EY Canada's public job-board token.

An upstream page that advertises jobs but yields no parsed records is treated as
an extraction failure. An upstream response that explicitly reports zero jobs
remains a valid empty result. This distinction prevents a layout change from
appearing as healthy zero-volume coverage.

## Safe activation

The template ships globally disabled and uninitialized. Applying it to an
existing watch requires a paused watch and a dry-run review. Added or materially
changed targets must then be initialized in baseline mode, inspected through
coverage and run history, and observed without notifications before an operator
explicitly resumes the watch.

The opt-in command below reaches live employer systems and is not a normal CI
test:

```bash
npm run smoke:canadian-employers
npm run smoke:canadian-employers -- --company KPMG --json
```

It reports one row per official endpoint: upstream-advertised count when the
adapter exposes it, parsed count, GTA count, Summer 2027 count, configured-role
count, combined GTA/Summer/role count, duration, and syntactic/host validation
of direct application URLs. `n/a` is reported rather than inventing an upstream
total. Empty boards and failures are distinct statuses.

The complete network-enabled run on 2026-08-12 finished with exit code 0 across
all 22 endpoints: 18 returned parsed jobs; Loblaw main, PC Financial, Shoppers
Drug Mart, and Bell each authoritatively advertised zero; no endpoint failed;
and no parsed direct URL failed its official-host check. KPMG advertised 28
jobs, the bounded smoke parsed 25, 23 were in the GTA, 19 contained Summer 2027
evidence, and four met the combined GTA + Summer + role diagnostic. Deloitte
advertised 109 jobs; all 25 bounded parsed results were GTA jobs, one matched a
configured role family, and none contained Summer 2027 evidence. A source pass
or authoritative empty result validates the endpoint on that date—it does not
claim that every employer currently has a qualifying Summer 2027 opening.

Repository closeout passed the production build, all 15 watcher suites (215
tests), all 14 API suites (79 tests), and the focused 24-suite Spec 6004
regression set (330 tests). The remaining documentation-lint findings predate
this work and are recorded in the research notes rather than being silently
changed as part of this feature.

See the authoritative [specification](../../.specify/specs/6004-canadian-employer-internship-coverage/spec.md),
[implementation plan](../../.specify/specs/6004-canadian-employer-internship-coverage/plan.md),
[task ledger](../../.specify/specs/6004-canadian-employer-internship-coverage/tasks.md),
and [research notes](../../.specify/specs/6004-canadian-employer-internship-coverage/notes.md).
