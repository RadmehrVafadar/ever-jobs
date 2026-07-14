# Spec 016 — Real-time Job Watcher

## Problem
Users need persistent watches that discover software internship postings quickly, prioritize direct/ATS sources, deduplicate jobs, score relevance, notify strong matches, and digest weaker matches without alert floods.

## Scope
- Persistent JobWatch, ObservedJob, WatchMatch, NotificationDelivery, and WatchRun records backed by PostgreSQL-compatible Prisma schema.
- Deterministic fingerprinting, description hashing, baseline/recent/notify-all initialization, scoring, notification interfaces, REST/CLI management, watcher app, Docker/config docs, seed watch.
- Reuse existing `JobsService`, plugin registry, normalized `JobPostDto`, config and Nest conventions.

## Non-goals
- Automatic job applications, LinkedIn login automation, CAPTCHA/access-control bypassing, frontend dashboard, live third-party tests.

## Contracts
- Fingerprints are SHA-256 of source+external id when available, otherwise canonical source/company/title/location/url.
- Notification idempotency key: watchId + observedJobId + notificationType + destination.
- Watch execution records partial source failures without failing the run.

## Test plan
Unit tests cover canonicalization, fingerprinting, scoring, initialization mode, digest selection, and notification idempotency. Integration/E2E tests use deterministic fake job data and never call live sites.
