# rad.ar Mac Mini Production Cheat Sheet

Production installation:

```text
/Users/vafadar/repo/ever-jobs
```

Production watch ID:

```text
2067423d-b634-49a5-a8ca-8b963e00f9d4
```

LaunchAgent label:

```text
com.everjobs.watcher
```

## Start every terminal session

```bash
source ~/.zshrc
cd /Users/vafadar/repo/ever-jobs
```

Use the compiled CLI for production administration. It starts much faster than
`npm run cli`:

```bash
node dist/apps/cli/main.js watch show 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

## One-minute status check

```bash
date
curl -sS http://localhost:3002/health
pgrep -fl "dist/apps/watcher/main.js"
node dist/apps/cli/main.js watch show 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

Healthy service indicators:

- Health `status` is `healthy`.
- `database` is `true`.
- Scheduler `enabled` and `started` are `true`.
- Scheduler `maxConcurrentWatches` matches the LaunchAgent setting (default
  `2`).
- Scheduler `activeWatchCount` equals `activeWatchIds.length` and never exceeds
  `maxConcurrentWatches`.
- `lastPollAt` is recent and `lastError` is `null`.
- Discord status is `configured`.
- The watch itself has `enabled: true` when monitoring should be on.

`activeWatchIds: []` and `activeWatchCount: 0` mean no scheduled execution was
in progress at that exact moment. They do not mean the service is off. Health
can also include a paused watch, so always inspect the watch's own `enabled`
field.

## Current production cadence

| Target group | Interval | Requests per scheduled run |
| --- | ---: | ---: |
| Google Careers | 10 minutes | 1 rotating query |
| Shopify, Wealthsimple, Plaid, and direct-company targets | 10 minutes | One source scrape; internal pagination/detail calls may add requests |
| Wellfound | 30 minutes | One source scrape |
| Canada Job Bank | 30 minutes | 12 rotating queries |
| LinkedIn public guest search | 60 minutes | 8 rotating queries |
| Google Jobs | 30 minutes configured | Disabled; no requests |

The watch-level `intervalMinutes` may remain `3`. That is the scheduler check
frequency, not the external-query cadence. Each source target's interval controls
when it is actually due.

`WATCHER_MAX_CONCURRENT_WATCHES=2` permits two different automatically
scheduled watch IDs to run at once in this watcher process. The same watch never
overlaps because it also requires a PostgreSQL lease. Waiting watches remain due
in PostgreSQL and are admitted null-first, then oldest `nextRunAt`, `createdAt`,
and ID. When a slot opens, the oldest waiting watch backfills immediately rather
than waiting for another fixed poll.

`WATCHER_MAX_CONCURRENT_SOURCES=5` is one process-wide source budget shared by
all concurrent watch runs, not five per watch. Per-source limiters are shared as
well. Increase either value only after checking PostgreSQL connections, machine
load, normal run duration, and provider limits.

Read the two non-secret LaunchAgent values without printing its full environment:

```bash
/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:WATCHER_MAX_CONCURRENT_WATCHES" \
  /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:WATCHER_MAX_CONCURRENT_SOURCES" \
  /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
```

## Verify two watches safely

Use staging or a controlled production window with two reviewed, initialized
watches and test notification routing. Assign their IDs without reusing the
production-ID placeholder:

```bash
WATCH_A_ID="first-reviewed-watch-id"
WATCH_B_ID="second-reviewed-watch-id"
node dist/apps/cli/main.js watch show "$WATCH_A_ID" --json
node dist/apps/cli/main.js watch show "$WATCH_B_ID" --json
```

Resume both before the next poll, then sample health and the scheduler gauges
while normal source work is active:

```bash
node dist/apps/cli/main.js watch resume "$WATCH_A_ID" --json
node dist/apps/cli/main.js watch resume "$WATCH_B_ID" --json
curl -sS http://localhost:3002/health
curl -sS http://localhost:3002/metrics | grep -E \
  '^ever_jobs_watcher_scheduler_(capacity|active_runs) '
```

