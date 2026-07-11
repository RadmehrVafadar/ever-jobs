# Plan 5024 — JobsService Registry Test Harness Fix

1. Replace the stale `scraperMap` helper assignment with a registry-shaped mock.
2. Add minimal `ConfigService` and `MetricsService` mocks used by `searchJobs()`.
3. Re-run the focused JobsService Jest suite.
4. Record the change in repository documentation indexes/logs.
