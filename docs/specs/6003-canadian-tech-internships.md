# Canadian Tech Internships (Spec 6003)

Spec 6003 replaces the retired Canada/USA prestige preset with one current
starter template: **Canadian Tech Internships** (`canadian-tech-internships`,
revision 1).

The template retains the existing 26-company target inventory, 19 Summer 2027
software internship/co-op searches, required internship evidence, preferred
technology and role terms, seniority/experience/doctoral exclusions, scoring,
cadence, and safe disabled baseline behavior. Its geography is deliberately
narrower:

- country code: `CA` only;
- Toronto and Greater Toronto Area;
- Mississauga, Brampton, Vaughan, Richmond Hill, Markham, Oakville, Burlington,
  Pickering, and Ajax;
- no broad Canada, Waterloo, U.S. country code, U.S. city/state, or United States
  fallback.

Every template target sets `strictLocations: true`, so a returned job must
advertise at least one configured GTA location; Canadian jobs outside that list
are suppressed instead of merely receiving fewer preference points.

Applying the preset replaces locations and country codes rather than merging
them. This guarantees that a legacy Canada/USA watch loses its U.S. geography.
Companies, search/required/preferred/excluded terms, and other operator-owned
list fields continue to use the established merge rules. Because source scopes
change, enabled targets return to an uninitialized state and require the normal
pause, no-notification baseline, review, and explicit-resume workflow.

The watcher also enforces an explicit `CA` source scope when scoring returned
jobs. A Tier 2 or Tier 3 provider that unexpectedly returns a U.S. posting
cannot admit it into the Canadian template; watches without an explicit source
country scope retain the legacy tier policy.

Fresh databases seed this disabled template. Existing watches are never changed
at startup. The old TypeScript names remain deprecated aliases for build
compatibility, but the retired string ID is no longer a selectable preset.

See the authoritative [specification](../../.specify/specs/6003-canadian-tech-internships/spec.md),
[implementation plan](../../.specify/specs/6003-canadian-tech-internships/plan.md),
and [task ledger](../../.specify/specs/6003-canadian-tech-internships/tasks.md).
