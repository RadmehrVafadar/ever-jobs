# Plan

1. Add `@ever-jobs/watcher` package with replaceable repository, scorer, fingerprint, execution, notification, digest and metrics services.
2. Add Prisma schema and SQL migration for PostgreSQL persistence.
3. Add `apps/watcher` Nest app importing existing `JobsModule` and watcher module.
4. Mount watcher REST controllers under `apps/api/src/watches` and CLI commands under `apps/cli/src/commands`.
5. Seed default Toronto/Canada software internship watch and example JSON.
6. Update Docker Compose, env docs, README and docs index/log.
7. Validate with focused Jest tests and TypeScript build where environment permits.
