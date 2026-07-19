# Google Careers source

`@ever-jobs/source-company-google` reads the official server-rendered Google
Careers results and detail pages under
`https://www.google.com/about/careers/applications/jobs/results/`.

The plugin declares `watchMode: "query"`. It accepts a caller-supplied search
term and forwards a matrix location only when the shared location parser
confirms it is Canadian (for example Canada, Toronto/GTA, or Waterloo);
blank, unknown, and US locations clamp to `Canada`. Google's public URL
exposes the combined `INTERN_AND_APPRENTICE` target-level filter, so the source
also applies an explicit post-filter that rejects apprenticeship titles and
retains internship/co-op evidence only. This direct source is a Tier 1
Canada-only internship/co-op source. Results are paged in bounded
20-result increments and capped at 100 jobs per scrape.

For each result, the detail page supplies the official application URL,
description, and the complete advertised location list. The numeric Google job
ID is retained as `google-careers-<id>`. A publication date is emitted only
when the official detail document exposes an explicit date marker; application
deadlines and fetch timestamps are never substituted for a posting date.

HTTP errors, blocking/consent pages, missing result markers, and malformed
detail records throw typed failures with one of `HTTP`, `BLOCKED`,
`MARKUP_CHANGED`, or `SCHEMA_INVALID`. Only a page that retains the official
results markers and reports zero matching jobs is treated as a successful empty
run.

This source is included in the final six-suite/57-test deterministic pass; tests
use sanitized local HTML and never call Google. The disabled live smoke returned
two official Canadian internship results with stable IDs, public Google
job/application URLs, and Waterloo/Montréal/Toronto location arrays. The current
official details exposed no publication date, so `datePosted` remains `null` by
design.

The v2 preset target-enables `google_careers` only inside the globally disabled,
uninitialized watch. That state cannot poll or notify while paused. Complete the
target baseline and two additional no-notification observation cycles before
resuming.
