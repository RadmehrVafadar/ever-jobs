# Ever Jobs Mac Mini Production Cheat Sheet

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
- `lastPollAt` is recent and `lastError` is `null`.
- Discord status is `configured`.
- The watch itself has `enabled: true` when monitoring should be on.

`activeWatchIds: []` means no execution was in progress at that exact moment. It
does not mean the service is off. Health can also include a paused watch, so
always inspect the watch's own `enabled` field.

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
watcher and CLI output, preventing an old `dist/` bundle from surviving a pull.

If dependencies and migrations are known to be unchanged, `npm ci`, Prisma
generation, and migration still remain safe; the commands should be kept in the
standard production-update sequence.

## Confirm source and compiled revision

```bash
git log -1 --oneline
sed -n '203,285p' packages/watcher/src/services/prestige-internships-v2.preset.ts
```

Do not verify `maxRequestsPerRun: 1` with a loose `grep`: it also matches `12`.
Use an end-of-line expression:

```bash
grep -Eq "maxRequestsPerRun: 1,$" packages/watcher/src/services/prestige-internships-v2.preset.ts \
  && echo "SOURCE NEW" || echo "SOURCE NOT EXPECTED"
```

The authoritative compiled-code check is a preset preview after rebuilding:

```bash
node dist/apps/cli/main.js watch preset apply prestige-internships-v2 \
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
node dist/apps/cli/main.js watch preset apply prestige-internships-v2 \
  --watch 2067423d-b634-49a5-a8ca-8b963e00f9d4
```

Review `materiallyChanged`, `disabled`, and
`targetKeysRequiringInitialization`. Apply only after the preview is correct:

```bash
node dist/apps/cli/main.js watch preset apply prestige-internships-v2 \
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
