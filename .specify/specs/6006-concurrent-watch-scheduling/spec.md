# Spec 6006 — Concurrent Watch Scheduling

| Field         | Value                       |
| ------------- | --------------------------- |
| Status        | Implemented                 |
| Owner         | rad.ar                      |
| Date          | 2026-08-19                  |
| Related specs | 016, 6002, 6003, 6004, 6005 |

## Problem Statement

The watcher advertises a configurable per-process watch concurrency limit and
uses per-watch PostgreSQL leases, but its scheduler tests prove only the
single-watch case. The scheduler tracks IDs in a set while timer ticks may
overlap, waits until the next fixed poll to refill a released slot, and does not
hold the active run promises needed for deterministic shutdown. Due-watch order
also differs between the Prisma and in-memory repositories when `nextRunAt` is
null or timestamps tie.

As a result, concurrent scheduling is an intended but insufficiently specified
contract. Operators cannot rely on a deterministic oldest-due policy, prompt
capacity backfill, or test-backed enforcement that distinct watches may run in
parallel while the same watch never overlaps.

## Goals

- Run distinct due watch IDs concurrently up to
  `WATCHER_MAX_CONCURRENT_WATCHES` in one watcher process.
- Keep the same watch non-overlapping through both the process-local active map
  and the existing PostgreSQL execution lease.
- Serialize scheduler admission so overlapping poll requests cannot oversubscribe
  the configured capacity or dispatch one ID twice.
- Admit watches in deterministic oldest-due FIFO order and refill released
  capacity without waiting for the next fixed poll interval.
- Keep PostgreSQL due state as the durable pending queue; process restart must
  not lose waiting work.
- Stop admitting work during shutdown and wait, within the existing bounded
  shutdown window, for active scheduled run promises to settle.
- Make configured and occupied scheduler capacity observable through health and
  Prometheus metrics.
- Prove that global and per-source execution limits remain shared across
  concurrently running watches.

## Scope

This change covers scheduler admission and lifecycle behavior in
`@ever-jobs/watcher`, due-row ordering in both watch repositories, worker health
and watcher metrics, focused concurrency and persistence tests, and local/cloud
operator documentation.

## Non-goals

- Do not introduce a persisted queue table, Redis queue, or Prisma migration.
- Do not apply the scheduler capacity limit to manual API/CLI runs or target
  initialization. Those triggers continue to coordinate through the watch
  lease.
- Do not create cluster-wide capacity accounting across watcher replicas.
- Do not add persisted watch priorities, preemption, cancellation, or weighted
  scheduling.
- Do not change watch CRUD, watch JSON, scoring, notification routing, source
  cadence, or run-history schemas.
- Do not allow two executions of the same watch merely because they select
  different target subsets.

## Contracts

### Admission and capacity

The scheduler maintains one active run promise per scheduled watch ID. At any
observable point:

```text
0 <= active scheduled watch IDs <= WATCHER_MAX_CONCURRENT_WATCHES
```

Only one admission pass may query and dispatch due watches at a time. A request
that arrives while admission is in progress is coalesced into one follow-up
pass. Each pass calculates free capacity from the active map, reads an
oversampled FIFO candidate set, skips IDs already active in the process, and
starts no more than the available slots.

The default capacity remains `2`. Invalid, non-finite, or non-positive values
fall back to `2` through the existing positive-integer configuration policy.

### Durable FIFO order

`WatchRepository.listDueWatches(now, limit)` returns enabled, lease-available
watches whose `nextRunAt` is null or due. Both repository implementations use
the same total order:

1. null `nextRunAt` first (never scheduled);
2. ascending `nextRunAt`;
3. ascending `createdAt`;
4. ascending watch ID.

Rows beyond current capacity remain unchanged and due in PostgreSQL. The
scheduler does not copy pending rows into an in-memory queue.

### Slot release and backfill

Each dispatched promise removes only its own watch ID in `finally`, updates the
active-runs gauge, and requests a coalesced admission pass. A completed, failed,
deleted, not-due, or lease-conflicted candidate therefore releases local
capacity without cancelling or delaying sibling runs. Backfill is disabled once
shutdown begins.

### Lease and source limits