With capacity two, health should briefly report two distinct `activeWatchIds`,
`activeWatchCount: 2`, and `maxConcurrentWatches: 2`; metrics should report
capacity `2` and active runs `2`. If the runs finish between samples, compare
their durable run start/end times:

```bash
node dist/apps/cli/main.js watch runs "$WATCH_A_ID" --json
node dist/apps/cli/main.js watch runs "$WATCH_B_ID" --json
```

For a backfill check, make a third reviewed watch due while both slots are
occupied. It must remain due, then start automatically when one slot opens in
the oldest-due FIFO order. Pause only the test watches after verification. Do
not add artificial production delays or unreviewed notification routes to make
concurrency easier to observe.

## Safe production update

Run each command separately and stop if one fails:

```bash
source ~/.zshrc
cd /Users/vafadar/repo/ever-jobs
git branch --show-current
git status --short --branch
launchctl bootout gui/$(id -u)/com.everjobs.watcher
git pull --ff-only origin codex-branch
npm ci
npm run db:generate
npm run db:migrate
npx nx reset
npx nx run watcher:build --skip-nx-cache
npx nx run api:build --skip-nx-cache
npx nx run cli:build --skip-nx-cache
plutil -lint /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
launchctl bootstrap gui/$(id -u) /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
curl -sS http://localhost:3002/health
```

Expected branch:

```text
codex-branch
```

`npx nx reset` clears Nx daemon/cache state. `--skip-nx-cache` forces fresh
watcher, API, and CLI output, preventing an old `dist/` bundle from surviving a
pull. If the web GUI is hosted from this checkout, rebuild it in the same update
window as well. Do not restore or compact a watch until every process that can
read or write its configuration is on this revision.

The number of watch definitions is not restricted to one. A Canadian watch and
a US watch can run concurrently up to the configured process capacity; leases
are scoped by watch ID. Excess due watches remain durable and backfill as slots
open. The dangerous state is mixed program revisions, not multiple watches.
Spec 6005 additionally ensures that a long-running scrape cannot overwrite a
backup restore or source edit made after that run began.

If dependencies and migrations are known to be unchanged, `npm ci`, Prisma
generation, and migration still remain safe; the commands should be kept in the
standard production-update sequence.

## Confirm source and compiled revision

```bash
git log -1 --oneline
sed -n '203,285p' packages/watcher/src/services/canadian-tech-internships.preset.ts
```

Do not verify `maxRequestsPerRun: 1` with a loose `grep`: it also matches `12`.
Use an end-of-line expression:

```bash
grep -Eq "maxRequestsPerRun: 1,$" packages/watcher/src/services/canadian-tech-internships.preset.ts \
  && echo "SOURCE NEW" || echo "SOURCE NOT EXPECTED"
```

The authoritative compiled-code check is a preset preview after rebuilding:

```bash
node dist/apps/cli/main.js watch preset apply canadian-tech-internships \
  --watch 2067423d-b634-49a5-a8ca-8b963e00f9d4
```

## Apply a preset update safely

Pause first:

```bash
node dist/apps/cli/main.js watch pause \
  2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

Preview without changing the database:

```bash
node dist/apps/cli/main.js watch preset apply canadian-tech-internships \
  --watch 2067423d-b634-49a5-a8ca-8b963e00f9d4
```

Review `materiallyChanged`, `disabled`, and
`targetKeysRequiringInitialization`. Apply only after the preview is correct:

```bash
node dist/apps/cli/main.js watch preset apply canadian-tech-internships \
  --watch 2067423d-b634-49a5-a8ca-8b963e00f9d4 --apply
```

Baseline every enabled target when the preset reports broad material changes:

```bash
node dist/apps/cli/main.js watch initialize \
  2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

Or baseline one target:

