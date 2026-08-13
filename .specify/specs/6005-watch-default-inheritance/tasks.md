# Tasks 6005 — Watch Default Inheritance

- [x] T01 Make configured target intervals and target geography fields optional; accept when compact and expanded validation tests pass.
- [x] T02 Add effective interval/scope resolution and use it across planner due checks and request construction; accept when inherited and overridden plans are deterministic.
- [x] T03 Use effective target cadence in advancement and next-run scheduling; accept when sparse targets never create invalid dates and explicit overrides retain their cadence.
- [x] T04 Compact Canadian internship preset target definitions without changing effective scope, requests, or company coverage; accept when preset regressions pass and repeated geography is absent.
- [x] T05 Update web contracts and JSON import for sparse target values; accept when both old expanded and new compact documents import.
- [x] T06 Add GUI inherited/custom controls for cadence, countries, and locations, and prevent unrelated scope edits from copying defaults; accept when component tests cover edit/reset behavior.
- [x] T07 Update example/configuration documentation, human spec mirror, docs index/log/questions, and any operator guidance; accept when the inheritance and override rules are explicit.
- [x] T08 Run focused watcher/API/web tests, builds, documentation lint, and diff checks; record any unrelated pre-existing blockers and final results. Completed with 15 watcher suites/218 tests, 7 web files/26 tests, 3 affected API/persistence suites/33 tests, a final 6-suite/76-test focused regression, API/web/CLI/watcher builds, Prettier, manifest/example parsing, compact-example invariants, and scoped diff hygiene passing. Nx has no configured lint tasks. Documentation lint reaches only the pre-existing two deprecated broken example links, four historical duplicate log entries, and two Spec 5024 frontmatter findings.
- [x] T09 Encode inherited intervals compatibly in PostgreSQL while preserving sparse API/export reads; accepted with an old-reader simulation retaining every target and a current-reader round-trip omitting inherited values.
- [x] T10 Reject malformed persisted target arrays atomically; accepted with a mixed valid/invalid array failing the watch read instead of shortening `sourceTargets`.
- [x] T11 Merge run-owned runtime state into the latest target configuration with bounded optimistic retries; accepted with a full backup restore applied during a deferred run surviving completion with its additions, defaults, geography, and baseline state intact.
- [x] T12 Update operator documentation and run focused/full verification; accepted with Mac/local same-revision deployment guidance, 15 watcher suites/222 tests, three API watch suites/31 tests, watcher/API/CLI production builds, and diff hygiene passing.
