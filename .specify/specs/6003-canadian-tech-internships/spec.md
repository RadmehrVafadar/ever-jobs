# Spec: 6003 — Canadian Tech Internships

| Field | Value |
| --- | --- |
| Status | Implemented |
| Owner | rad.ar |
| Date | 2026-08-10 |
| Related specs | 6000, 6001, 6002 |

## Problem statement

rad.ar currently presents a legacy `prestige-internships-v2` watch preset whose
discovery scope includes the United States. The product now needs one clear
starter template for a Canadian technology-internship search concentrated on
Toronto and the Greater Toronto Area (GTA). Operators should retain the useful
company inventory and the carefully curated search, eligibility, preference,
and exclusion terms without inheriting U.S. geography or choosing among older
templates.

The root README also needs to make the localhost operator GUI the obvious first
way to run the project and consistently present the product as `rad.ar`.

## Goals

- Expose exactly one current watch preset named `Canadian Tech Internships` with
  the stable ID `canadian-tech-internships` and revision `1`.
- Restrict the preset and every preset-owned source target to country code `CA`
  and Toronto/GTA location queries.
- Cover Toronto, Greater Toronto Area, Mississauga, Brampton, Vaughan, Richmond
  Hill, Markham, Oakville, Burlington, Pickering, and Ajax.
- Preserve the existing target-company inventory, source-target inventory,
  search terms, required terms, preferred terms, excluded terms, scoring,
  cadence, workplace types, employment types, and safe baseline posture except
  where geography or naming must change.
- Ensure applying the preset to an existing watch removes preset-owned U.S.
  geography instead of merging `US` or `United States` forward.
- Keep existing watch records and compiled imports compatible through
  deprecated source-code aliases; do not expose the retired preset in preset
  listings or new-install seeding.
- Put `npm run gui:dev` near the top of the README and retain exact `rad.ar`
  user-facing branding.

## Non-goals

- Removing U.S. capability from general CLI/API searches or user-authored
  watches.
- Deleting existing watches, historical Spec 6000 documents, database rows, or
  migration history.
- Adding or removing source plugins or target companies.
- Changing notification routing, score thresholds, source cadence, application
  authentication, or watcher process behavior.
- Automatically modifying persisted watches during application startup.
- Guaranteeing that every target company has a Toronto opening at all times.

## Functional requirements

### Preset identity and discovery

1. `WatchPresetService.list()` MUST return one preset: ID
   `canadian-tech-internships`, version `1`, name
   `Canadian Tech Internships`.
2. A fresh database seed MUST create a disabled watch with that name and
   configuration.
3. The retired `prestige-internships-v2` ID MUST NOT appear in current REST,
   CLI, GUI, manifest, README, example, or runbook instructions.
4. Deprecated TypeScript exports MAY remain as aliases to the new factory and
   constants so source consumers do not fail to compile.

### Geography

1. The top-level watch `countryCodes` MUST equal `["CA"]`.
2. The top-level watch `locations` MUST equal the ordered GTA location list in
   Goals and MUST NOT contain broad `Canada`, Waterloo, a U.S. state/city, or
   `United States`.
3. Every preset source target with a `searchScope` MUST use `["CA"]` and the
   same GTA location list with `strictLocations: true`.
4. An explicit source-target country scope MUST be enforced again when scoring
   returned jobs, so a Tier 2/3 source cannot admit an unexpected U.S. result
   from a Canadian-only request.
5. Applying this preset MUST replace top-level locations and country codes.
   Operator-authored terms and companies continue to merge, but stale U.S.
   geography MUST be removed.
6. Geography changes MUST remain material target changes, reset enabled target
   initialization, and follow the existing pause/baseline/explicit-resume
   workflow.

### Retained search profile

1. The 19 Summer 2027 software, backend, frontend, full-stack, mobile,
   developer-experience, platform, cloud, infrastructure, SRE, DevOps,
   security, data, ML, and AI internship/co-op search terms MUST be retained.
