# Plan 6006 — Concurrent Watch Scheduling

| Field        | Value      |
| ------------ | ---------- |
| Spec         | `spec.md`  |
| Created      | 2026-08-19 |
| Last updated | 2026-08-19 |

## Phase 1 — Scheduler Coordination

Replace the process-local active ID set with a map of scheduled run promises.
Serialize/coalesce admission requests, calculate slots from that map, and
request immediate backfill when a promise settles. Keep fixed polling for due
discovery and recovery, and keep notification retry/digest maintenance from
being multiplied by completion-triggered admission.

## Phase 2 — Deterministic Durable Admission

Align Prisma and in-memory `listDueWatches` ordering to null-first `nextRunAt`,
then `createdAt`, then ID. Continue to lease inside `WatchExecutionService` and
leave excess rows due in PostgreSQL rather than introducing an in-memory queue.

## Phase 3 — Lifecycle and Observability

Block admissions before shutdown, await active promises with the existing
30-second bound, and keep active-run metrics synchronized in every settlement
path. Add configured and active capacity to scheduler health and export the
configured-capacity Prometheus gauge.

## Phase 4 — Concurrency Regression Coverage

Exercise two simultaneous watches, capped/FIFO backfill, reentrant polls,
candidate failure, shutdown, repository order parity, shared cross-watch source
limits, and shared-observation/per-watch-match persistence. Preserve the
existing single-watch and replica-lease regressions.

## Phase 5 — Operations and Validation

Document process-wide watch/source concurrency and a two-watch smoke procedure.
Update documentation discovery/history, run focused tests and type checks, then
run available repository lint/build checks and diff hygiene.

## Risks and Mitigations

- **Admission recursion or hot looping:** coalesce completion signals into one
  serialized follow-up pass and retain the fixed interval as recovery.
- **Shutdown starts replacement work:** set the stopping flag before timer
  cancellation or promise waiting; every dispatch entry point checks it.
- **Replica races underfill a process:** treat lease loss as expected, release
  the local slot, and request backfill from durable due state.
- **Source pressure multiplies with watches:** retain the executor singleton and
  prove its limiters are shared across concurrent `execute()` calls.
- **Repository/test divergence:** encode the same total comparator in Prisma and
  in-memory implementations and assert exact ID order.

## Rollback

The change is code- and documentation-only. Reverting scheduler coordination,
status fields, and the capacity metric restores fixed-poll behavior without a
database rollback. Existing due timestamps and leases remain valid across
either revision.
