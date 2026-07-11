# Spec 5024 — JobsService Registry Test Harness Fix

## Problem Statement

`apps/api/src/jobs/__tests__/jobs.service.spec.ts` instantiates `JobsService` with `Object.create` for focused unit tests, but the helper still seeds the removed `scraperMap` field instead of the current `PluginRegistry` dependency. As a result, `searchJobs()` fails before exercising routing behavior because `this.registry.listAtsSites()` is undefined.

## Scope

- Update the unit-test helper to provide a minimal registry-compatible mock.
- Preserve existing routing, fan-out, error handling, result tagging, sorting, and salary post-processing assertions.
- Keep the production `JobsService` implementation unchanged.

## Non-Goals

- No changes to plugin discovery, runtime registry semantics, or production dependency injection.
- No new source plugins or external HTTP behavior.
- No changes to scraper output contracts.

## Contracts

- The mock registry exposes `getScraper(site)`, `listAtsSites()`, `listSiteKeys()`, `listSources()`, `registerExternal(site, scraper)`, and `size`.
- `listAtsSites()` returns the ATS subset present in the test's scraper map.
- The helper provides minimal config and metrics mocks required by `searchJobs()`.

## Test Plan

- Run `npx jest apps/api/src/jobs/__tests__/jobs.service.spec.ts --runInBand`.
- Run `npm test -- --runInBand` when practical to verify repository-wide Jest behavior.