2. Required terms MUST remain `intern`, `internship`, `co-op`, `coop`, and
   `summer 2027`.
3. Existing preferred technology and role terms and existing seniority,
   experience, and doctoral exclusions MUST be retained.
4. The existing 26-company inventory and explicit coverage/deferred-company
   classification MUST be retained.
5. The watch MUST remain disabled and baseline-initialized by default, in the
   `America/Toronto` timezone.

### Documentation and examples

1. The README MUST begin with `# rad.ar` and show `npm run gui:dev` in an
   early quick-start block.
2. Current documentation MUST describe only the Canadian Tech Internships
   template and GTA scope. Historical specs/changelog entries remain unchanged
   as historical records.
3. `examples/canadian-tech-internships.watch.json` MUST validate to the exact
   output of the TypeScript preset factory.
4. Legacy example filenames MUST remain available but be marked deprecated and
   must not be linked as the current template.

## Contracts

```ts
interface WatchPresetDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  applyPolicy?: {
    locations?: "merge" | "replace";
    countryCodes?: "merge" | "replace";
  };
  createWatch(): Partial<JobWatch>;
}

interface WatchSearchScope {
  countryCodes: string[];
  locations: string[];
  strictLocations?: boolean;
  searchTerms?: string[];
  maxRequestsPerRun?: number;
}
```

The default preset policy is `merge` for backward compatibility. The Canadian Tech
Internships preset sets both geography fields to `replace`. Preset preview diffs
report added and removed locations/country codes. No database migration is
required because the policy is runtime metadata and watch geography already
uses JSON-backed fields. `strictLocations` is optional and defaults to the
legacy non-strict behavior; the Canadian template enables it on every target.

## Compatibility and migration

- Existing persisted watches are never rewritten on boot.
- An operator migrates an old watch by pausing it, previewing/applying
  `canadian-tech-internships`, baselining every materially changed enabled
  target without notifications, reviewing failures/results, and explicitly
  resuming.
- The apply operation retains watch identity, metadata, notifications, scoring
  overrides, operator-only targets, companies, and terms under existing merge
  rules; preset geography is replaced.
- The new preset ID intentionally replaces the old public preset ID. Deprecated
  TypeScript names resolve to the new implementation, but the old string ID is
  not accepted as a current template.
- Rollback can restore the previous registered preset without a schema change;
  already migrated watches remain valid Canadian-only watches.

## Security and performance

- The change adds no credentials, external endpoints, or secret persistence.
- Target request limits, bounded execution, shared HTTP transport, and polling
  cadence remain unchanged.
- Narrower geography reduces discovery breadth and cannot increase the number
  of target/location matrix entries beyond the configured GTA list and existing
  per-run caps.

## Test plan

- Unit-test the canonical ID/name/version, disabled baseline defaults, retained
  terms and company inventory, and exact GTA/CA geography at the watch and
  source-target levels.
- Validate the canonical JSON example against `WatchValidationService` and the
  TypeScript factory.
- Test preset listing contains exactly the new template and rejects the old ID.
- Test explicit `CA` target scopes suppress unexpected U.S. results even for
  Tier 2 and Tier 3 while empty/omitted scopes retain legacy tier behavior.
- Test apply preview and mutation remove `US`, `United States`, and other stale
  locations while retaining operator terms, companies, thresholds,
  destinations, and operator-only targets.
- Test geography changes reset enabled targets and require initialization.
- Test the fresh-install seeder uses the new name and factory.
- Run watcher and API focused Jest suites, watcher/API/web TypeScript builds,
  documentation lint where available, and `git diff --check`.

## Acceptance criteria

- The GUI and CLI preset list show only `Canadian Tech Internships`.
- A newly seeded/exported template contains only `CA` and the specified
  Toronto/GTA locations.
- Applying it to a paused Canada/USA watch removes all U.S. geography and
  requires a new no-notification baseline for changed enabled targets.
- The curated terms and 26 target companies remain present.
- The README is branded `rad.ar` and lets a prepared local installation start
  the GUI with `npm run gui:dev` near the top.
