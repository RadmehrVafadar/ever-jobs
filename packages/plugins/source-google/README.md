# Google Jobs Source

`@ever-jobs/source-google` searches the public Google Jobs surface as
`Site.GOOGLE`. It is a query source (`watchMode: "query"`), not a complete
company board. The watcher therefore supplies a bounded rotating search-term ×
location request matrix.

## Public surface and inputs

The service sends ordinary HTML requests to `https://www.google.com/search`
with `ibp=htl;jobs`, an English locale, a country hint, and a bounded page
offset. All HTTP I/O uses the shared rad.ar client.

Relevant `ScraperInputDto` fields are:

| Field | Behavior |
| ----- | -------- |
| `googleSearchTerm` | Google-specific query; falls back to `searchTerm`, then `jobs` |
| `location` | Appended to the query as `near <location>` |
| `country` | Selects the `ca` hint for Canada; otherwise `us` |
| `isRemote`, `jobType` | Add remote/type terms to the query |
| `resultsWanted` | Clamped to 0–100; list pagination is capped at five 10-result pages |
| `descriptionFormat` | Preserves HTML by default or renders plain/Markdown descriptions when embedded data provides one |

The Spec 6000 watcher preset defaults this target to 12 matrix requests per run
across Canada and the United States. The target remains disabled until the live
surface gate described below succeeds.

## Accepted response shapes

The parser recognizes three deterministic public-page shapes:

1. semantic job cards (`data-job-id`, `data-google-job`, or
   `.google-jobs-card`);
2. schema.org `JobPosting` JSON-LD;
3. normalized JSON in `script[type="application/json"][data-google-jobs]`.

It maps stable source IDs (or a deterministic fallback hash), title, company,
genuine publication date when present, every advertised location, Google detail
URL, and an external employer application URL. `location` is the primary first
location and `locations[]` preserves the complete deduplicated source order.
Google-owned URLs are not misreported as employer application URLs.

## Failure contract

Only explicitly recognized no-results markup is a successful zero-result run.
An empty or whitespace-only response is treated as changed markup and throws a
classified source failure. These conditions throw classified source failures:

| Error prefix | Meaning |
| ------------ | ------- |
| `SOURCE_HTTP_FAILURE` | Shared HTTP request failed |
| `SOURCE_BLOCKED` | CAPTCHA, consent/challenge, unusual-traffic, or JavaScript-only shell detected |
| `SOURCE_SCHEMA_INVALID` | Non-HTML response, invalid embedded JSON, or required record fields missing |
| `SOURCE_MARKUP_CHANGED` | HTML contains neither recognized jobs nor a valid empty state |

The watcher records those as hard failures. They must never be converted to an
empty `JobResponseDto`.

## Validation and activation status

Sanitized fixtures cover pagination, stable IDs, publication dates,
multi-location mapping, external application URLs, explicit empty results,
malformed payloads, blocked pages, and HTTP failures. This source is included in
the final six-suite/57-test deterministic pass. Run its suite from the repository
root:

```bash
npm test -- --runInBand packages/plugins/source-google/__tests__/google.service.spec.ts
```

The network suite is opt-in:

```bash
RUN_NETWORK_E2E=true npm test -- --runInBand packages/plugins/source-google/__tests__/google.e2e-spec.ts
```

The current operational smoke returned Google's
`/httpservice/retry/enablejs` JavaScript-only shell and was correctly classified
as `SOURCE_BLOCKED`. Therefore the unattended Google Jobs target remains
disabled. Do not enable it until a later disabled smoke returns a recognized
public job/empty shape, application URLs and locations are inspected, and the
target baseline succeeds.

## Limits and safety

- No login, cookies, private endpoint, challenge bypass, or browser-session
  reuse is implemented.
- Google can change, localize, throttle, or block the public surface at any time.
- Five pages and the caller result cap bound work; the watcher adds its own
  per-target request budget and global concurrency.
- Automated tests never require live Google network access.
