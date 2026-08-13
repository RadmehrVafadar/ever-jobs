# Research Notes 6004

Research performed 2026-08-12 confirmed stable early-talent Workday tenants for RBC, TD, BMO, CIBC, PwC, Aritzia, Loblaw, Canadian Tire, Canada Goose, Manulife, Sun Life, and Intact. KPMG Canada exposes a dedicated iCIMS student tenant (`students-kpmgca`) with approximately 100 live student results at inspection time. Scotiabank, Deloitte Canada, Bell, Rogers, and TELUS use SuccessFactors-style vanity domains. EY uses a Yello board, and Accenture exposes official localized Canadian job pages but needs a dedicated adapter.

On 2026-08-12, a network-enabled full-cohort smoke completed all 22 endpoints
for the 20 employer groups with exit code 0: 18 endpoints returned parsed jobs,
four returned authoritative upstream zero counts (Loblaw main, PC Financial,
Shoppers Drug Mart, and Bell), no endpoint failed, and no parsed application URL
failed its official-host check. KPMG advertised 28 jobs; the bounded command
parsed 25, found 23 GTA jobs, 19 with Summer 2027 evidence, and four satisfying
the combined GTA + Summer 2027 + configured-role diagnostic. Deloitte
advertised 109 jobs; the command parsed its bounded 25, all 25 were GTA jobs,
one matched a configured role family, and none contained Summer 2027 evidence.
These observations validate endpoint reachability and parsing on that date;
they do not assert that every employer currently has a matching Summer 2027
opening. Deterministic CI continues to rely on sanitized fixtures rather than
current network state.

Validation closed on 2026-08-12. The production build completed for all five
projects. The full watcher package passed 15 suites/215 tests, the complete API
package passed 14 suites/79 tests, and the focused Spec 6004 regression set
passed 24 suites/330 tests. The deterministic smoke helpers passed 12 tests,
and the live result is recorded above. The Nx lint command completed with no
configured tasks. Documentation lint is blocked only by unrelated, pre-existing
history: four duplicate 2026-07-20 log entries and missing metadata tables in
Spec 5024. Prisma schema validation passed; regeneration could not replace the
already-current Windows query-engine DLL while the operator's local API/watcher
processes held it open, so those processes were left undisturbed.
