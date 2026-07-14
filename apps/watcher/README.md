# Ever Jobs Watcher

The watcher adds persistent job watches for low-latency internship discovery. It reuses existing Ever Jobs source plugins and normalized `JobPostDto` results rather than running a separate scraper.

## Architecture

`@ever-jobs/watcher` contains replaceable services for repositories, fingerprinting, scoring, execution, notifications, digests, and metrics. `apps/watcher` runs those services as a Nest application context; the API and CLI can import the same module.

## Setup

```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npx prisma migrate deploy
npx ts-node -r tsconfig-paths/register scripts/seeds/watcher-seed.ts
npm run start:watcher:dev
```

## First run without floods

The seeded watch uses `baseline` mode, so the first execution stores currently visible jobs without sending notifications. Use `watch initialize <id>` or `POST /api/watches/:id/initialize` before enabling immediate alerts.

## Notifications

Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DISCORD_WEBHOOK_URL`, or `GENERIC_WEBHOOK_URL`. Webhook URLs must be HTTPS and cannot target localhost/private loopback addresses.

## Scoring

Scores are explainable and include role, internship, location, company, source and skills buckets. Defaults target Toronto/Canada software internships and co-op roles.

## Limitations

The watcher improves early discovery but cannot guarantee being first. Tests use deterministic fake data and never depend on live third-party sites.
