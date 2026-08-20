# Tasks 6006 — Concurrent Watch Scheduling

- [x] T01 Specify bounded FIFO admission, durable pending state, lease ownership, shutdown, observability, non-goals, and acceptance tests.
- [x] T02 Refactor scheduler admission around active promises and a serialized/coalesced dispatcher; accept when distinct watches fill capacity without duplicate IDs or oversubscription.
- [x] T03 Backfill capacity on run settlement while keeping notification retry and digest maintenance on the fixed poll; accept when a third FIFO watch starts after a slot opens.
- [x] T04 Align Prisma and in-memory due-watch ordering to null-first `nextRunAt`, `createdAt`, and ID; accept when repository tests return identical deterministic order.
- [x] T05 Make shutdown non-accepting and await active scheduled promises within the existing bound; accept when no replacement work starts during shutdown and active status returns to zero after settlement.
- [x] T06 Add scheduler capacity health fields and Prometheus gauge; accept when health and metric tests prove configured capacity and active-count consistency.
- [x] T07 Add cross-watch scheduler, shared source-limiter, and shared-observation/per-watch-match regressions; accept when capacity, FIFO, isolation, and persistence contracts are deterministic.
- [x] T08 Update the human spec mirror, local/cloud/Mac operator guidance, documentation index, and append-only log.
- [x] T09 Run focused watcher/repository/worker-health tests, watcher package/app type checks, available lint/build checks, docs lint, and diff hygiene; record exact results and complete this ledger.

## Validation Results

- Watcher package: 15 suites, 238 tests passed.
- Watcher health controller: 1 suite, 2 tests passed.
- Type checks: watcher package and watcher app passed.
- Production build: all five Nx projects passed (`api`, `cli`, `watcher`,
  `@ever-jobs/mcp`, and `web`).
- Code lint: successful; Nx reported no configured lint tasks.
- Documentation lint: no Spec 6006 findings; it reports eight pre-existing
  findings (two deprecated broken example links, four historical duplicate log
  entries, and two Spec 5024 metadata findings).
- Prettier: all new Spec 6006 artifacts and all changed TypeScript files passed.
  Four edited legacy operator documents retain pre-existing whole-file format
  drift.
- Diff hygiene: `git diff --check` passed.
