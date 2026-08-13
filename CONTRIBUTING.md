# Contributing to rad.ar

Thanks for your interest in contributing to rad.ar! This guide covers adding new source packages, testing, and code conventions.

## Source Package Structure

Each source is an independent NestJS package inside `packages/`:

```
packages/source-<name>/
├── src/
│   ├── <name>.service.ts     # IScraper implementation
│   ├── <name>.module.ts      # NestJS module
│   ├── <name>.constants.ts   # URLs, headers, selectors
│   ├── <name>.types.ts       # API response types (optional)
│   └── index.ts              # Barrel exports
├── package.json
└── tsconfig.json
```

## Adding a New Job Source

### 1. Create the package

```bash
mkdir -p packages/source-<name>/src
```

### 2. Implement `IScraper`

Your service must implement the `IScraper` interface:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { HttpClient, extractSalary, convertToAnnual } from "@ever-jobs/common";
import {
  JobPostDto,
  JobResponseDto,
  ScraperInputDto,
  JobType,
  CompensationInterval,
} from "@ever-jobs/models";

@Injectable()
export class YourService implements IScraper {
  private readonly logger = new Logger(YourService.name);
  private readonly httpClient = new HttpClient();

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const jobs: JobPostDto[] = [];
    // Fetch and parse jobs...
    return new JobResponseDto({ jobs });
  }
}
```

### 3. Create the module

```typescript
import { Module } from "@nestjs/common";
import { YourService } from "./your.service";
@Module({ providers: [YourService], exports: [YourService] })
export class YourModule {}
```

### 4. Wire into the app

Update these files:

| File                                     | Change                                    |
| ---------------------------------------- | ----------------------------------------- |
| `packages/models/src/enums/site.enum.ts` | Add `YOUR_SOURCE = 'your_source'`         |
| `tsconfig.base.json`                     | Add path alias `@ever-jobs/source-<name>` |
| `apps/api/src/jobs/jobs.module.ts`       | Import `YourModule`                       |
| `apps/api/src/jobs/jobs.service.ts`      | Add constructor DI + scraperMap entry     |
| `apps/cli/src/cli.module.ts`             | Import `YourModule`                       |
| `jest.config.js`                         | Add module name mapping                   |
| `apps/mcp/src/tools.ts`                  | Add to `SOURCES` catalog                  |

### 5. Source naming conventions

| Type      | Prefix            | Example                 |
| --------- | ----------------- | ----------------------- |
| Job board | `source-`         | `source-dice`           |
| ATS       | `source-ats-`     | `source-ats-greenhouse` |
| Company   | `source-company-` | `source-company-stripe` |

## Best Practices

- **API first**: Prefer REST/JSON APIs over HTML scraping.
- **Dual-mode extraction**: If the site has embedded JSON (e.g. `__NEXT_DATA__`), use that as primary with HTML fallback.
- **Rate limiting**: Use the HttpClient's built-in rate-delay support.
- **Salary parsing**: Use `extractSalary()` from `@ever-jobs/common` for description-based salary extraction.
- **Use enums**: Use `CompensationInterval.YEARLY` instead of string `'yearly'`.
- **Error handling**: Catch and log errors gracefully. Never let one source crash the whole search.

## Running Tests

```bash
# All unit tests
npm test

# Specific test file
npx jest packages/common/__tests__/helpers.spec.ts --no-coverage

# Verbose output
npx jest --verbose --no-coverage --testPathPatterns __tests__

# E2E tests (hits live APIs — use sparingly)
npx jest --testPathPatterns e2e-spec
```

## Pull Request Process

1. Fork and create a feature branch: `git checkout -b feature/source-<name>`
2. Implement the source package following the structure above
3. Add module wiring (enum, tsconfig, modules, service, jest, MCP)
4. Write unit tests in `packages/source-<name>/__tests__/`
5. Run `npm test` to verify all tests pass
6. Submit a pull request against the `develop` branch

## Code Style

- **TypeScript strict mode**: Enabled in `tsconfig.base.json`
- **Formatting**: Use Prettier defaults
- **Naming**: camelCase for files, PascalCase for classes, kebab-case for package directories
- **Imports**: Use `@ever-jobs/*` path aliases, not relative paths between packages
