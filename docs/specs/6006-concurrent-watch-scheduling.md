# Concurrent Watch Scheduling

**Status:** Implemented

**Spec:** [Spec 6006](../../.specify/specs/6006-concurrent-watch-scheduling/spec.md)

**Plan:** [Implementation plan](../../.specify/specs/6006-concurrent-watch-scheduling/plan.md)

**Tasks:** [Task ledger](../../.specify/specs/6006-concurrent-watch-scheduling/tasks.md)

## Purpose

A watcher process can execute different due watches at the same time without
allowing one watch to overlap itself. The process admits at most
`WATCHER_MAX_CONCURRENT_WATCHES` scheduled runs, which defaults to two. This
limit controls automatically scheduled watch runs only; manual API/CLI runs and
initialization continue to coordinate through the same per-watch PostgreSQL
lease but do not consume scheduler slots.

The scheduler keeps pending work durable. A watch that cannot enter the current
capacity remains due in PostgreSQL rather than being copied into an in-memory
queue. Process restart therefore cannot lose a waiting watch.

## Admission and Non-overlap

The scheduler maintains a process-local map from watch ID to the promise for
that scheduled run. Only one admission pass can query and dispatch candidates
at a time. Timer ticks and completion-triggered admission requests that arrive
during a pass are coalesced into a single follow-up pass.

These invariants apply at every observable point:

```text
0 <= active scheduled watches <= WATCHER_MAX_CONCURRENT_WATCHES
one active scheduled promise per watch ID
one PostgreSQL execution lease per watch ID
```

The active-promise map prevents duplicate dispatch in one process. The
PostgreSQL lease remains the authority across scheduler ticks, manual triggers,
and multiple worker replicas. A replica or manual trigger may win the lease
after another scheduler reads the same due row. That expected conflict releases
the local slot and does not fail or cancel sibling runs.

A run failure, deleted watch, no-longer-due candidate, or lease conflict also
releases only that candidate's slot. Other active watches continue
independently.

## Durable Oldest-due FIFO

Both PostgreSQL and in-memory repositories return due watches in one total
order:

1. `nextRunAt` is null, meaning the watch has never been scheduled;
2. earliest `nextRunAt`;
3. earliest `createdAt` when due timestamps tie;
4. lexicographically smallest watch ID as the final tie-breaker.

The scheduler fills free slots from this ordered candidate set. Rows beyond the
current capacity stay unchanged and due. When a scheduled promise settles, the
scheduler requests one coalesced admission pass immediately, so the oldest
waiting watch can backfill the free slot without waiting for the next 15-second
poll. The fixed poll remains the discovery and recovery mechanism.

FIFO is bounded admission, not preemption. An active long-running watch keeps
its slot until it settles; a waiting watch does not interrupt it. There are no
persisted priorities or cluster-wide weighted scheduling rules.

## Watch and Source Capacity

`WATCHER_MAX_CONCURRENT_WATCHES` is a per-process limit on active automatically
scheduled watches. Its default is `2`. Invalid, non-finite, or non-positive
configuration falls back to the default.

`WATCHER_MAX_CONCURRENT_SOURCES` is a separate process-wide source-request
limit. Concurrent watch runs share the singleton source executor's global
limiter and its per-source limiters. Starting two watches therefore does not
give each watch an independent source allowance or multiply request pressure.
The default per-source limiter permits one active request for each normalized
source key.

Increasing watch capacity can improve throughput when watches spend time on
different sources, database work, or remote latency. It does not bypass a
shared source cap. Operators must size both limits against database connection
capacity, host resources, provider policies, and expected run duration.

## Health and Metrics

Worker health retains `activeWatchIds` and adds two scheduler fields:

```ts
interface WatcherSchedulerStatus {
  // Existing fields remain unchanged.
  maxConcurrentWatches: number;
  activeWatchCount: number;
}
```

`activeWatchCount` always equals `activeWatchIds.length`. The following
Prometheus gauges expose occupied and configured process capacity without
placing watch IDs in metric labels:

- `ever_jobs_watcher_scheduler_active_runs`
- `ever_jobs_watcher_scheduler_capacity`

An active count below capacity is normal when fewer watches are due, candidates
lose a lease race, or the shared source limiter is constraining request work.
Use PostgreSQL run history and due timestamps with health and metrics when
diagnosing a backlog.

## Shutdown and Restart

Shutdown marks the scheduler non-accepting before clearing its polling timer.
No completion path may admit replacement work after that point. The worker
awaits a snapshot of active scheduled promises for up to the existing 30-second
shutdown window. Settling promises still remove their IDs and update metrics.

Shutdown does not erase or fabricate PostgreSQL leases. A normal execution
`finally` path releases its lease; if the process is forcibly terminated, lease
expiry provides the existing recovery boundary. Watches that never entered a
slot remain due and are discovered after restart.

## Compatibility and Boundaries

- There is no Prisma migration, Redis queue, new watch table, or persisted
  priority field.
- Watch CRUD, JSON, CLI commands, scoring, notifications, source cadence, and
  run-history schemas are unchanged.
- Capacity is local to each worker process. Multiple replicas do not share a
  cluster-wide slot budget, so deployments must still bound replica count and
  rely on PostgreSQL leases for same-watch exclusion.
- Manual runs and initialization remain outside scheduler capacity. They can
  temporarily increase total process work but cannot overlap an already leased
  execution of the same watch.
- Two watches may persist matches for the same canonical job observation. Match
  and notification state remains scoped to the correct watch, while the shared
  observation is stored once.

## Operational Verification

In a disposable or controlled environment, set both concurrency variables,
restart the worker, and prepare two distinct initialized watches whose
`nextRunAt` values are due:

```dotenv
WATCHER_MAX_CONCURRENT_WATCHES=2
WATCHER_MAX_CONCURRENT_SOURCES=5
```

Resume both watches before the next poll and sample `/health` and `/metrics`
while their source work is still active. Health should show
`maxConcurrentWatches: 2`, `activeWatchCount: 2`, and two distinct
`activeWatchIds`; metrics should expose capacity `2` and active runs `2`.
After settlement, active count returns to zero and each watch has an independent
run record.

For a backfill check, make a third watch due before the first two settle. It
must remain due while both slots are occupied, then begin automatically when
one slot opens. Run order must follow the null-first, oldest-due FIFO contract.
Use test notification destinations or keep alerting disabled during this
verification; never create unreviewed production notifications merely to make a
run last longer.
