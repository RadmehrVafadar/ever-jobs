# Shopify careers source

`@ever-jobs/source-company-shopify` is the direct Shopify internship source.
It uses only public pages on `https://www.shopify.com`:

- the server-rendered `/careers` cards for public job/JID identity, title,
  discipline, location label, and canonical detail URL;
- each relevant public `/careers/<slug>_<jid>` route for its embedded public
  job record, genuine publication date, description, employment type, and
  official `/careers?ashby_jid=<jid>` application URL.

The plugin declares `watchMode: "board"`. It never guesses a Shopify Ashby
slug and never calls an Ashby API or private endpoint. Detail fetches are
bounded to five concurrent requests. The source returns only postings with
internship/co-op evidence and a software, engineering, ML/AI, data,
infrastructure/cloud/platform/SRE/DevOps, security, mobile, or developer-
experience discipline signal. Board filtering happens after the single board
fetch.

Stable IDs use `shopify-<public-jid>`. The original remote/regional label is
fed through the shared multi-location parser alongside structured public detail
locations, preserving both the compatibility `location` field and the complete
`locations[]` array.

HTTP errors, blocking pages, missing board/detail markers, and invalid public
records throw typed `HTTP`, `BLOCKED`, `MARKUP_CHANGED`, or `SCHEMA_INVALID`
failures. A board is a successful empty run only when the official careers
markers remain present and no job cards exist.

This source is included in the final six-suite/57-test deterministic pass; tests
use sanitized local HTML and flattened public-route fixtures, and CI never
contacts Shopify. The disabled official-board smoke retained Shopify's expected
markers and returned zero qualifying internships, so it was classified as a
valid empty run rather than a failure.

The v2 preset target-enables `shopify` only inside the globally disabled,
uninitialized watch. That state cannot poll or notify while paused. Complete the
target baseline and two additional no-notification observation cycles before
resuming.