`WatchExecutionService` remains the sole owner of acquire/renew/release lease
semantics. Scheduled runs use `requireDue: true`; a competing replica or manual
trigger may win the lease, in which case the scheduler treats the conflict as an
expected candidate loss and refills the slot.

The singleton `JobsServiceWatchExecutor` retains one process-wide global limiter
and process-wide per-source limiters. Concurrent watches share
`WATCHER_MAX_CONCURRENT_SOURCES`; the per-source default remains one active
request for a normalized source key.

### Shutdown

Shutdown marks the scheduler as non-accepting before clearing the timer. It
awaits a snapshot of active scheduled promises with the existing 30-second
upper bound. Promise settlement continues to clean the active map and metrics,
but cannot request more work. Shutdown completion does not clear or fabricate
database leases; normal run `finally` blocks or lease expiry retain ownership
safety.

### Health and metrics

`WatcherSchedulerStatus` adds:

```ts
interface WatcherSchedulerStatus {
  // existing fields unchanged
  maxConcurrentWatches: number;
  activeWatchCount: number;
}
```

`activeWatchCount` equals `activeWatchIds.length`. The worker exports
`ever_jobs_watcher_scheduler_capacity` as a process gauge while retaining
`ever_jobs_watcher_scheduler_active_runs`. No watch IDs are added as Prometheus
labels.

## Error Handling

- A database/poll failure records the sanitized scheduler error and does not
  disturb already active sibling runs.
- Expected `already running` and `not due` lease races do not emit error-level
  noise.
- An unexpected run failure is logged with only the watch ID and sanitized
  message; its slot is still released.
- A failed immediate backfill is handled by the same poll error path and the
  fixed timer remains a recovery mechanism.
- Scheduler status and metrics must never report a negative count or a count
  above configured capacity.

## Performance and Security

Admission work is bounded by configured capacity and an oversampled candidate
limit. Shared source limiters prevent watch concurrency from multiplying source
request concurrency. FIFO comparisons are index-compatible for the primary due
fields; the existing watch table size is expected to remain modest, and no new
secret-bearing values or external I/O paths are introduced.

All source HTTP traffic continues through the existing source/plugin stack and
`@ever-jobs/common` HTTP policy. Health exposes IDs already present in the
existing scheduler response and adds counts only.

## Test Plan

### Unit and scheduler lifecycle

- Capacity two starts two distinct due watches before either completes.
- A third due watch remains due and starts after the oldest active slot settles.
- Capacity one serializes distinct watches; capacity two never reaches three
  active runs.
- Concurrent/reentrant poll calls are coalesced and never dispatch one ID twice.
- A slow watch cannot block a sibling slot, and a failed/conflicted candidate
  releases capacity for the next due row.
- The existing same-watch no-overlap and three-minute cadence regression remains
  green.
- Shutdown refuses new admissions, awaits active promises within its bound, and
  returns status/metrics to zero after settlement.
- Status and capacity metrics report the configured limit and active count.

### Repository, execution, and source concurrency

- Prisma query ordering explicitly requests null-first FIFO plus deterministic
  tie breakers; the in-memory repository returns the same order.
- Concurrent `execute()` calls on one source-executor instance share the global
  and per-source limits.
- Concurrent watch runs that observe the same source job keep one observation,
  create a separate match per watch, and scope notification state/delivery to
  the correct watch.

### Validation

- Run focused watcher scheduler/source/pipeline/repository and worker-health
  suites.
- Type-check the watcher package and worker app.
- Run documentation lint, repository lint/build targets where configured, and
  `git diff --check`.

## Acceptance Criteria

- With three due watches and capacity two, exactly two execute concurrently and
  the oldest waiting watch starts automatically when a slot opens.
- At no time does one process report more active scheduled runs than its
  configured capacity or more than one active promise for a watch ID.
- Restarting while work waits loses no candidate because waiting state exists
  only in PostgreSQL due fields.
- One watch failure or lease race does not cancel a concurrent sibling or leave
  a leaked local slot.
- Health and metrics expose consistent configured/active capacity.
- Existing single-watch, manual-run, lease, cadence, notification, and watch
  persistence behavior remains compatible without a migration.