```bash
node dist/apps/cli/main.js watch initialize \
  2067423d-b634-49a5-a8ca-8b963e00f9d4 --target linkedin --json
```

Initialization is a no-notification baseline. Inspect `status`, target results,
failed requests, and `notificationsSent` before resuming. A `partial` LinkedIn
result can fetch jobs but normally leaves LinkedIn uninitialized; avoid repeated
immediate retries because they can worsen throttling.

Resume after acceptable initialization:

```bash
node dist/apps/cli/main.js watch resume \
  2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

## Everyday watch commands

```bash
node dist/apps/cli/main.js watch list --json
node dist/apps/cli/main.js watch show 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch runs 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch matches 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch deliveries 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch metrics 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

Pause, resume, manual scan, and Discord test:

```bash
node dist/apps/cli/main.js watch pause 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch resume 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch run 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
node dist/apps/cli/main.js watch notifications-test 2067423d-b634-49a5-a8ca-8b963e00f9d4 --json
```

API-key warnings for unselected plugins are informational. Use `sourcesFailed`,
`targetResults`, and `errorSummary` to identify failures affecting this watch.

## Logs

Latest normal and error logs:

```bash
tail -n 100 /Users/vafadar/Library/Logs/ever-jobs-watcher.log
tail -n 100 /Users/vafadar/Library/Logs/ever-jobs-watcher-error.log
```

Follow logs; press `Ctrl+C` to stop following:

```bash
tail -f /Users/vafadar/Library/Logs/ever-jobs-watcher.log
tail -f /Users/vafadar/Library/Logs/ever-jobs-watcher-error.log
```

The first lines printed by `tail -f` are historical. Use their timestamps and a
fresh health request before concluding that the watcher stopped.

Check sizes:

```bash
du -h /Users/vafadar/Library/Logs/ever-jobs-watcher*.log
```

## LaunchAgent operations

Inspect:

```bash
launchctl print gui/$(id -u)/com.everjobs.watcher
```

Restart the registered service:

```bash
launchctl kickstart -k gui/$(id -u)/com.everjobs.watcher
curl -sS http://localhost:3002/health
```

Do not manually start a second watcher while launchd owns port `3002`.

After editing the plist, validate and reload it; `kickstart` does not reread a
changed plist:

```bash
plutil -lint /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
launchctl bootout gui/$(id -u)/com.everjobs.watcher
launchctl bootstrap gui/$(id -u) /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
```

## PostgreSQL and backup

```bash
pg_isready
brew services list
brew services restart postgresql@16
psql -d ever_jobs
```

Exit `psql` with `\q`.

Create and inspect a timestamped backup:

```bash
mkdir -p /Users/vafadar/ever-jobs-backups
pg_dump -d ever_jobs -Fc -f "/Users/vafadar/ever-jobs-backups/ever-jobs-$(date +%Y%m%d-%H%M%S).dump"
ls -lh /Users/vafadar/ever-jobs-backups
```

## Machine checks

```bash
pmset -g custom
df -h /
uptime
```

For continuous monitoring, system sleep should be disabled (`sleep 0`) and
automatic restart should be enabled (`autorestart 1`). Display sleep is fine.

## After upgrading Node.js

```bash
which node
nano /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
plutil -lint /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
launchctl bootout gui/$(id -u)/com.everjobs.watcher
launchctl bootstrap gui/$(id -u) /Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
curl -sS http://localhost:3002/health
```

Update every Node path in the plist before reloading it.

## Important files

```text
/Users/vafadar/repo/ever-jobs/.env
/Users/vafadar/Library/LaunchAgents/com.everjobs.watcher.plist
/Users/vafadar/Library/Logs/ever-jobs-watcher.log
/Users/vafadar/Library/Logs/ever-jobs-watcher-error.log
/Users/vafadar/ever-jobs-backups/
```

Never print, paste, commit, or share `.env`; it contains database credentials and
the Discord webhook secret.
