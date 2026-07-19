# LinkedIn Public Guest Source

`@ever-jobs/source-linkedin` searches LinkedIn's unauthenticated public guest
surface as `Site.LINKEDIN`. It is a query source (`watchMode: "query"`) and
provides best-effort redundancy; it does not recreate personalized account
alerts.

## Security boundary

The source never logs in, stores or reuses personal cookies, attaches an
authenticated browser session, solves CAPTCHAs, or bypasses a challenge/access
control. Search uses the public guest listing endpoint and public job detail
pages through the shared Ever Jobs HTTP client. A challenge/auth wall is a hard
failure.

## Inputs and request bounds

Relevant `ScraperInputDto` fields are:

| Field | Behavior |
| ----- | -------- |
| `searchTerm`, `location` | Public guest keywords and location |
| `hoursOld` | Newest-first recent window; defaults to 72 hours, minimum 1, maximum 168 |
| `resultsWanted` | Clamped to 0–100; pages contain 25 cards |
| `offset`, `distance` | Initial result offset and distance (default 50) |
| `jobType`, `isRemote`, `easyApply` | Forwarded as supported public guest filters |
| `linkedinCompanyIds` | Comma-separated public company filter |
| `descriptionFormat` | HTML by default; optional plain or Markdown detail description |

Search always sends newest-first ordering. The Spec 6000 watcher preset defaults
LinkedIn to eight rotating matrix requests per Tier 3 run and a 72-hour window.
Tier 3 eligibility allows Canada and the United States.

## Mapping and detail budget

Listing cards provide stable `li-<id>` identity, title, company/link, primary and
array location, publication date, remote inference, and visible compensation.
URLs are stripped of query/fragment noise.

Detail pages are fetched only when the title contains both internship/co-op
evidence and a supported software/engineering discipline. This coarse gate
avoids paying for descriptions of obviously ineligible roles. A qualifying
detail can add formatted description, job level/type, industry, emails, and the
external employer application URL when a public apply anchor exposes it.
Requests are deliberately serialized with jitter between pages/details.

## Failure contract

Only a recognized no-results state is a successful zero-result response. An
empty or whitespace-only body is treated as changed markup and throws a
classified failure. These conditions throw classified failures:

| Error prefix | Meaning |
| ------------ | ------- |
| `SOURCE_HTTP_FAILURE` | Listing/detail HTTP request failed |
| `SOURCE_BLOCKED` | Checkpoint, verification, CAPTCHA, challenge, or auth wall detected |
| `SOURCE_SCHEMA_INVALID` | Listing/detail response is not HTML |
| `SOURCE_MARKUP_CHANGED` | Expected cards, stable fields, empty marker, or qualifying detail description disappeared |

A blocked or malformed detail for a coarse candidate fails the target; it is not
silently accepted as an incomplete success.

## Validation and activation status

Sanitized fixtures cover newest-first/recent parameters, pagination fields,
stable IDs, location arrays, coarse detail gating, external employer URLs,
recognized empty state, malformed markup, blocking, and HTTP failure. Run:

```bash
npm test -- --runInBand packages/plugins/source-linkedin/__tests__/linkedin.service.spec.ts
```

The opt-in public network suite is:

```bash
RUN_NETWORK_E2E=true npm test -- --runInBand packages/plugins/source-linkedin/__tests__/linkedin.e2e-spec.ts
```

The current listing/detail live smoke succeeded without authentication. That
proves current reachability from the smoke environment, not permanent coverage
or personalized-alert parity. This source is included in the final
six-suite/57-test deterministic pass. The v2 preset target-enables `linkedin`
only inside the globally disabled/uninitialized watch; keep it paused until the
target baseline succeeds, inspect locations/application URLs, and complete two
additional no-notification observation cycles before resume.

## Limits

- Public LinkedIn markup, indexing, IP policy, and rate limits can change.
- The 72-hour overlap improves recovery from a missed Tier 3 cycle but cannot
  guarantee every personalized alert result.
- At most 100 list results are returned per scrape; watcher matrix and global
  concurrency limits apply in addition.
- Automated tests never depend on a live LinkedIn request.
