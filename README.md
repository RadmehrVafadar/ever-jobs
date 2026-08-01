# rad.ar

> A plugin-driven TypeScript platform for searching, normalizing, analyzing, and monitoring jobs
> across job boards, applicant-tracking systems, and company career sites.

[![TypeScript](https://img.shields.io/badge/TypeScript-only-3178C6.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E.svg)](https://nestjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

rad.ar is a NestJS/Nx monorepo with a runtime plugin registry and a catalog of more than
1,800 source packages. It exposes the same normalized job model through REST, GraphQL, a
command-line client, and an MCP server. A separate PostgreSQL-backed watcher can continuously
evaluate selected sources, retain observations, score matches, deduplicate equivalent postings,
and deliver notifications.

The registry determines the source count and availability at application startup. A source being
present in the catalog does not by itself mean it is enabled for unattended monitoring.

The `@ever-jobs/*` npm scope, `EVER_JOBS_*` environment variables, `ever_jobs_*`
metrics, and existing CLI/MCP identifiers are retained for backward compatibility.

## Applications

| Application | Purpose | Default interface |
| --- | --- | --- |
| [`apps/api`](apps/api) | Concurrent job search, analysis, source health, watch management, and metrics | REST on `http://localhost:3001`, GraphQL at `/graphql` |
| [`apps/cli`](apps/cli) | Search, compare, and administer persistent watches from a terminal or JSON stdin | `npm run cli -- <command>` |
| [`apps/mcp`](apps/mcp) | Makes rad.ar search tools available to MCP-compatible AI clients | stdio, backed by the API |
| [`apps/watcher`](apps/watcher) | Schedules persistent watches and exposes worker health and Prometheus metrics | health/metrics on `http://localhost:3002` |

The API publishes an interactive Scalar reference at
[`http://localhost:3001/docs`](http://localhost:3001/docs) and Swagger UI at
[`http://localhost:3001/swg`](http://localhost:3001/swg) when those features are enabled.

## Core capabilities

- Runtime-discovered, independently replaceable source plugins.
- Concurrent search across general job boards, remote boards, ATS platforms, aggregators, and
  official company career pages.
- One normalized TypeScript model for jobs, salaries, employment types, application URLs, and
  multi-location postings.
- Cross-source merging and deduplication, salary analytics, liveness checks, and legitimacy
  signals.
- JSON, CSV, table, and summary output through the CLI and API.
- Shared HTTP infrastructure for timeouts, retries, proxy support, caching, and source-health
  tracking.
- Persistent watches with per-target cadence, initialization state, execution leases, canonical
  posting episodes, scoring, delivery history, and failure classification.
- API-key authentication, rate limiting, health endpoints, and Prometheus metrics.

## Architecture

rad.ar keeps orchestration separate from source and feature implementations:

| Package area | Responsibility |
| --- | --- |
| [`packages/models`](packages/models) | DTOs, enums, plugin contracts, and normalized job types |
| [`packages/plugin`](packages/plugin) | Plugin metadata, discovery, registry, and lifecycle |
| [`packages/plugins`](packages/plugins) | Source adapters plus replaceable deduplication, merge, liveness, legitimacy, and storage plugins |
| [`packages/common`](packages/common) | Shared HTTP client and common utilities |
| [`packages/analytics`](packages/analytics) | Job and salary analysis |
| [`packages/watcher`](packages/watcher) | Watch contracts, planning, persistence, scoring, execution, coverage, and delivery orchestration |

Source plugins implement the common scraper contract and are loaded by the registry. Core
applications depend on contracts rather than on individual source implementations. See the
[architecture overview](docs/ARCHITECTURE_OVERVIEW.md) and
[plugin architecture](docs/PLUGIN_ARCHITECTURE.md) for the full design.

## Quick start

The repository's container image uses Node.js 22. Using the same major version locally is
recommended. You also need npm; Docker with Compose is required for the PostgreSQL-backed watcher.

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run start:dev
```

On PowerShell, replace the first command with:

```powershell
Copy-Item .env.example .env
```

The API starts on port `3001`. Search it directly:

```bash
curl --request POST http://localhost:3001/api/jobs/search \
  --header "Content-Type: application/json" \
  --data '{"searchTerm":"software engineer intern","location":"Toronto, ON","siteType":["linkedin"],"resultsWanted":10}'
```

Or run the CLI without starting a separate CLI service:

```bash
npm run cli -- search \
  --search-term "software engineer intern" \
  --location "Toronto, ON" \
  --site linkedin \
  --results 10 \
  --format table
```

Run `npm run cli -- search --help` for the complete search options. The CLI also accepts
structured JSON through `search --stdin`.

### MCP server

With the API running:

```bash
npm --workspace @ever-jobs/mcp run build
npm --workspace @ever-jobs/mcp start
```

Set `EVER_JOBS_API_URL` when the API is not at `http://localhost:3001`. See the
[MCP guide](apps/mcp/README.md) for client configuration and available tools.

### Persistent watcher

Start PostgreSQL and prepare the watcher database:

```bash
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run db:seed
npm run start:watcher:dev
```

With the API running in another terminal, inspect the seeded watch:

```bash
npm run cli -- watch list --json
npm run cli -- watch coverage --id <watch-id> --json
```

The seeded prestige watch is globally disabled and uninitialized. Review source results, initialize
changed targets without notifications, and complete the documented observation cycles before
resuming it. Notification secrets belong only in environment variables.

Use the [watcher guide](apps/watcher/README.md) and
[local operations runbook](docs/runbooks/watcher-local.md) for the complete safe activation
sequence.

## Prestige internship coverage

The included `prestige-internships-v2` preset is currently revision 3. Its inventory contains 26
companies:

- 21 companies have at least one first-class company or ATS target.
- Uber, Notion, Ramp, Netflix, and IBM are included as bounded, board-mode targets in revision 3.
- RBC, TD, Scotiabank, BMO, and CIBC are intentionally deferred and remain visible as
  `uncovered`.

Coverage uses normalized exact company names from company-specific targets. Generic discovery
boards such as LinkedIn, Google Jobs, and Canada Job Bank provide redundancy but do not count as
first-class company coverage.

Coverage is available from:

```text
GET /api/watches/:id/coverage
npm run cli -- watch coverage --id <watch-id>
```

The report distinguishes active, disabled, uncovered, uninitialized, and degraded coverage. The
aligned preset example is
[`examples/prestige-internships-v2-canada-usa.watch.json`](examples/prestige-internships-v2-canada-usa.watch.json).

## Common development commands

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Start the API in watch mode |
| `npm run start:watcher:dev` | Start the watcher worker in development |
| `npm run cli -- search --help` | Show CLI search options |
| `npm run build` | Build all Nx projects |
| `npm run lint` | Lint all projects |
| `npm run lint:docs` | Validate documentation and Spec Kit metadata |
| `npm test` | Run the Jest test suite |
| `npm run test:api` | Run API tests |
| `npm run test:cli` | Run CLI tests |
| `npm run test:sources` | Run source-plugin tests |
| `npm run db:generate` | Generate the Prisma client |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed the default disabled watch |

Tests are fixture-first. Live source checks are explicit operational smokes because third-party
surfaces can rate-limit, block, or change independently of this repository.

## Configuration

Copy [`.env.example`](.env.example) and enable only the services you need. It documents API-key
authentication, rate limits, caching, proxies, source selection, PostgreSQL, watcher scheduling,
and notification providers.

Never commit API keys, proxy credentials, database credentials, webhook URLs, cookies, or
authenticated browser state. All outbound source requests must use the shared HTTP client.

## Documentation

| Resource | Contents |
| --- | --- |
| [Documentation index](docs/index.md) | Complete map of specs, plans, references, and runbooks |
| [API and source manifest](tool_manifest.json) | Machine-readable capabilities, endpoints, source groups, and watcher contracts |
| [CLI reference](docs/CLI.md) | Search, comparison, and watcher commands |
| [API changelog](docs/API_CHANGELOG.md) | Public API compatibility history |
| [Watcher guide](apps/watcher/README.md) | Runtime model, cadence, coverage, metrics, and operations |
| [Local watcher runbook](docs/runbooks/watcher-local.md) | Safe setup, baseline, observation, and troubleshooting sequence |
| [Deployment guide](docs/DEPLOYMENT.md) | Docker and deployment guidance |
| [Security guidelines](docs/SECURITY_GUIDELINES.md) | Credential handling and security expectations |
| [Contributing guide](CONTRIBUTING.md) | Development workflow and contribution requirements |

The authoritative rules for coding agents are in [`AGENTS.md`](AGENTS.md). Feature work follows
the Spec Kit artifacts under [`.specify/specs`](.specify/specs).

## Responsible use

Source availability and legal terms vary. Some adapters rely on public or unofficial interfaces
that can change or reject automated traffic. Confirm that your use complies with applicable laws,
site terms, robots policies, rate limits, and data-retention requirements. rad.ar provides no
guarantee that a posting is current, legitimate, or complete.

## Credits

rad.ar is a TypeScript/NestJS re-architecture influenced by
[JobSpy](https://github.com/speedyapply/JobSpy),
[JobSpy API](https://github.com/rainmanjam/jobspy-api), and
[ats-scrapers](https://github.com/speedyapply/ats-scrapers).

## License

rad.ar is available under the [MIT License](LICENSE).
